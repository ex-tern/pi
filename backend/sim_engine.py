"""
siM — the SciLM learning engine.

SciLM (siM)'s learned calibration.

What this actually is
---------------------
SciLM (siM) measures four deterministic structural signals in a manuscript — MDAR
adherence, empirical density, reproducibility markers, and RRID coverage — and
combines them into one structural-quality score. Those four signals are NOT
learned and must never become learned: they are reproducible measurements, and
their value to the framework is precisely that they are auditable and identical
for identical input.

What is learned is how to *weigh* them. The original weights (0.35 / 0.30 /
0.25 / 0.10) were assumed at authoring time and never revisited, so SciLM (siM)'s
composite was an opinion about the relative importance of four measurements,
frozen before a single paper had been assessed. This module replaces that fixed
opinion with a five-parameter linear model (four weights and a bias) fitted
online against evidence.

Why a five-parameter linear model and nothing larger
----------------------------------------------------
Because the training set is a few dozen papers, and it grows by one per
assessment. Anything with more capacity than this would memorise the corpus
rather than learn from it, and would need a training loop, a validation split
and a GPU budget that this deployment does not have. A linear model over four
bounded inputs can be printed in full, checked by hand, and explained to a
reviewer — which matters more here than accuracy, because the output feeds a
research-assessment score that people are expected to trust.

The two teachers, and why they are not treated equally
------------------------------------------------------
1. **Panel consensus** (automatic). After each assessment the LLM panel returns
   a verdict. Where several *independent* jurors corroborate each other, that
   verdict is a usable target for what SciLM (siM) should have said.

   This is gated hard. Learning from a one-juror verdict would not teach SciLM (siM)
   about research quality, it would teach SciLM (siM) to imitate whichever model
   happened to answer — and since every juror chain now falls back to a shared
   Llama, "four jurors agreed" can mean one model voting four times. So the
   consensus signal is only accepted when at least MIN_INDEPENDENT_SOURCES
   genuinely distinct routes contributed. Correlated agreement is not evidence.

2. **User correction** (explicit). A human saying "this score is wrong, it
   should be X" is a stronger signal than model agreement, and is weighted
   accordingly — but it is also the signal most open to abuse, so corrections
   are bounded per paper and the learning rate is still capped.

Safeguards
----------
Every update is bounded, weights are held non-negative and renormalised to sum
to 1, and the whole history is retained so any state can be recomputed from
scratch and audited. `reset()` restores the authored defaults. A model that
cannot be explained or rolled back has no business scoring research.
"""
import json
import logging
import threading
from typing import Dict, List, Optional

# The four measured signals, in a fixed order. Order matters because it is the
# serialisation order of the stored weight vector.
SIGNAL_KEYS = ("mdar", "density", "repro", "rrid")

# The authored starting point. These are a prior, not ground truth — which is
# the whole reason this module exists.
DEFAULT_WEIGHTS = {"mdar": 0.35, "density": 0.30, "repro": 0.25, "rrid": 0.10}
DEFAULT_BIAS = 0.0

# Learning rates. Deliberately small: the target is noisy (an LLM panel's view
# of quality), and a large step would let one unusual paper swing the weighting
# for every paper after it.
# Calibrated by simulation rather than intuition. At 0.015 the model moved
# only 0.35 -> 0.38 over 60 observations when the true weight was 0.75 — on a
# corpus that grows by one paper per assessment, that is indistinguishable
# from not learning at all, and a learning system nobody can see learn is one
# nobody has reason to trust. 0.03 roughly doubles adaptation while staying
# far inside the MAX_STEP clamp, so a single unusual paper still cannot swing
# the weighting.
LR_CONSENSUS = 0.03
LR_FEEDBACK = 0.06

# Consensus is only a teacher when it is actually corroborated. Below this,
# the "panel verdict" may be a single model's opinion wearing a panel's label.
MIN_INDEPENDENT_SOURCES = 2

# No single update may move a weight by more than this, whatever the error.
MAX_STEP = 0.05

