"""
Anti-cheat tests for the Science Map arcade.

The arcade grants real assessment allowance, so these tests are the guard rail
on a credit faucet. Every case below is an attack that would otherwise mint
free compute, and each must be rejected by the server's replay rather than by
anything in the browser.
"""
import pytest

import arcade


IP = "203.0.113.5"


def _session():
    return arcade.start_session(IP)


def _optimal_run(field, gap_ms=arcade.MIN_EAT_INTERVAL_MS + 5):
    """The run an ideal player produces: smallest field first, until victory."""
    mass = arcade.START_MASS
    run, t = [], 0
    for bubble in sorted(field, key=lambda b: b["mass"]):
        if bubble["mass"] >= mass:
            continue
        t += gap_ms
        run.append({"id": bubble["id"], "t": t})
        mass += bubble["mass"] * arcade.ABSORB_RATIO
        if mass >= arcade.WIN_MASS:
            break
    return run, t, mass


# --- The field must be reproducible, or honest runs fail ------------------

def test_field_is_deterministic_for_a_seed():
    session = _session()
    assert arcade.generate_field(session["seed"]) == session["field"]


def test_opening_is_always_playable():
    """A seed that spawns no edible bubble would be an unwinnable run."""
    for _ in range(25):
        field = _session()["field"]
        edible = [b for b in field if b["mass"] < arcade.START_MASS]
        assert edible, "seed produced a field with nothing the player can eat"


# --- The honest path ------------------------------------------------------

def test_honest_winning_run_is_accepted():
    session = _session()
    run, duration, _ = _optimal_run(session["field"])
    result = arcade.verify_run(IP, session["token"], run, duration + 50)
    assert result["valid"] and result["won"]


def test_partial_run_is_valid_but_does_not_win():
    session = _session()
    run, duration, _ = _optimal_run(session["field"])
    result = arcade.verify_run(IP, session["token"], run[:3], duration + 50)
    assert result["valid"] is True
    assert result["won"] is False


# --- Attacks --------------------------------------------------------------

def test_cannot_absorb_a_bubble_larger_than_the_player():
    session = _session()
    biggest = max(session["field"], key=lambda b: b["mass"])
    result = arcade.verify_run(IP, session["token"], [{"id": biggest["id"], "t": 100}], 5000)
    assert result["valid"] is False


def test_cannot_absorb_the_same_bubble_repeatedly():
    session = _session()
    smallest = min(session["field"], key=lambda b: b["mass"])
    run = [{"id": smallest["id"], "t": i * 200} for i in range(60)]
    result = arcade.verify_run(IP, session["token"], run, 20_000)
    assert result["valid"] is False


def test_cannot_invent_a_bubble():
    session = _session()
    result = arcade.verify_run(IP, session["token"], [{"id": 99999, "t": 100}], 5000)
    assert result["valid"] is False


def test_rejects_a_tampered_token():
    session = _session()
    forged = session["token"][:-4] + "AAAA"
    run, duration, _ = _optimal_run(session["field"])
    result = arcade.verify_run(IP, forged, run, duration + 50)
    assert result["valid"] is False


def test_token_is_bound_to_the_issuing_client():
    session = _session()
    run, duration, _ = _optimal_run(session["field"])
    result = arcade.verify_run("198.51.100.9", session["token"], run, duration + 50)
    assert result["valid"] is False


def test_rejects_superhuman_absorption_rate():
    session = _session()
    run, _, _ = _optimal_run(session["field"], gap_ms=5)
    result = arcade.verify_run(IP, session["token"], run, 5000)
    assert result["valid"] is False


def test_rejects_a_win_claimed_faster_than_physically_possible():
    """Guards against replaying a valid event list with a collapsed clock."""
    session = _session()
    run, _, _ = _optimal_run(session["field"])
    result = arcade.verify_run(IP, session["token"], run, 100)
    assert result["valid"] is False


def test_rejects_absurd_duration():
    session = _session()
    result = arcade.verify_run(IP, session["token"], [], arcade.MAX_RUN_MS + 1)
    assert result["valid"] is False


@pytest.mark.parametrize("payload", [
    "not-a-list",
    [{"id": "abc", "t": 1}],
    [{"nope": 1}],
    [None],
])
def test_malformed_run_data_is_rejected_not_crashed(payload):
    session = _session()
    result = arcade.verify_run(IP, session["token"], payload, 5000)
    assert result["valid"] is False


def test_cannot_claim_more_absorptions_than_the_field_holds():
    session = _session()
    run = [{"id": i % arcade.FIELD_SIZE, "t": i * 200} for i in range(arcade.FIELD_SIZE + 10)]
    result = arcade.verify_run(IP, session["token"], run, 60_000)
    assert result["valid"] is False
