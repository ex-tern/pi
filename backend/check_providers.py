"""
Why is only one model running?

Answers that question from the command line, without needing the server up or
the owner wallet connected (``/api/providers/status`` is owner-gated, which is
exactly the wrong thing to depend on when you are trying to work out why your
configuration isn't loading).

    python check_providers.py

Prints, for every provider: whether a key is present, where it came from
(process environment or backend/.env), and what it looks like — never the key
itself. Then lists which jurors can actually reach a model.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
# Capture the real environment BEFORE importing config, which merges .env in.
_REAL_ENV = set(os.environ)

import config  # noqa: E402
from providers import build_routes, provider_configuration  # noqa: E402

PROVIDER_KEYS = [
    ("GROQ_API_KEY", "Groq", "https://console.groq.com"),
    ("OR_API_KEY", "OpenRouter", "https://openrouter.ai/keys"),
    ("GEMINI_API_KEY", "Google Gemini", "https://aistudio.google.com/apikey"),
]


def describe(value):
    """A key fingerprint safe to paste into a bug report."""
    if value is None:
        return "not set"
    if value == "":
        return "SET BUT EMPTY  <- the line exists in .env with no value"
    shape = f"{len(value)} chars, starts {value[:4]!r}"
    problems = []
    if value != value.strip():
        problems.append("has surrounding whitespace")
    if "#" in value:
        problems.append("contains '#' — likely an inline comment was included")
    if value[0] in "'\"" or value[-1] in "'\"":
        problems.append("has a stray quote character")
    if " " in value:
        problems.append("contains a space — a key should not")
    return shape + ("  <- " + "; ".join(problems) if problems else "")


def main():
    print(f".env file: {_ENV_PATH}")
    print(f"  exists : {os.path.exists(_ENV_PATH)}\n")

    print("Provider keys")
    print("-" * 72)
    any_problem = False
    for var, label, url in PROVIDER_KEYS:
        raw = os.getenv(var)
        source = "process env" if var in _REAL_ENV else (".env file" if raw else "—")
        desc = describe(raw)
        if "<-" in desc or raw is None:
            any_problem = True
        print(f"  {label:16} {var:16} [{source:11}] {desc}")
        if raw is None:
            print(f"  {'':16} {'':16} get one free at {url}")

    print("\nJurors")
    print("-" * 72)
    for juror in ("llama", "mistral", "qwen", "gemini", "deepseek"):
        routes = build_routes(juror)
        if routes:
            vendors = sorted({r["provider"] for r in routes})
            print(f"  {juror:10} {len(routes)} route(s) via {', '.join(vendors)}")
        else:
            print(f"  {juror:10} NO ROUTES — no key configured for any provider it can use")

    try:
        advice = provider_configuration().get("advice") or []
    except Exception:
        advice = []
    if advice:
        print("\nAdvice")
        print("-" * 72)
        for a in advice:
            print(f"  - {a}")

    if any_problem:
        print("\nNote: a key that is present but malformed fails authentication silently —")
        print("the juror is simply skipped, with no missing-key warning anywhere.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
