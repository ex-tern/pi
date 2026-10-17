"""Files sent to Super AI (owner, 2026-10-17: "add a file, send a file capability to the AI"): their text is read, and
it goes with the question."""
import io
import os
import tempfile
import zipfile

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402

c = TestClient(api.app)


def test_text_file_is_read():
    r = c.post("/api/super/attach", files={"file": ("note.txt", b"piX rose by 12 percent.", "text/plain")})
    assert r.status_code == 200 and r.json()["text"] == "piX rose by 12 percent." and r.json()["name"] == "note.txt"


def test_word_document_is_read():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("word/document.xml", "<w:document><w:body><w:p><w:t>Hello</w:t></w:p><w:p><w:t>World</w:t></w:p></w:body></w:document>")
    r = c.post("/api/super/attach", files={"file": ("a.docx", b.getvalue(), "application/octet-stream")})
    assert r.status_code == 200 and r.json()["text"].split() == ["Hello", "World"]


def test_binary_is_refused():
    r = c.post("/api/super/attach", files={"file": ("x.bin", b"\x00\x01\x02" * 50, "application/octet-stream")})
    assert r.status_code == 415


def test_files_go_with_the_question():
    block = api.attached_block([{"name": "n.txt", "text": "the answer is 42"}])
    assert "n.txt" in block and "the answer is 42" in block
    assert api.attached_block([]) == ""


def test_chat_remembers_and_site_learned_is_served():
    h = api.history_block([{"q": "What is piX?", "a": "An index."}, {"q": "", "a": "skipped"}])
    assert "What is piX?" in h and "An index." in h and "skipped" not in h
    assert api.history_block([]) == ""
    r = c.get("/api/super/learned")
    assert r.status_code == 200 and isinstance(r.json()["text"], str)


def test_claude_without_credits_still_gets_an_answer(monkeypatch):
    monkeypatch.setattr(api, "ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(api, "claude_ask", lambda p, max_tokens=700: {"failed": "Claude: Your credit balance is too low"})
    monkeypatch.setattr(api, "_super_route_call", lambda j, p, routes: {"answer": "Paris.", "model": "other"})
    monkeypatch.setattr(api, "_super_juror_ready", lambda j: j != "claude")
    api._claude_ws.pop("down_until", None)
    r = api._super_ask_juror("claude", "capital of France?")
    assert r["answer"] == "Paris." and "Claude unavailable" in r["model"]
    api._claude_ws.pop("down_until", None)