# How many recent observations the learned model is judged over, and by how
# much it must be worse than the authored defaults before it is suspended.
# The margin exists so that noise cannot trip the breaker; the window exists so
# that a handful of unusual manuscripts cannot either.
EVAL_WINDOW = 25
# Matched to the threshold `status()` uses to call the model "worse than
# defaults". They were 10% and 5%, so there was a band where the status
# endpoint reported the learned weighting as worse while the scorer went on
# using it — a system telling you it is broken and not acting on it is worse
# than one that stays quiet, because it trains you to ignore the warning.
# Hysteresis lives on the reinstate side instead: suspension lifts only once
# learning is genuinely ahead again, so this cannot flap.
SUSPEND_MARGIN = 0.05
# Weights are held above zero so a signal can be de-emphasised but never
# switched off entirely — a zero weight would silently stop measuring
# something the rubric claims to measure.
MIN_WEIGHT = 0.02

_lock = threading.Lock()
_cached_state: Optional[Dict] = None


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
def default_state() -> Dict:
    return {
        "weights": dict(DEFAULT_WEIGHTS),
        "bias": DEFAULT_BIAS,
        "observations": 0,
        "consensus_observations": 0,
        "feedback_observations": 0,
        "mean_abs_error": None,
        "recent_errors": [],
        # The counterfactual: what the error WOULD have been under the
        # authored defaults, recorded on the same observations. Without this,
        # "mean absolute error 0.14" is unreadable — there is nothing to
        # compare it against, and a model that has learned its way to being
        # worse looks identical to one that has learned nothing.
        "baseline_errors": [],
        "baseline_mean_abs_error": None,
        # Set when learning is measurably worse than the defaults over a full
        # evaluation window. Predictions then fall back to the defaults until
        # the evidence changes.
        "suspended": False,
        "suspended_reason": "",
    }


def load_state() -> Dict:
    """Current learned state, from the database, cached in-process."""
    global _cached_state
    with _lock:
        if _cached_state is not None:
            return json.loads(json.dumps(_cached_state))
    try:
        from database import get_scilem_state
        stored = get_scilem_state()
    except Exception as e:
        logging.warning("Could not load SciLM (siM) state, using defaults: %s", e)
        stored = None

    state = stored or default_state()
    # A stored state from an older schema may be missing keys; fill them rather
    # than failing, so a deploy never wipes learned weights.
    base = default_state()
    for key, value in base.items():
        state.setdefault(key, value)
    for key in SIGNAL_KEYS:
        state["weights"].setdefault(key, DEFAULT_WEIGHTS[key])

    with _lock:
        _cached_state = state
    return json.loads(json.dumps(state))


def save_state(state: Dict) -> None:
    global _cached_state
    with _lock:
        _cached_state = json.loads(json.dumps(state))
    try:
        from database import save_scilem_state
        save_scilem_state(state)
    except Exception as e:
        # A failed write must not lose the in-process value, or the next
        # assessment would silently learn from stale weights.
        logging.warning("Could not persist SciLM (siM) state: %s", e)


def reset() -> Dict:
    """Restore the authored defaults and forget everything learned."""
    state = default_state()
    save_state(state)
    try:
        from database import clear_scilem_observations
        clear_scilem_observations()
    except Exception as e:
        logging.warning("Could not clear SciLM (siM) observations: %s", e)
    return state


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------
def normalise_weights(weights: Dict[str, float]) -> Dict[str, float]:
    """Non-negative, floored, and summing to 1.

    Renormalising keeps the composite on a 0-1 scale regardless of how the
    weights drift, so a learned state can never silently change the range of
    the score it produces.
    """
    clipped = {k: max(MIN_WEIGHT, float(weights.get(k, DEFAULT_WEIGHTS[k]))) for k in SIGNAL_KEYS}
    total = sum(clipped.values())
    if total <= 0:
        return dict(DEFAULT_WEIGHTS)
    return {k: v / total for k, v in clipped.items()}


def predict(signals: Dict[str, float], state: Optional[Dict] = None,
            force_defaults: bool = False) -> float:
    """Structural quality in [0, 1] from the four measured signals.

    Falls back to the authored defaults while learning is suspended. A model
    that has demonstrably made itself worse should stop being used — silently
    continuing to apply it, on the grounds that it is the newer number, is how
    a learning system degrades a working heuristic.
    """
    state = state or load_state()
    if force_defaults or state.get("suspended"):
        weights = dict(DEFAULT_WEIGHTS)
        bias = DEFAULT_BIAS
        value = bias
        for key in SIGNAL_KEYS:
            value += weights[key] * float(signals.get(key, 0.0) or 0.0)
        return round(min(1.0, max(0.0, value)), 6)
    weights = normalise_weights(state["weights"])
    value = float(state.get("bias", 0.0))
    for key in SIGNAL_KEYS:
        value += weights[key] * float(signals.get(key, 0.0) or 0.0)
    return round(min(1.0, max(0.0, value)), 6)


