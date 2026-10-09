"""lab.py -- the Lab: other projects, hosted inside ScholarPi.

Two kinds of project live in the Lab tab.

PUBLIC projects ship with the site. HAL-OS is one: its boot image is built from
its own repository at deploy time (scripts/build_hal.py) and booted in the
visitor's browser. Nothing about them needs the server beyond static files, so
nothing about them is here.

PRIVATE projects are personal material -- a study plan, grades, draft letters
-- that the owner wants alongside everything else, and that nobody else may
see. They are handled here, and the rules are deliberately narrow:

  * They are never in the repository. The ScholarPi repository is public, so a
    file committed to it is published no matter what the UI does. Private
    files live under PRIVATE_PROJECTS_DIR -- by default a folder in the data
    volume, next to the database -- and reach it by owner upload.
  * Every read and write is behind require_owner(), i.e. a session minted only
    after an EIP-191 signature from the owner wallet. Knowing the owner's
    address (which is public) gets nothing.
  * Responses are no-store. A private file must not sit in a shared cache, or
    in the browser's HTTP cache after sign-out.
  * HTML is served as text and the frontend renders it in a sandboxed iframe
    WITHOUT allow-same-origin. A page uploaded here can run its own scripts but
    cannot read this site's localStorage, where the session token lives.

Layout on disk:

    PRIVATE_PROJECTS_DIR/
        graduation-plan/
            Road-to-Graduation.html
            libretto.csv
            ...
"""

import json
import os
import re
import time
from typing import Callable, List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()\-]{0,95}$")
PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,47}$")

# What a private project may contain. Text-like formats only: the Lab displays
# these, it is not a general file store, and refusing executables and archives
# here is cheaper than reasoning about them later.
TYPES = {
    ".html": "text/plain; charset=utf-8",    # rendered by the frontend, sandboxed
    ".htm": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/plain; charset=utf-8",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES_PER_PROJECT = 50

PRIVATE_HEADERS = {
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "X-Robots-Tag": "noindex",
}


def private_root(base_dir: str) -> str:
    explicit = os.getenv("PRIVATE_PROJECTS_DIR", "").strip()
    return os.path.abspath(os.path.expanduser(explicit)) if explicit \
        else os.path.join(base_dir, "private_projects")


def _check_project(project: str) -> str:
    if not PROJECT_RE.match(project or ""):
        raise HTTPException(status_code=400, detail="Invalid project name.")
    return project


def _check_name(name: str) -> str:
    if not NAME_RE.match(name or "") or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid file name.")
    ext = os.path.splitext(name)[1].lower()
    if ext not in TYPES:
        raise HTTPException(status_code=415,
                            detail="Allowed types: " + ", ".join(sorted(TYPES)))
    return name


def _inside(root: str, *parts: str) -> str:
    """Join and prove the result is still under root, after symlinks."""
    path = os.path.realpath(os.path.join(root, *parts))
    real_root = os.path.realpath(root)
    if path != real_root and not path.startswith(real_root + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path.")
    return path


def build_router(base_dir: str, require_owner: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/lab/private", tags=["lab"])

    def root() -> str:
        return private_root(base_dir)

    @router.get("")
    def list_private(request: Request):
        """Private projects and their files. Owner only."""
        require_owner(request)
        r = root()
        projects: List[dict] = []
        if os.path.isdir(r):
            for project in sorted(os.listdir(r)):
                pdir = os.path.join(r, project)
                if not PROJECT_RE.match(project) or not os.path.isdir(pdir):
                    continue
                files = []
                for name in sorted(os.listdir(pdir)):
                    fpath = os.path.join(pdir, name)
                    if (os.path.isfile(fpath) and NAME_RE.match(name)
                            and os.path.splitext(name)[1].lower() in TYPES):
                        st = os.stat(fpath)
                        files.append({"name": name, "bytes": st.st_size,
                                      "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                                time.gmtime(st.st_mtime))})
                projects.append({"id": project, "files": files})
        return Response(content=json.dumps({"projects": projects}),
                        media_type="application/json", headers=PRIVATE_HEADERS)

    @router.get("/{project}/{name}")
    def read_private(project: str, name: str, request: Request):
        require_owner(request)
        _check_project(project)
        _check_name(name)
        path = _inside(root(), project, name)
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="No such file.")
        with open(path, "rb") as fh:
            data = fh.read()
        ext = os.path.splitext(name)[1].lower()
        return Response(content=data, media_type=TYPES[ext], headers=PRIVATE_HEADERS)

    @router.put("/{project}/{name}")
    async def write_private(project: str, name: str, request: Request,
                            file: UploadFile = File(...)):
        """Add or replace one file. Owner only."""
        require_owner(request)
        _check_project(project)
        _check_name(name)
        data = await file.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="File too large (10 MB max).")
        pdir = _inside(root(), project)
        os.makedirs(pdir, mode=0o700, exist_ok=True)
        existing = [n for n in os.listdir(pdir) if os.path.isfile(os.path.join(pdir, n))]
        if name not in existing and len(existing) >= MAX_FILES_PER_PROJECT:
            raise HTTPException(status_code=409, detail="Too many files in this project.")
        path = _inside(root(), project, name)
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        return Response(content='{"ok": true}', media_type="application/json",
                        headers=PRIVATE_HEADERS)

    @router.delete("/{project}/{name}")
    def delete_private(project: str, name: str, request: Request):
        require_owner(request)
        _check_project(project)
        _check_name(name)
        path = _inside(root(), project, name)
        if os.path.isfile(path):
            os.remove(path)
        return Response(content='{"ok": true}', media_type="application/json",
                        headers=PRIVATE_HEADERS)

    return router
