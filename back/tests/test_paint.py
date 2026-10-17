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
    assert two.count("#1b1b1f") == 2 * one.count("#1b1b1f") > 0  # two dogs have twice the eyes of one
    assert "#05060f" in svg(api.paint_picture("a rocket in space"))  # the dark of space


def test_the_endpoint_paints_without_outside_models(monkeypatch):
    monkeypatch.delenv("PICTURE_ENGINE", raising=False)
    r = TestClient(api.app).post("/api/super/picture", json={"prompt": "an owl in the forest at night"})
    assert r.status_code == 200 and r.json()["image"].startswith("data:image/svg+xml")


def test_a_video_moves_and_a_picture_does_not():
    still, moving = svg(api.paint_picture("a fox in the snowy mountains")), svg(api.paint_picture("a fox in the snowy mountains", moving=True))
    assert "<animate" not in still and "<animate" in moving


def test_a_drawing_from_claude_is_made_safe():
    dirty = ('Here: <svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="10" height="10"/>'
             '<image href="https://evil.example/x.png"/>' + "<g/>" * 60 + '</svg> done')
    clean = api._svg_clean(dirty)
    assert clean.startswith("<svg") and clean.endswith("</svg>")
    assert "script" not in clean and "onclick" not in clean and "evil.example" not in clean


def test_the_video_endpoint_paints_without_claude(monkeypatch):
    monkeypatch.setattr(api, "ANTHROPIC_API_KEY", "")
    r = TestClient(api.app).post("/api/super/video", json={"prompt": "two cats in the rain"})
    assert r.status_code == 200 and "<animate" in svg(r.json()["video"])


def test_it_learns_a_word_from_its_teacher_and_draws_it_after(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "PAINT_DIR", str(tmp_path))
    monkeypatch.setattr(api, "ANTHROPIC_API_KEY", "test")
    assert "narwhal" in api.paint_unknown("a narwhal in the savanna at sunset")
    assert "sunset" not in api.paint_unknown("a narwhal at sunset") and "cat" not in api.paint_unknown("a cat")
    before = svg(api.paint_picture("a narwhal on the beach"))
    drawn = '<svg viewBox="0 0 200 200"><rect x="80" y="20" width="40" height="160" fill="#e8b04b"/>' + "<g/>" * 40 + "</svg>"
    monkeypatch.setattr(api, "claude_ask", lambda prompt, max_tokens=700: {"answer": drawn})
    got, tried = api.paint_train(["narwhals", "cat"])
    assert (got, tried) == (1, 1)                                   # the cat it knew already
    assert api.paint_learned("narwhal") and "narwhal" not in api.paint_unknown("a narwhal")
    after = svg(api.paint_picture("a narwhal on the beach"))
    assert "<image" in after and "<image" not in before
    assert after.count("<image") == 1 and svg(api.paint_picture("three narwhals on the beach")).count("<image") == 3


def test_it_shipped_knowing_its_starting_vocabulary():
    for w in ("giraffe", "castle", "octopus", "cactus", "penguins", "dragons"):
        assert api.paint_learned(w), w
    assert "<image" in svg(api.paint_picture("an octopus underwater"))
    assert svg(api.paint_picture("three dragons in space")).count("<image") == 3


def test_the_second_lesson_other_words_two_words_and_plurals():
    # every word it was taught has its drawing
    for w in api.PAINT_SEED_WORDS:
        assert api.paint_learned(w), w
    # other words, two words for one thing, plurals that are not just an s
    assert api.paint_learned_name("tv") == "television" and api.paint_learned_name("laptops") == "computer"
    assert api.paint_learned_name("wolves") == "wolf" and api.paint_learned_name("elves") == "elf"
    assert api.paint_learned_name("tomatoes") == "tomato" and api.paint_learned_name("shoes") == "shoe"
    assert api.paint_learned_name("glasses") == "glasses" and api.paint_learned_name("scissors") == "scissors"
    assert svg(api.paint_picture("a red fire truck in the city")).count("<image") == 1
    assert svg(api.paint_picture("a tv")).count("<image") == 1          # a tv is one, not a few
    assert svg(api.paint_picture("glasses on a table")).count("<image") == 1
    assert svg(api.paint_picture("wolves in the forest at night")).count("<image") >= 2
    # a shark is painted in its sea, without saying so
    sea = api._hsl(198, 70, 42)
    assert sea in svg(api.paint_picture("a shark")) and sea not in svg(api.paint_picture("a shark on the beach"))
    assert api.paint_unknown("a tiger and a laptop") == []
