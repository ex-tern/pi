"""piii Paint, the site's own picture maker (owner, 2026-10-17: "make a homegrown picture generative LLM"): a picture of
the words, the same each time for the same words, made here with no outside service."""
import base64
import os
import tempfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402


def svg(url):
    assert url.startswith("data:image/svg+xml;base64,")
    return base64.b64decode(url.split(",", 1)[1]).decode()


def test_same_words_same_picture_and_different_words_differ():
    a, b = api.paint_picture("a cat in a garden"), api.paint_picture("a cat in a garden")
    assert a == b
    assert api.paint_picture("a fox in the snowy mountains") != a
    s = svg(a)
    assert s.startswith("<svg") and s.endswith("</svg>")


def test_it_draws_what_is_asked():
    two = svg(api.paint_picture("two dogs on the beach at sunset"))
    one = svg(api.paint_picture("a dog on the beach at sunset"))
    assert two.count("<ellipse") > one.count("<ellipse")       # two dogs are more shapes than one
    assert "#05060f" in svg(api.paint_picture("a rocket in space"))  # the dark of space


def test_the_endpoint_paints_without_outside_models(monkeypatch):
    monkeypatch.delenv("PICTURE_ENGINE", raising=False)
    r = TestClient(api.app).post("/api/super/picture", json={"prompt": "an owl in the forest at night"})
    assert r.status_code == 200 and r.json()["image"].startswith("data:image/svg+xml")
