"""The paper store's total cap: oldest-first eviction, orphans before assessed files."""

import hashlib
import os

import pytest

import paper_store


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(paper_store, "PAPER_STORE_DIR", str(tmp_path))
    monkeypatch.setattr(paper_store, "MAX_TOTAL_BYTES", 300)
    monkeypatch.setattr(paper_store, "_known_hashes", None)
    return tmp_path


def _put(raw: bytes, mtime: float) -> str:
    h = paper_store.store_paper(raw)
    assert h == hashlib.sha256(raw).hexdigest()
    os.utime(paper_store.paper_path(h), (mtime, mtime))
    return h


def test_under_the_cap_nothing_is_evicted(store):
    a = _put(b"a" * 100, 1)
    b = _put(b"b" * 100, 2)
    assert paper_store.has_paper(a) and paper_store.has_paper(b)
    assert paper_store.total_bytes() == 200


def test_oldest_file_is_evicted_first(store):
    a = _put(b"a" * 100, 1)
    b = _put(b"b" * 100, 2)
    c = _put(b"c" * 100, 3)
    d = _put(b"d" * 100, 4)
    assert not paper_store.has_paper(a)
    assert all(paper_store.has_paper(h) for h in (b, c, d))
    assert paper_store.total_bytes() <= 300


def test_orphans_go_before_assessed_files(store):
    a = _put(b"a" * 100, 1)        # oldest, but assessed
    b = _put(b"b" * 100, 2)        # orphan
    c = _put(b"c" * 100, 3)
    paper_store.set_known_hashes_provider(lambda: {a, c})
    d = _put(b"d" * 100, 4)
    assert paper_store.has_paper(a)
    assert not paper_store.has_paper(b)
    assert paper_store.has_paper(c) and paper_store.has_paper(d)


def test_a_file_larger_than_the_cap_is_refused_without_evicting(store):
    a = _put(b"a" * 100, 1)
    assert paper_store.store_paper(b"x" * 301) == ""
    assert paper_store.has_paper(a)


def test_a_broken_provider_still_evicts_oldest(store):
    a = _put(b"a" * 150, 1)
    paper_store.set_known_hashes_provider(lambda: 1 / 0)
    b = _put(b"b" * 200, 2)
    assert not paper_store.has_paper(a) and paper_store.has_paper(b)


def test_zero_disables_the_cap(store, monkeypatch):
    monkeypatch.setattr(paper_store, "MAX_TOTAL_BYTES", 0)
    hashes = [_put(bytes([i]) * 200, i) for i in range(1, 4)]
    assert all(paper_store.has_paper(h) for h in hashes)
