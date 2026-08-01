"""Retention of uploaded manuscript files.

The assessment pipeline previously read an upload into memory, scored it and
discarded the bytes — only the filename string survived. That made every
"published" badge a pointer to an assessment of a document nobody could read,
which is a weak form of publication: a reader could see the verdict but never
the thing it was a verdict about.

Files are stored here, keyed by the SHA-256 of their own bytes. That key is not
an arbitrary choice — `brain.py` derives `eval_hash` the same way, so the file
for an assessment is addressable from the assessment's own identifier with no
extra column, no join, and no possibility of the two drifting apart. Two
identical uploads collapse to one stored file for the same reason.

ACCESS IS NOT DECIDED HERE. This module stores and retrieves; the API decides
who may read. The rule the API enforces is that a file becomes publicly
readable only once its author has published the assessment, and stops being
readable the moment they withdraw it — so retention never silently becomes
publication.

Copyright note, recorded where the code is rather than only in a UI string: a
manuscript's author is not always free to redistribute the typeset version a
publisher produced. Publishing here asks the author to attest that they hold
that right; the platform cannot verify it and does not claim to.
"""
import os
import hashlib
import logging
from typing import Optional

from config import BASE_DIR

PAPER_STORE_DIR = os.path.join(BASE_DIR, "paper_store")
os.makedirs(PAPER_STORE_DIR, exist_ok=True)

# A stored file is only ever useful alongside its assessment, and an assessment
# is refused above this size upstream, so anything larger here is a bug or an
# abuse attempt rather than a large paper.
MAX_STORED_BYTES = 40 * 1024 * 1024


def _path_for(eval_hash: str) -> Optional[str]:
    """Filesystem path for a hash, or None if the hash is not a plausible one.

    The hash reaches this module from a URL path segment. Validating its shape
    is what stops "../../etc/passwd" from being treated as an identifier —
    os.path.join would happily build that path otherwise.
    """
    h = (eval_hash or "").strip().lower()
    if len(h) != 64 or not all(c in "0123456789abcdef" for c in h):
        return None
    return os.path.join(PAPER_STORE_DIR, f"{h}.pdf")


def store_paper(raw: bytes) -> str:
    """Persist an uploaded manuscript. Returns its hash, or "" if not stored.

    Never raises: a failure to retain the file must not fail the assessment the
    user is paying for. It degrades to the previous behaviour — the paper is
    assessed, and there is simply no file to serve later.
    """
    if not raw or len(raw) > MAX_STORED_BYTES:
        return ""
    digest = hashlib.sha256(raw).hexdigest()
    path = _path_for(digest)
    if not path:
        return ""
    if os.path.exists(path):
        return digest              # identical upload; one copy is enough
    try:
        # Written to a temporary name and moved into place, so a crash midway
        # cannot leave a truncated PDF that looks like a complete one.
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, path)
        return digest
    except OSError as e:
        logging.warning("Could not store manuscript %s: %s", digest[:12], e)
        return ""


def paper_path(eval_hash: str) -> Optional[str]:
    """Path to a stored manuscript, or None when there is no file for it."""
    path = _path_for(eval_hash)
    if path and os.path.exists(path):
        return path
    return None


def has_paper(eval_hash: str) -> bool:
    return paper_path(eval_hash) is not None


def delete_paper(eval_hash: str) -> bool:
    """Remove a stored manuscript.

    Called when an assessment is withdrawn from the corpus. The ledger block is
    deliberately immutable, but the manuscript is not part of the ledger — a
    researcher who removes their paper expects the file to go with it, and
    keeping it would make "remove" mean something narrower than it says.
    """
    path = paper_path(eval_hash)
    if not path:
        return False
    try:
        os.remove(path)
        return True
    except OSError as e:
        logging.warning("Could not delete manuscript %s: %s", str(eval_hash)[:12], e)
        return False
