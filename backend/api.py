"""api.py: the ScholarPi API, assembled: the app and shared helpers (core.py), one router per
concern (routes/*.py), then the Lab, consent, layout, PiEn, recent, live, traffic and Super Neural
Engine routers and the static frontend. Run with `gunicorn api:app`. Names other modules and the
tests take from here (idle_worker, tests/test_orcid_return) are re-exported below."""
from core import *  # noqa: F401,F403
import importlib

# One router per concern, included in this order (it is the matching order).
_ROUTERS = ("meta", "auth", "piq", "chain", "status", "identity", "arcade", "visits", "profile",
            "assessments", "reviews", "history", "admin", "reviewing", "bugreport", "assess",
            "discover", "scilem", "forecast", "analytics", "explorer")
for _name in _ROUTERS:
    app.include_router(importlib.import_module(f"routes.{_name}").router)

# Re-exported for idle_worker and tests/test_orcid_return, which take them from here.
from routes.auth import _orcid_state  # noqa: F401,E402
from routes.identity import require_identity, require_owner  # noqa: F401,E402
from routes.visits import _visitor_key  # noqa: F401,E402
from routes.assess import build_result_payload, retrieve_manuscript_bytes  # noqa: F401,E402



# ---------------------------------------------------------------------------
# 8b. Lab: private projects (owner only). Public Lab projects are static files.
# ---------------------------------------------------------------------------
import lab as _lab  # noqa: E402
app.include_router(_lab.build_router(BASE_DIR, require_owner))
app.include_router(_lab.build_features_router())

# Permission requests with a confirm link (/confirm/?t=...). See consent.py.
import consent as _consent  # noqa: E402
app.include_router(_consent.build_router(BASE_DIR, require_owner))

# A signed-in visitor's orbit layout (positions, sizes, open windows). See layout.py.
import layout as _layout  # noqa: E402
app.include_router(_layout.build_router(BASE_DIR, require_identity))

# PiEn: what everyone's use of the site teaches the mark, pooled anonymously. See pien.py.
import pien as _pien  # noqa: E402
app.include_router(_pien.build_router(BASE_DIR))

# Recent assessments, for everyone: field, score and day only. See recent.py.
import recent as _recent  # noqa: E402
app.include_router(_recent.build_router(get_db_connection))
import live as _live
import traffic as _traffic
import shape  # noqa: E402
app.include_router(_traffic.build_router(get_db_connection))
app.include_router(_live.build_router(get_db_connection, idle_worker.public_status, idle_worker.activity))

# The Super Neural Engine: a prompt made by wiring, answered by every engine. See super_engine.py.
import super_engine as _super  # noqa: E402