# ---------------------------------------------------------------------------
# Learning
# ---------------------------------------------------------------------------
def observe(signals: Dict[str, float], target: float, source: str = "consensus",
            independent_sources: int = 0, eval_hash: str = "") -> Dict:
    """One gradient step toward `target`.

    Returns a report describing what happened, including the case where
    nothing happened — a silent no-op here would make the learning loop
    impossible to debug, since "the weights did not move" and "the update was
    rejected" look identical from the outside.
    """
    state = load_state()

    try:
        target = float(target)
    except (TypeError, ValueError):
        return {"learned": False, "reason": "Target is not numeric."}
    if not (0.0 <= target <= 1.0):
        return {"learned": False, "reason": "Target is outside the 0-1 range."}

    if source == "consensus" and independent_sources < MIN_INDEPENDENT_SOURCES:
        # The single most important guard in this module.
        return {
            "learned": False,
            "reason": (
                f"Consensus was backed by {independent_sources} independent source(s); "
                f"{MIN_INDEPENDENT_SOURCES} are required. Learning from an uncorroborated "
                f"verdict would teach SciLM (siM) to imitate one model, not to assess research."
            ),
        }

    lr = LR_FEEDBACK if source == "feedback" else LR_CONSENSUS
    predicted = predict(signals, state)
    error = target - predicted

    # Score the same observation under the authored defaults, before any
    # update. This is the control condition, and it is what makes the claim
    # "SciLM (siM) is learning" checkable rather than asserted.
    baseline_predicted = predict(signals, state, force_defaults=True)
    baseline_error = target - baseline_predicted

    # Squared-error gradient for a linear model: d/dw_i = -error * x_i.
    weights = dict(state["weights"])
    for key in SIGNAL_KEYS:
        x = float(signals.get(key, 0.0) or 0.0)
        step = lr * error * x
        step = max(-MAX_STEP, min(MAX_STEP, step))
        weights[key] = weights[key] + step
    state["weights"] = normalise_weights(weights)

    bias_step = max(-MAX_STEP, min(MAX_STEP, lr * error * 0.5))
    state["bias"] = round(max(-0.25, min(0.25, state.get("bias", 0.0) + bias_step)), 6)

    state["observations"] = int(state.get("observations", 0)) + 1
    if source == "feedback":
        state["feedback_observations"] = int(state.get("feedback_observations", 0)) + 1
    else:
        state["consensus_observations"] = int(state.get("consensus_observations", 0)) + 1

    # Rolling calibration error, measured BEFORE the update — this is the
    # honest number, because measuring after would report how well the model
    # fits a point it has just been fitted to.
    errors = list(state.get("recent_errors") or [])
    errors.append(round(abs(error), 5))
    errors = errors[-EVAL_WINDOW:]
    state["recent_errors"] = errors
    state["mean_abs_error"] = round(sum(errors) / len(errors), 5)

    base_errors = list(state.get("baseline_errors") or [])
    base_errors.append(round(abs(baseline_error), 5))
    base_errors = base_errors[-EVAL_WINDOW:]
    state["baseline_errors"] = base_errors
    state["baseline_mean_abs_error"] = round(sum(base_errors) / len(base_errors), 5)

    # Suspend only on a full window of evidence and a margin that a handful of
    # unusual papers cannot manufacture. Reinstate the moment learning is
    # ahead again — this is a circuit breaker, not a verdict.
    if len(errors) >= EVAL_WINDOW:
        learned_mae = state["mean_abs_error"]
        default_mae = state["baseline_mean_abs_error"]
        if learned_mae > default_mae * (1.0 + SUSPEND_MARGIN):
            state["suspended"] = True
            state["suspended_reason"] = (
                f"Learned weighting is predicting worse than the authored defaults over the last "
                f"{len(errors)} observations ({learned_mae:.3f} vs {default_mae:.3f} mean "
                f"absolute error). Predictions have reverted to the defaults; learning continues "
                f"in the background and will resume automatically if it overtakes them."
            )
        elif state.get("suspended") and learned_mae <= default_mae:
            state["suspended"] = False
            state["suspended_reason"] = ""

    save_state(state)

    try:
        from database import record_scilem_observation
        record_scilem_observation(signals, predicted, target, source, eval_hash)
    except Exception as e:
        logging.debug("SciLM (siM) observation not recorded: %s", e)

    return {
        "learned": True, "source": source,
        "predicted": predicted, "target": round(target, 5),
        "error": round(error, 5),
        "weights": state["weights"], "bias": state["bias"],
        "observations": state["observations"],
        "mean_abs_error": state["mean_abs_error"],
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def status() -> Dict:
    """A full, human-readable account of what SciLM (siM) has learned."""
    state = load_state()
    weights = normalise_weights(state["weights"])
    drift = {k: round(weights[k] - DEFAULT_WEIGHTS[k], 4) for k in SIGNAL_KEYS}
    n = int(state.get("observations", 0))

    learned_mae = state.get("mean_abs_error")
    default_mae = state.get("baseline_mean_abs_error")
    window = len(state.get("recent_errors") or [])

    # Is learning actually helping? Stated as a comparison against the control,
    # never as a bare error figure — an error with nothing to compare it to
    # cannot be judged, and a model that has learned its way to being worse
    # would read exactly like one that had improved.
    verdict, improvement = "unknown", None
    if learned_mae is not None and default_mae not in (None, 0):
        improvement = round((default_mae - learned_mae) / default_mae * 100.0, 1)
        # A 5% band, not 2%. Simulation with the defaults set to the exact
        # truth still produced a 2.3% "improvement" from noise alone, and
        # claiming to have learned something when nothing was learnable is the
        # one failure this whole comparison exists to prevent.
        if window < 10:
            verdict = "too early to say"
        elif improvement > 5.0:
            verdict = "better than defaults"
        elif improvement < -5.0:
            verdict = "worse than defaults"
        else:
            verdict = "no better than defaults"

    if n == 0:
        summary = ("SciLM (siM) is running on its authored default weighting. It has not yet observed "
                   "a corroborated assessment, so nothing has been learned.")
    else:
        moved = max(drift, key=lambda k: abs(drift[k]))
        direction = "up" if drift[moved] > 0 else "down"
        summary = (
            f"Learned from {n} observation{'s' if n != 1 else ''} "
            f"({state.get('consensus_observations', 0)} from panel consensus, "
            f"{state.get('feedback_observations', 0)} from user corrections). "
            f"The largest shift is {moved}, weighted {direction} by "
            f"{abs(drift[moved]):.3f} from its authored default."
        )
        if learned_mae is not None and default_mae is not None:
            summary += (
                f" Over the last {window} observation{'s' if window != 1 else ''} the learned "
                f"weighting is off by {learned_mae:.3f} on average against {default_mae:.3f} for "
                f"the authored defaults"
            )
            if improvement is not None:
                summary += (f" — {abs(improvement):.1f}% "
                            f"{'better' if improvement > 0 else 'worse'}.")
            else:
                summary += "."
        if state.get("suspended"):
            summary += " " + state.get("suspended_reason", "")

    return {
        "weights": {k: round(weights[k], 4) for k in SIGNAL_KEYS},
        "default_weights": dict(DEFAULT_WEIGHTS),
        "drift": drift,
        "bias": state.get("bias", 0.0),
        "observations": n,
        "consensus_observations": state.get("consensus_observations", 0),
        "feedback_observations": state.get("feedback_observations", 0),
        "mean_abs_error": state.get("mean_abs_error"),
        "baseline_mean_abs_error": state.get("baseline_mean_abs_error"),
        "improvement_pct": improvement,
        "verdict": verdict,
        "evaluated_over": window,
        "suspended": bool(state.get("suspended")),
        "suspended_reason": state.get("suspended_reason", ""),
        "active_weighting": "authored defaults" if state.get("suspended") else "learned",
        "learning": n > 0,
        "summary": summary,
        "policy": {
            "min_independent_sources": MIN_INDEPENDENT_SOURCES,
            "consensus_learning_rate": LR_CONSENSUS,
            "feedback_learning_rate": LR_FEEDBACK,
            "note": ("Only the WEIGHTING of the four structural signals is learned. The signals "
                     "themselves (MDAR, empirical density, reproducibility markers, RRID "
                     "coverage) are deterministic measurements and are never adjusted."),
        },
    }
