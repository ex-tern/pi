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
from typing import Callable, Iterable, Optional

from config import BASE_DIR

PAPER_STORE_DIR = os.path.join(BASE_DIR, "paper_store")
os.makedirs(PAPER_STORE_DIR, exist_ok=True)

# A stored file is only ever useful alongside its assessment, and an assessment
# is refused above this size upstream, so anything larger here is a bug or an
# abuse attempt rather than a large paper.
MAX_STORED_BYTES = 40 * 1024 * 1024


def _env_bytes(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


# Total budget for the whole store. Without one, retained manuscripts grew until
# they filled the production volume — and a full volume stops the database too.
# Override with PAPER_STORE_MAX_TOTAL_BYTES; 0 disables the cap.
MAX_TOTAL_BYTES = _env_bytes("PAPER_STORE_MAX_TOTAL_BYTES", 2 * 1024 * 1024 * 1024)

# The API registers a callable returning the hashes that still have an
# assessment. Eviction removes orphans first, and only then the oldest files.
_known_hashes: Optional[Callable[[], Iterable[str]]] = None


def set_known_hashes_provider(fn: Optional[Callable[[], Iterable[str]]]) -> None:
    global _known_hashes
    _known_hashes = fn


def _stored_files():
    """(name, size, mtime) for every stored PDF."""
    out = []
    try:
        names = os.listdir(PAPER_STORE_DIR)
    except OSError:
        return out
    for name in names:
        if not name.endswith(".pdf"):
            continue
        try:
            st = os.stat(os.path.join(PAPER_STORE_DIR, name))
        except OSError:
            continue
        out.append((name, st.st_size, st.st_mtime))
    return out


def total_bytes() -> int:
    return sum(size for _, size, _ in _stored_files())


def _make_room(incoming: int) -> int:
    """Evict until `incoming` more bytes fit under MAX_TOTAL_BYTES.

    Orphans (no assessment) go first, then the oldest files. Returns the number
    of files removed.
    """
    if not MAX_TOTAL_BYTES:
        return 0
    files = _stored_files()
    used = sum(size for _, size, _ in files)
    if used + incoming <= MAX_TOTAL_BYTES:
        return 0
    known = set()
    if _known_hashes:
        try:
            known = set(_known_hashes())
        except Exception as e:                                   # noqa: BLE001
            logging.warning("Could not list known assessments for eviction: %s", e)
    files.sort(key=lambda f: (f[0][:-4] in known, f[2], f[0]))
    removed = 0
    for name, size, _ in files:
        if used + incoming <= MAX_TOTAL_BYTES:
            break
        try:
            os.remove(os.path.join(PAPER_STORE_DIR, name))
        except OSError as e:
            logging.warning("Could not evict stored manuscript %s: %s", name, e)
            continue
        used -= size
        removed += 1
        logging.warning("Paper store over its %d-byte cap: evicted %s (%s)",
                        MAX_TOTAL_BYTES, name[:12],
                        "assessed" if name[:-4] in known else "orphan")
    return removed


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
    if MAX_TOTAL_BYTES and len(raw) > MAX_TOTAL_BYTES:
        return ""
    _make_room(len(raw))
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


def count_papers() -> int:
    """How many manuscripts are on disk.

    Used by the owner's reset preview, where the number of files is not
    derivable from the database: an assessment can exist without a stored file
    (papers submitted by DOI), and an orphaned file can outlive its row.
    """
    try:
        return sum(1 for name in os.listdir(PAPER_STORE_DIR) if name.endswith(".pdf"))
    except OSError:
        return 0


def clear_all() -> int:
    """Delete every stored manuscript. Returns the number removed.

    Only reachable from the owner reset, and only when the corpus itself is
    being wiped. Files are not rows: wiping `papers_assessment` while leaving
    the PDFs behind would leave a directory of manuscripts belonging to
    assessments that no longer exist, readable by anyone who could guess a
    hash — so the two have to be clearable together.

    Deletes only *.pdf inside the store, never the directory, so a
    misconfigured BASE_DIR cannot escalate into removing something else.
    """
    removed = 0
    try:
        names = os.listdir(PAPER_STORE_DIR)
    except OSError as e:
        logging.warning("Could not list the paper store: %s", e)
        return 0
    for name in names:
        if not name.endswith(".pdf"):
            continue
        try:
            os.remove(os.path.join(PAPER_STORE_DIR, name))
            removed += 1
        except OSError as e:
            logging.warning("Could not delete stored manuscript %s: %s", name, e)
    return removed