def _super_rows():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT p.eval_hash, p.title, p.author_name, p.fields, p.final_score, p.timestamp,
                      b.block_height, p.piq_minted
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               WHERE p.final_score IS NOT NULL AND COALESCE(p.title, '') <> ''
               ORDER BY p.timestamp DESC LIMIT 2000""").fetchall()
    finally:
        conn.close()
    return [{"eval_hash": r[0], "title": r[1], "author": clean_author_name(r[2]), "fields": r[3],
             "score": r[4], "timestamp": r[5], "on_ledger": r[6] is not None, "piq": r[7] or 0.0} for r in rows]


def _super_answer(prompt):
    if not ENABLE_SCILEM_ASSISTANT:
        return {}
    return scilem.answer(prompt)


def _super_route_call(juror, prompt, routes):
    """One answer from the first route of this juror's chain that responds,
    with the same cooldowns and failure handling as manuscript assessment."""
    from providers import (is_route_cooling, is_provider_unreachable, record_success, record_rate_limit,
                           record_provider_unreachable, parse_retry_after, classify_provider_error,
                           ends_chain, PROVIDER_ENDING)
    from brain import request_model_assessment
    if not routes:
        return {"failed": "not configured on this deployment"}
    last = "no route was reachable"
    dead = set()                  # a bad key or empty account: skip that provider's other routes, try the next
    for route in routes:
        if route["provider"] in dead:
            continue
        if is_provider_unreachable(route["provider"])[0] or is_route_cooling(route["model"], route["provider"])[0]:
            last = "temporarily rate-limited"
            continue
        _, data = request_model_assessment(juror, route["model"], route["key"], route["base"], prompt)
        if not data.get("api_failed"):
            record_success(route["model"], route["provider"])
            return {**data, "model": route["model"]}
        raw = data.get("_raw_error") or data.get("opinion", "")
        c = classify_provider_error(raw)
        if c["category"] == "rate_limit":
            record_rate_limit(route["model"], route["provider"], parse_retry_after(raw))
        elif c["category"] in ("credit", "auth"):
            record_rate_limit(route["model"], route["provider"], 600)
        elif c["category"] == "network":
            record_provider_unreachable(route["provider"])
        last = c["public"]
        if c["category"] in PROVIDER_ENDING:
            dead.add(route["provider"])
        if ends_chain(c):
            break
    return {"failed": last}


def _super_ask_juror(juror, prompt):
    from providers import build_routes
    return _super_route_call(juror, prompt, build_routes(juror))


def _super_judge(prompt):
    from providers import build_routes, is_scilm_route
    return _super_route_call("judge", prompt, [r for r in build_routes("judge") if not is_scilm_route(r)])


def _super_juror_ready(juror):
    from providers import build_routes
    return bool(build_routes(juror))


def _super_jurors():
    from brain import MODEL_REGISTRY
    return [{"key": k, "label": v["label"].split(" (")[0]} for k, v in MODEL_REGISTRY.items() if v.get("kind") == "external"]


app.include_router(_super.build_router(
    answer=_super_answer, rows=_super_rows, suggest=rib_suggest.suggest, hot=rib_suggest.hot_topics,
    pid_status=lambda: forecast_engine.engine_status(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]),
    pien_db=os.path.join(BASE_DIR, "pien.db"),
    rate_limit=lambda request: check_rate_limit(get_client_ip(request), bucket="scilem"),
    jurors=_super_jurors(), ask_juror=_super_ask_juror, judge=_super_judge,
    # each panel question calls up to six models: its own, stricter bucket
    panel_rate_limit=lambda request: check_rate_limit(get_client_ip(request), bucket="assess"),
    # the super prompt box asks each engine on its own: one bucket per engine
    juror_ready=_super_juror_ready,
    one_rate_limit=lambda request, engine: check_rate_limit(get_client_ip(request), bucket="sp-" + engine)))


# ---------------------------------------------------------------------------
# 9. Serve the frontend (single-page static app)
# ---------------------------------------------------------------------------
_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

# Asset versions are derived from file mtimes, not maintained by hand.
#
# index.html references its assets as `app.js?v=16`. That integer was edited
# manually on each release, and when it was forgotten — which is the normal
# outcome for a number a human has to remember to change — every returning
# browser kept serving the previously cached JS and CSS. The symptom is
# indistinguishable from the code being broken: fixes ship, the deployment is
# correct, and the user sees the old behaviour with no error anywhere.
#
# Rewriting the query string from the file's modification time removes the
# step. Change a file, its version changes; do not, and the browser cache
# stays valid. Done on the way out rather than by editing the file on disk, so
# the source stays readable and nothing has to be regenerated at build time.
_ASSET_QUERY = re.compile(r'\b(?P<file>[\w./-]+\.(?:js|css))\?v=[\w.]+')


def _asset_version(filename: str) -> str:
    try:
        return str(int(os.path.getmtime(os.path.join(_FRONTEND_DIR, filename))))
    except OSError:
        # Unknown file: leave the cache-buster alone rather than invent one
        # that changes on every request and defeats caching entirely.
        return ""


def _versioned_index() -> str:
    with open(os.path.join(_FRONTEND_DIR, "index.html"), "r", encoding="utf-8") as fh:
        html = fh.read()

    def sub(match):
        version = _asset_version(match.group("file"))
        return f"{match.group('file')}?v={version}" if version else match.group(0)

    return shape.stamp(_ASSET_QUERY.sub(sub, html), os.getenv("SCHOLARPI_SHAPE", ""))


if os.path.isdir(_FRONTEND_DIR):
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def _serve_index():
        """index.html with asset versions stamped from the files on disk.

        no-store on the HTML itself, because it is the document that carries
        the version numbers — a cached copy of it would pin the browser to
        whatever asset versions were current when it was cached, which is the
        exact failure this exists to prevent. The assets it points at stay
        aggressively cacheable, which is where the benefit actually is.
        """
        try:
            headers = {"Cache-Control": "no-store, must-revalidate"}
            if IS_EXPERIMENTAL:
                headers["X-Robots-Tag"] = "noindex, nofollow"
            return HTMLResponse(_versioned_index(), headers=headers)
        except OSError:
            raise HTTPException(status_code=404, detail="Frontend is not available.")

    # The Lab boots HAL-OS in the browser with v86, which is an ES module
    # (.mjs) plus WebAssembly. Browsers refuse a module script served with a
    # non-JavaScript MIME type, and python:3.11-slim has no /etc/mime.types to
    # fall back on, so the two types are registered explicitly rather than
    # left to whatever the container happens to know.
    import mimetypes
    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("font/woff2", ".woff2")   # the self-hosted Geist typeface

    # Mounted after the routes above so "/" resolves to the stamped index
    # rather than to the raw file on disk.
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
