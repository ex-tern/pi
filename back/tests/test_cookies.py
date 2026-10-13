"""The visitor's privacy choices (cookies.py): reading pi_consent, and which requests a decline stops."""
import api as ck


class Req:
    def __init__(self, cookie=None):
        self.cookies = {} if cookie is None else {"pi_consent": cookie}


def test_parse():
    assert ck.parse("v1.c1.l0.e1") == {"count": True, "learn": False, "ext": True}
    assert ck.parse("v1.c0.l0.e0") == {"count": False, "learn": False, "ext": False}
    assert ck.parse("") is None and ck.parse(None) is None
    assert ck.parse("v0.c1.l1.e1") is None                 # an older notice: asked again
    assert ck.parse("v1.zz") == {"count": False, "learn": False, "ext": False}


def test_declined_only_when_the_cookie_says_no():
    assert ck.declined(Req("v1.c0.l1.e1"), "count")
    assert not ck.declined(Req("v1.c1.l1.e1"), "count")
    assert not ck.declined(Req(), "ext")                    # no cookie: the server does not guess


def test_rules():
    assert ck.rule_for("POST", "/api/visit") == ("count", "skip")
    assert ck.rule_for("POST", "/api/pien/learn") == ("learn", "skip")
    assert ck.rule_for("POST", "/api/assess/stream") == ("ext", "refuse")
    assert ck.rule_for("POST", "/api/super/panel") == ("ext", "refuse")
    assert ck.rule_for("POST", "/api/super/weigh") == ("ext", "refuse")
    assert ck.rule_for("POST", "/api/assessments/abc/review/llm") == ("ext", "refuse")
    assert ck.rule_for("GET", "/api/assessments/recent") is None    # reading is not using AI
    assert ck.rule_for("POST", "/api/super/ask") is None            # our own engines only
    assert ck.rule_for("GET", "/api/visit") is None


def test_outside_engines():
    assert ck.outside_engine("Gemini") and ck.outside_engine("judge")
    assert not ck.outside_engine("sim") and not ck.outside_engine("pien")


def test_info_lists_what_the_site_uses():
    i = ck.info(Req("v1.c1.l0.e0"))
    assert i["cookie"] == "pi_consent" and i["choice"] == {"count": True, "learn": False, "ext": False}
    assert {c["name"] for c in i["cookies"]} >= {"pi_consent", "pi_gate"}
    assert all(c["essential"] for c in i["cookies"])          # no tracking or advertising cookies
