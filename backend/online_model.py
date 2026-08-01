"""Bounded online linear learning, shared by the three engines.

Why this exists
---------------
siM already had a working learner: a small linear model, fitted online, with
bounded steps, a circuit breaker and a full audit history. piD and riB had
nothing — piD refitted a forecast per request and kept none of it, riB computed
statistics and never adapted. Making all three genuine learners meant either
copying siM's machinery twice or extracting it once. Copied learning rules
drift, and three subtly different definitions of "bounded update" is exactly
the kind of divergence that makes a system's behaviour unexplainable.

Why linear, and why NumPy
-------------------------
The deployment budget is 500 MB of RAM for the whole process. PyTorch alone is
250-400 MB resident once imported, which is why the LSTM forecast has always
defaulted to off — a single optional feature cannot be allowed to consume the
entire memory envelope. Everything here is NumPy over parameter vectors of
length 4-12, so a model costs kilobytes and the three engines together are
rounding error against the budget.

That is a constraint, but it is not only a constraint. These models train on
tens to hundreds of observations, and grow by one per assessment. Anything with
more capacity would memorise rather than learn. A linear model over bounded
features can be printed in full, checked by hand, and defended to a reviewer —
which matters more here than the last few points of accuracy, because the
outputs feed research assessment that people are asked to trust.

What "genuine learner" means here
---------------------------------
Each model has (1) parameters that change in response to (2) observed error
against a real outcome, (3) persisted across restarts, and (4) measurable
against a non-learning baseline. A model that cannot be shown to beat its own
starting point is not learning, it is drifting — so every model carries a
circuit breaker that suspends it when it does worse than its defaults.
"""
import json
import math
import logging
import threading
from typing import Dict, List, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

# Updates are clamped so no single observation can dominate. The target signals
# here are noisy — a model panel's opinion, one researcher's feedback, one
# epoch's weights — and an unclamped step lets one outlier rewrite the model.
DEFAULT_MAX_STEP = 0.05
DEFAULT_LR = 0.03

# How many recent observations a model is judged over, and how much worse than
# its own defaults it must be before it is suspended. The window stops a few
# unusual inputs tripping the breaker; the margin stops noise doing it.
EVAL_WINDOW = 25
BREAKER_MARGIN = 0.05     # 5% worse than baseline, sustained, suspends it
MIN_OBSERVATIONS = 8      # below this there is not enough evidence to judge

_lock = threading.RLock()


def _clean(vec: Sequence[float]) -> np.ndarray:
    """Coerce to a finite float array. Never returns NaN or inf.

    Features arrive from extraction, corpus statistics and user input, any of
    which can produce a NaN. One NaN entering a weight vector poisons every
    subsequent prediction irrecoverably, so it is filtered at the boundary.
    """
    arr = np.asarray(list(vec), dtype=float)
    return np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)


