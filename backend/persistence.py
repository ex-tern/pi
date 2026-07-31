"""
Storage persistence check.

The problem this exists to catch
-------------------------------
ScholarPi keeps everything that matters — the SQLite database, the
Proof-of-Research ledger, piQ balances, trained Scilem weights — in a single
directory (``SCHOLARPI_DATA_DIR``, default ``~/Scientometric_Pi_Index``).

On a container platform, that directory is ephemeral *by default*. Railway,
Render, Fly and Heroku all give a fresh filesystem on every deploy unless a
persistent volume is explicitly attached and mounted at that path. So the app
runs perfectly, writes everything correctly, and then loses the entire ledger
on the next push — with no error, because nothing failed. The first symptom is
a user reporting their piQ balance reset.

Silence is the whole danger here. A wipe is indistinguishable from a first run
unless something remembers that a previous run happened, so this module leaves
a marker behind and counts boots. If the marker keeps vanishing while the
database is also empty, storage is ephemeral and the operator is told in terms
that name the fix.

This only reports. It never blocks startup: a deployment that is genuinely
meant to be disposable is legitimate, and refusing to boot would be worse than
the problem.
"""
import os
import json
import time
import uuid
import logging

logger = logging.getLogger(__name__)

MARKER_NAME = ".scholarpi_persistence.json"


def _marker_path(data_dir: str) -> str:
    return os.path.join(data_dir, MARKER_NAME)


def check_persistence(data_dir: str, db_path: str) -> dict:
    """Record this boot and report whether storage looks durable.

    Returns a dict describing what was found. Safe to call on every start; it
    performs one small read and one small write.
    """
    report = {
        "data_dir": data_dir,
        "marker_found": False,
        "boot_count": 1,
        "previous_boot": None,
        "db_exists": False,
        "db_bytes": 0,
        "verdict": "unknown",
        "warning": None,
    }

    try:
        os.makedirs(data_dir, exist_ok=True)
    except Exception as e:
        report["verdict"] = "unwritable"
        report["warning"] = f"Data directory {data_dir} could not be created: {e}"
        logger.error(report["warning"])
        return report

    try:
        if os.path.exists(db_path):
            report["db_exists"] = True
            report["db_bytes"] = os.path.getsize(db_path)
    except OSError:
        pass

    marker = {}
    path = _marker_path(data_dir)
    try:
        if os.path.exists(path):
            with open(path, "r") as fh:
                marker = json.load(fh) or {}
            report["marker_found"] = True
    except Exception as e:
        logger.debug("Persistence marker unreadable: %s", e)

    previous_boots = int(marker.get("boot_count", 0) or 0)
    report["boot_count"] = previous_boots + 1
    report["previous_boot"] = marker.get("last_boot")

    # A marker that was written by a previous run and survived means the
    # directory outlived at least one process. That is the only positive
    # evidence of durability available without waiting for a redeploy.
    if report["marker_found"]:
        report["verdict"] = "persistent"
    elif report["db_exists"] and report["db_bytes"] > 0:
        # Database present but no marker: first run after this check was added.
        report["verdict"] = "likely-persistent"
    else:
        report["verdict"] = "fresh"
        report["warning"] = (
            f"Starting with an EMPTY data directory ({data_dir}). If this is not a first "
            f"install, your storage is ephemeral and the previous ledger, piQ balances and "
            f"assessments were lost on redeploy. Attach a persistent volume and mount it at "
            f"this path, then set SCHOLARPI_DATA_DIR to it. On Railway/Render/Fly this is a "
            f"'Volume'; with Docker Compose the bundled 'scholarpi_data' volume already does it."
        )

    try:
        with open(path, "w") as fh:
            json.dump({
                "boot_count": report["boot_count"],
                "last_boot": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "instance": marker.get("instance") or str(uuid.uuid4()),
            }, fh)
    except Exception as e:
        logger.warning("Could not write persistence marker in %s: %s", data_dir, e)

    if report["warning"]:
        logger.warning("STORAGE: %s", report["warning"])
    else:
        logger.info("STORAGE: %s (boot #%d, db %s)", report["verdict"],
                    report["boot_count"],
                    f"{report['db_bytes']} bytes" if report["db_exists"] else "not yet created")
    return report