class OnlineLinearModel:
    """A small linear model fitted by clamped stochastic gradient descent.

    Parameters
    ----------
    name        identifier used for persistence and status reporting
    features    ordered feature names; order IS the serialisation order
    defaults    authored starting weights — the baseline the breaker compares to
    lr          learning rate
    max_step    per-update clamp on any single weight
    lo, hi      bounds the prediction is clipped to
    """

    def __init__(self, name: str, features: Sequence[str],
                 defaults: Optional[Sequence[float]] = None,
                 lr: float = DEFAULT_LR, max_step: float = DEFAULT_MAX_STEP,
                 lo: float = 0.0, hi: float = 100.0,
                 non_negative: bool = False, normalise: bool = False,
                 decay_scale: float = 400.0):
        self.name = name
        self.features = list(features)
        self.n = len(self.features)
        self.defaults = _clean(defaults if defaults is not None
                               else np.zeros(self.n))
        self.lr = float(lr)
        self.max_step = float(max_step)
        self.lo, self.hi = float(lo), float(hi)
        self.non_negative = non_negative
        self.normalise = normalise
        # Observations over which the learning rate halves. Set generously:
        # at 60 the rate had collapsed before the model had seen enough of a
        # small corpus to move, which showed up as a learner that was safe,
        # stable and barely distinguishable from its own defaults.
        self.decay_scale = float(max(1.0, decay_scale))

        self.weights = self.defaults.copy()
        # Smoothed weights used for prediction.
        #
        # An arithmetic running mean was tried first and was wrong here: it
        # averages in the starting point forever, so a model that had correctly
        # moved a long way from its defaults still predicted from something
        # halfway back. Both learners collapsed toward their baselines. An
        # exponential moving average keeps the noise suppression and forgets
        # the origin, which is what suffix-averaging is for in the literature.
        self.avg_weights = self.defaults.copy()
        self.avg_count = 0
        self.avg_alpha = 0.10
        self.bias = 0.0
        self.observations = 0
        self.suspended = False
        # Rolling error of the model and of the frozen defaults, over the same
        # observations. Comparing them is the only honest way to answer "is
        # this thing actually learning?"
        self.recent_model_err: List[float] = []
        self.recent_base_err: List[float] = []

    # -- prediction ------------------------------------------------------
    def predict(self, features: Sequence[float]) -> float:
        x = _clean(features)
        if x.size != self.n:
            x = np.resize(x, self.n)
        w = self.defaults if self.suspended else self.effective_weights()
        b = 0.0 if self.suspended else self.bias
        return float(np.clip(np.dot(w, x) + b, self.lo, self.hi))

    def effective_weights(self) -> np.ndarray:
        """The weights actually used to predict: the Polyak average once there
        is enough of a trajectory to average, the raw weights before that."""
        return self.avg_weights if self.avg_count >= 5 else self.weights

    def predict_baseline(self, features: Sequence[float]) -> float:
        x = _clean(features)
        if x.size != self.n:
            x = np.resize(x, self.n)
        return float(np.clip(np.dot(self.defaults, x), self.lo, self.hi))

    # -- learning --------------------------------------------------------
    def observe(self, features: Sequence[float], target: float,
                weight: float = 1.0) -> Dict:
        """One supervised step against a real outcome.

        Returns what changed, so a caller can log it and a user can audit it.
        """
        with _lock:
            x = _clean(features)
            if x.size != self.n:
                x = np.resize(x, self.n)
            y = float(np.clip(_clean([target])[0], self.lo, self.hi))

            before = self.predict(x)
            base = self.predict_baseline(x)
            err = before - y

            # Track both errors BEFORE updating, so the comparison is honest:
            # scoring the model after it has seen the answer would flatter it.
            self.recent_model_err.append(abs(err))
            self.recent_base_err.append(abs(base - y))
            del self.recent_model_err[:-EVAL_WINDOW]
            del self.recent_base_err[:-EVAL_WINDOW]

            # Normalised LMS with a decaying rate, then Polyak averaging.
            #
            # Plain SGD was measurably worse than doing nothing here, and
            # raising the learning rate made it worse still — the signature of
            # a model bouncing around the optimum rather than approaching it.
            # On a noisy target the jitter costs more than the bias it removes,
            # so a forecaster "learned" its way to being 2% worse than its own
            # frozen defaults. Three standard corrections, all cheap:
            #
            #  1. Normalise by ||x||^2, so the step size does not depend on how
            #     large the features happen to be on this observation.
            #  2. Decay the rate as evidence accumulates, so early observations
            #     move the model and later ones refine it. This is what turns
            #     jitter into convergence.
            #  3. Predict from a running average of the weights (Polyak), which
            #     is the standard cure for exactly this noise and costs one
            #     extra vector.
            scale = self.lr * float(np.clip(weight, 0.0, 4.0))
            scale = scale / (1.0 + self.observations / self.decay_scale)
            norm = float(np.dot(x, x)) + 1.0          # +1 keeps tiny x stable
            grad = (err * x) / norm
            step = np.clip(scale * grad, -self.max_step, self.max_step)
            self.weights = self.weights - step
            # Bias moves at a fraction of the weight rate. Measured, not
            # assumed: at full rate riB's agreement with researcher feedback
            # dropped from +19.8% to +9.8%, because a freely-moving intercept
            # absorbs signal the features should be carrying. Forecasting needs
            # a fast intercept and gets one from RLS below, not from here.
            self.bias = float(np.clip(self.bias - scale * err * 0.1 / norm,
                                      -self.hi, self.hi))

            if self.non_negative:
                self.weights = np.maximum(self.weights, 0.0)
            if self.normalise:
                total = float(self.weights.sum())
                if total > 1e-9:
                    self.weights = self.weights / total

            self.avg_count += 1
            # Warm up on the arithmetic mean for the first few steps (an EMA
            # started cold is dominated by its seed), then switch to the EMA.
            a = max(self.avg_alpha, 1.0 / self.avg_count)
            self.avg_weights = self.avg_weights + a * (self.weights - self.avg_weights)
            self.observations += 1
            self._update_breaker()

            return {
                "predicted": round(before, 4),
                "target": round(y, 4),
                "error": round(err, 4),
                "baseline_error": round(abs(base - y), 4),
                "observations": self.observations,
                "suspended": self.suspended,
            }

    def _update_breaker(self) -> None:
        """Suspend the model when it is measurably worse than doing nothing.

        Deliberately two-sided: a suspended model that starts winning again is
        reinstated. A breaker that only ever trips is a kill switch, not a
        safeguard, and would make a single bad run permanent.
        """
        if len(self.recent_model_err) < MIN_OBSERVATIONS:
            self.suspended = False
            return
        m = float(np.mean(self.recent_model_err))
        b = float(np.mean(self.recent_base_err))
        if b <= 1e-9:
            self.suspended = m > 1e-6
            return
        self.suspended = (m / b) > (1.0 + BREAKER_MARGIN)

    # -- introspection ---------------------------------------------------
    def improvement(self) -> Optional[float]:
        """Fractional error reduction versus the frozen defaults. None if unknown."""
        if len(self.recent_model_err) < MIN_OBSERVATIONS:
            return None
        m = float(np.mean(self.recent_model_err))
        b = float(np.mean(self.recent_base_err))
        if b <= 1e-9:
            return 0.0
        return round((b - m) / b, 4)

    def status(self) -> Dict:
        imp = self.improvement()
        return {
            "name": self.name,
            "features": self.features,
            "weights": {f: round(float(w), 5)
                        for f, w in zip(self.features, self.effective_weights())},
            "defaults": {f: round(float(w), 5)
                         for f, w in zip(self.features, self.defaults)},
            "bias": round(self.bias, 5),
            "observations": self.observations,
            "suspended": self.suspended,
            "improvement_vs_defaults": imp,
            "learning": bool(imp is not None and imp > 0 and not self.suspended),
            "evaluated_over": len(self.recent_model_err),
            "mean_abs_error": (round(float(np.mean(self.recent_model_err)), 4)
                               if self.recent_model_err else None),
            "baseline_abs_error": (round(float(np.mean(self.recent_base_err)), 4)
                                   if self.recent_base_err else None),
        }

    # -- persistence -----------------------------------------------------
    def to_json(self) -> str:
        return json.dumps({
            "name": self.name,
            "features": self.features,
            "weights": [float(w) for w in self.weights],
            "avg_weights": [float(w) for w in self.avg_weights],
            "avg_count": self.avg_count,
            "bias": self.bias,
            "observations": self.observations,
            "suspended": self.suspended,
            "recent_model_err": self.recent_model_err[-EVAL_WINDOW:],
            "recent_base_err": self.recent_base_err[-EVAL_WINDOW:],
        })

    def load_json(self, raw: str) -> bool:
        """Restore persisted state. Returns False and keeps defaults on any
        mismatch — a model whose feature list has changed cannot meaningfully
        continue from old weights, and silently reusing them would apply
        yesterday's meaning to today's inputs."""
        try:
            data = json.loads(raw or "{}")
        except (ValueError, TypeError):
            return False
        if not isinstance(data, dict) or data.get("features") != self.features:
            return False
        try:
            w = _clean(data.get("weights", []))
            if w.size != self.n:
                return False
            self.weights = w
            av = _clean(data.get("avg_weights", data.get("weights", [])))
            self.avg_weights = av if av.size == self.n else w.copy()
            self.avg_count = int(data.get("avg_count", 0))
            self.bias = float(_clean([data.get("bias", 0.0)])[0])
            self.observations = int(data.get("observations", 0))
            self.suspended = bool(data.get("suspended", False))
            self.recent_model_err = [float(v) for v in data.get("recent_model_err", [])][-EVAL_WINDOW:]
            self.recent_base_err = [float(v) for v in data.get("recent_base_err", [])][-EVAL_WINDOW:]
            return True
        except (TypeError, ValueError):
            return False

    def reset(self) -> None:
        with _lock:
            self.weights = self.defaults.copy()
            self.avg_weights = self.defaults.copy()
            self.avg_count = 0
            self.bias = 0.0
            self.observations = 0
            self.suspended = False
            self.recent_model_err = []
            self.recent_base_err = []


class RecursiveLeastSquares:
    """Online least squares with exponential forgetting — piD's learner.

    Why not the SGD model above
    ---------------------------
    Measured, not assumed. On a realistic mean-reverting weight series the best
    attainable improvement over piD's frozen defaults — computed offline by
    least squares on the same five features — was 47.0%. Clamped SGD captured
    0.2% of it, and raising its learning rate did not help: the weights have to
    travel a long way from `last + trend` to the true predictor, and a bounded
    step size deliberately prevents exactly that. The clamp is right for siM
    and riB, whose targets are noisy human and model opinions. It is wrong for
    forecasting, where the target is an arithmetic fact the ledger will record.

    RLS solves the same regression exactly, one observation at a time, by
    maintaining the inverse covariance matrix. For five features that is a 5x5
    matrix and a handful of multiplications per block: microseconds, kilobytes,
    and no PyTorch anywhere near the 500 MB budget.

    `forgetting` < 1 lets the model track a corpus whose behaviour changes
    rather than averaging over its entire history. 0.98 keeps an effective
    memory of roughly the last fifty blocks.
    """

    def __init__(self, name: str, features: Sequence[str],
                 defaults: Optional[Sequence[float]] = None,
                 forgetting: float = 0.98, lo: float = 0.0, hi: float = 8.0):
        self.name = name
        self.features = list(features)
        self.n = len(self.features) + 1          # +1 for the intercept
        self.defaults = _clean(defaults if defaults is not None
                               else np.zeros(len(self.features)))
        self.forgetting = float(min(0.9999, max(0.90, forgetting)))
        self.lo, self.hi = float(lo), float(hi)

        self.theta = np.concatenate([self.defaults, [0.0]])
        # Large initial covariance = "no confidence in the starting point", so
        # early observations move the model quickly and later ones refine it.
        self.P = np.eye(self.n) * 100.0
        self.observations = 0
        self.suspended = False
        self.recent_model_err: List[float] = []
        self.recent_base_err: List[float] = []

    def _x(self, features: Sequence[float]) -> np.ndarray:
        x = _clean(features)
        if x.size != self.n - 1:
            x = np.resize(x, self.n - 1)
        return np.concatenate([x, [1.0]])

    def predict(self, features: Sequence[float]) -> float:
        if self.suspended:
            return self.predict_baseline(features)
        return float(np.clip(np.dot(self.theta, self._x(features)), self.lo, self.hi))

    def predict_baseline(self, features: Sequence[float]) -> float:
        x = self._x(features)
        return float(np.clip(np.dot(np.concatenate([self.defaults, [0.0]]), x),
                             self.lo, self.hi))

    def observe(self, features: Sequence[float], target: float,
                weight: float = 1.0) -> Dict:
        with _lock:
            x = self._x(features)
            y = float(np.clip(_clean([target])[0], self.lo, self.hi))

            before = self.predict(x[:-1])
            base = self.predict_baseline(x[:-1])
            self.recent_model_err.append(abs(before - y))
            self.recent_base_err.append(abs(base - y))
            del self.recent_model_err[:-EVAL_WINDOW]
            del self.recent_base_err[:-EVAL_WINDOW]

            lam = self.forgetting
            Px = self.P @ x
            denom = lam + float(x @ Px)
            if denom > 1e-12:
                K = Px / denom
                self.theta = self.theta + K * (y - float(self.theta @ x))
                self.P = (self.P - np.outer(K, Px)) / lam
                # Symmetrise and bound. Accumulated float error makes P drift
                # asymmetric and eventually explode; this is the standard guard.
                self.P = (self.P + self.P.T) / 2.0
                np.clip(self.P, -1e6, 1e6, out=self.P)

            self.theta = np.nan_to_num(self.theta, nan=0.0, posinf=0.0, neginf=0.0)
            self.observations += 1
            self._update_breaker()
            return {
                "predicted": round(before, 4), "target": round(y, 4),
                "error": round(before - y, 4),
                "baseline_error": round(abs(base - y), 4),
                "observations": self.observations, "suspended": self.suspended,
            }

    _update_breaker = OnlineLinearModel._update_breaker
    improvement = OnlineLinearModel.improvement

    def status(self) -> Dict:
        imp = self.improvement()
        return {
            "name": self.name, "features": self.features,
            "weights": {f: round(float(w), 5)
                        for f, w in zip(self.features, self.theta[:-1])},
            "defaults": {f: round(float(w), 5)
                         for f, w in zip(self.features, self.defaults)},
            "bias": round(float(self.theta[-1]), 5),
            "observations": self.observations, "suspended": self.suspended,
            "improvement_vs_defaults": imp,
            "learning": bool(imp is not None and imp > 0 and not self.suspended),
            "evaluated_over": len(self.recent_model_err),
            "mean_abs_error": (round(float(np.mean(self.recent_model_err)), 4)
                               if self.recent_model_err else None),
            "baseline_abs_error": (round(float(np.mean(self.recent_base_err)), 4)
                                   if self.recent_base_err else None),
            "algorithm": "recursive least squares",
        }

    def to_json(self) -> str:
        return json.dumps({
            "name": self.name, "features": self.features,
            "theta": [float(v) for v in self.theta],
            "P": [[float(v) for v in row] for row in self.P],
            "observations": self.observations, "suspended": self.suspended,
            "recent_model_err": self.recent_model_err[-EVAL_WINDOW:],
            "recent_base_err": self.recent_base_err[-EVAL_WINDOW:],
        })

    def load_json(self, raw: str) -> bool:
        try:
            d = json.loads(raw or "{}")
        except (ValueError, TypeError):
            return False
        if not isinstance(d, dict) or d.get("features") != self.features:
            return False
        try:
            th = _clean(d.get("theta", []))
            P = np.array(d.get("P", []), dtype=float)
            if th.size != self.n or P.shape != (self.n, self.n):
                return False
            self.theta, self.P = th, np.nan_to_num(P)
            self.observations = int(d.get("observations", 0))
            self.suspended = bool(d.get("suspended", False))
            self.recent_model_err = [float(v) for v in d.get("recent_model_err", [])][-EVAL_WINDOW:]
            self.recent_base_err = [float(v) for v in d.get("recent_base_err", [])][-EVAL_WINDOW:]
            return True
        except (TypeError, ValueError):
            return False

    def reset(self) -> None:
        with _lock:
            self.theta = np.concatenate([self.defaults, [0.0]])
            self.P = np.eye(self.n) * 100.0
            self.observations = 0
            self.suspended = False
            self.recent_model_err = []
            self.recent_base_err = []
