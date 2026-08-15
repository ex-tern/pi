"""
piD — the pi-Dyne forecasting engine.

Epoch-weight forecasting: cached, bounded, and degradable.

The problem
-----------
Forecasting trained a 300-epoch LSTM inside the HTTP request. On a small host
that is slow enough to hit a gateway timeout and heavy enough to risk being
OOM-killed, which surfaced in the browser as "could not reach the forecasting
service" — a network-level failure with no explanation, on an endpoint that was
working correctly in principle.

Three changes make it reliable:

* **Caching.** The weight series only changes when a new Proof-of-Research
  block is written, so a forecast is recomputed only when the block count or
  lookback actually changes. Repeated views cost nothing.
* **Bounded training.** Epoch count scales with how much data exists. Running
  300 epochs over four data points is not more accurate, only slower.
* **A statistical fallback.** Holt's linear-trend method is implemented in
  plain NumPy and produces a comparable projection for a short series. If
  PyTorch is unavailable, too slow, or fails for any reason, the forecast
  degrades to this rather than failing. A working forecast computed by
  exponential smoothing is far more useful than a neural one that times out —
  and on series this short the two largely agree anyway.
"""
import time
import logging
import threading
from typing import Dict, List, Optional, Tuple

import numpy as np

_lock = threading.Lock()
_cache: Dict[Tuple, Dict] = {}
_CACHE_TTL = 600  # seconds; also invalidated by block count changing

# Training is capped by data volume: more epochs over a handful of points
# fits noise rather than signal.
MIN_EPOCHS = 40
MAX_EPOCHS = 200
TRAINING_TIME_BUDGET = 6.0  # seconds; a forecast is not worth a timeout


def cache_key(block_count: int, lookback: int, source: str) -> Tuple:
    return (block_count, lookback, source)


def get_cached(key: Tuple) -> Optional[Dict]:
    with _lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if time.time() - entry["at"] > _CACHE_TTL:
            _cache.pop(key, None)
            return None
        result = dict(entry["value"])
        result["cached"] = True
        return result


def store_cached(key: Tuple, value: Dict):
    with _lock:
        if len(_cache) > 64:
            _cache.clear()
        _cache[key] = {"at": time.time(), "value": value}


def epochs_for(sample_count: int) -> int:
    """Training length proportional to available data."""
    return int(max(MIN_EPOCHS, min(MAX_EPOCHS, sample_count * 25)))


# ---------------------------------------------------------------------------
# Statistical projection — the always-available path
# ---------------------------------------------------------------------------
def holt_linear_forecast(series: np.ndarray, alpha: float = 0.6,
                         beta: float = 0.3) -> np.ndarray:
    """One-step-ahead projection by Holt's linear-trend method.

    Chosen because it models level *and* trend with two parameters, which is
    the right complexity for a series of a few dozen points. Fitting anything
    heavier to this much data estimates noise.

    Operates column-wise, so all eight criteria are projected together.
    """
    data = np.asarray(series, dtype=np.float64)
    if data.ndim == 1:
        data = data.reshape(-1, 1)
    if len(data) < 2:
        return data[-1].copy()

    level = data[0].copy()
    trend = data[1] - data[0]
    for point in data[1:]:
        previous_level = level
        level = alpha * point + (1 - alpha) * (level + trend)
        trend = beta * (level - previous_level) + (1 - beta) * trend
    return level + trend


def train_lstm_forecast(weight_matrix: np.ndarray, lookback: int,
                        model_factory, dataset_factory, loader_factory,
                        torch_mod, nn_mod, optim_mod) -> Optional[np.ndarray]:
    """Train the pi-Dyne LSTM under a wall-clock budget.

    Returns None on any failure or overrun, so the caller falls back to the
    statistical path rather than propagating an error to the user.
    """
    try:
        samples = max(1, len(weight_matrix) - lookback)
        epochs = epochs_for(samples)
        dataset = dataset_factory(weight_matrix, lookback)
        loader = loader_factory(dataset, batch_size=min(4, max(1, len(dataset))), shuffle=False)

        model = model_factory()
        optimizer = optim_mod.Adam(model.parameters(), lr=0.01)
        loss_fn = nn_mod.MSELoss()

        model.train()
        deadline = time.time() + TRAINING_TIME_BUDGET
        completed = 0
        for _ in range(epochs):
            if time.time() > deadline:
                logging.info("Forecast training stopped at %d/%d epochs (time budget).",
                             completed, epochs)
                break
            for sequence, target in loader:
                optimizer.zero_grad()
                loss = loss_fn(model(sequence), target)
                loss.backward()
                optimizer.step()
            completed += 1

        if completed == 0:
            return None

        model.eval()
        with torch_mod.no_grad():
            window = torch_mod.tensor(weight_matrix[-lookback:],
                                      dtype=torch_mod.float32).unsqueeze(0)
            return np.asarray(model(window).squeeze().numpy(), dtype=np.float64)
    except Exception as e:
        logging.warning("LSTM forecast unavailable, using statistical projection: %s", e)
        return None


# ---------------------------------------------------------------------------
# piD as a genuine learner
# ---------------------------------------------------------------------------
# What was here before this section: Holt's linear trend with two constants
# (alpha 0.6, beta 0.3) chosen at authoring time, or an optional LSTM refitted
# from scratch inside each request and thrown away afterwards. Neither learned.
# Holt's constants never moved however wrong they were, and the LSTM could not
# carry anything between runs because nothing persisted it — a model retrained
# from zero on every call is a fitting procedure, not a learning system.
#
# What makes this one genuine: it forecasts, the forecast is recorded, and when
# the next Proof-of-Research block arrives the recorded forecast is scored
# against what actually happened and the parameters move. State persists in
# SQLite, so a restart resumes rather than restarts.
#
# The model is a per-criterion linear combination of five features drawn from
# the recent weight series. That is 5 parameters per criterion, 40 in total,
# which costs about a kilobyte — the whole point, given a 500 MB envelope that
# PyTorch would consume most of on import alone.
FEATURES = ["last", "trend", "mean3", "deviation", "momentum"]

# Authored defaults reproduce a sensible naive forecast: last value plus its
# recent trend. Starting from the previous behaviour rather than from zero
# means the model is useful on day one and the circuit breaker has a fair
# baseline to judge it against.
DEFAULT_WEIGHTS = [1.0, 1.0, 0.0, 0.0, 0.0]

_models: Dict[str, "object"] = {}
_MODEL_LOCK = threading.Lock()


def _feature_vector(series) -> list:
    """Five bounded features describing where a criterion's weight is heading."""
    s = np.asarray(series, dtype=float)
    s = np.nan_to_num(s, nan=0.0, posinf=0.0, neginf=0.0)
    if s.size == 0:
        return [0.0] * len(FEATURES)
    last = float(s[-1])
    prev = float(s[-2]) if s.size > 1 else last
    trend = last - prev
    mean3 = float(np.mean(s[-3:]))
    deviation = last - mean3
    # Second difference: is the trend itself accelerating?
    momentum = (last - 2 * prev + float(s[-3])) if s.size > 2 else 0.0
    return [last, trend, mean3, deviation, momentum]


def _model_for(criterion: str):
    """The persisted model for one criterion, loaded once per process."""
    from online_model import RecursiveLeastSquares
    from database import load_engine_state

    with _MODEL_LOCK:
        m = _models.get(criterion)
        if m is None:
            m = RecursiveLeastSquares(
                name=f"pid:{criterion}", features=FEATURES,
                defaults=DEFAULT_WEIGHTS, forgetting=0.98, lo=0.0, hi=8.0)
            raw = load_engine_state(m.name)
            if raw:
                m.load_json(raw)
            _models[criterion] = m
        return m


def learned_forecast(series, criterion: str) -> float:
    """Next-epoch weight for one criterion, from the learned model."""
    return _model_for(criterion).predict(_feature_vector(series))


def observe_outcome(series_before, criterion: str, actual: float) -> Dict:
    """Score a previous forecast against what the ledger actually recorded.

    `series_before` must be the series AS IT WAS when the forecast was made —
    scoring a prediction against a series that already contains the answer
    would report a model far better than it is.
    """
    from database import save_engine_state, log_engine_observation

    model = _model_for(criterion)
    feats = _feature_vector(series_before)
    result = model.observe(feats, float(actual))
    save_engine_state(model.name, model.to_json())
    log_engine_observation(f"pid:{criterion}", feats, float(actual), result,
                           source="block")
    return result


def learn_from_history(weight_matrix, criteria: List[str]) -> Dict:
    """Walk the recorded block history and learn from every transition.

    Called when new blocks appear. Each row is predicted from only the rows
    before it, then compared with what was actually written — so the model is
    trained the way it will be used, one step ahead, never having seen the
    answer.
    """
    from database import save_engine_state, engine_observation_count

    matrix = np.asarray(weight_matrix, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] < 3:
        return {"learned": 0, "reason": "Not enough blocks to learn from yet."}

    learned = 0
    for idx, criterion in enumerate(criteria[:matrix.shape[1]]):
        model = _model_for(criterion)
        already = engine_observation_count(f"pid:{criterion}")
        column = matrix[:, idx]
        # Resume where the previous pass stopped rather than relearning the
        # whole history on every call, which would multiply-count old blocks
        # and make the observation count meaningless.
        start = max(2, already + 2)
        for t in range(start, column.size):
            model.observe(_feature_vector(column[:t]), float(column[t]))
            learned += 1
        save_engine_state(model.name, model.to_json())
    return {"learned": learned}


def engine_status(criteria: List[str]) -> Dict:
    """What piD has learned, per criterion, in auditable form."""
    from database import engine_observation_count
    models = []
    total_obs = 0
    improving = 0
    for c in criteria:
        st = _model_for(c).status()
        st["logged_observations"] = engine_observation_count(f"pid:{c}")
        total_obs += st["observations"]
        if st.get("learning"):
            improving += 1
        models.append(st)
    # Aggregate error across the eight criteria.
    #
    # Every per-criterion model already carries `mean_abs_error` and
    # `baseline_abs_error`; this function summed only the observation counts,
    # so piD published a five-figure observation total and no score, and the
    # engine card read "no error baseline to score against yet" against 39,696
    # observations. The numbers were there the whole time — nothing was adding
    # them up.
    #
    # Weighted by how many outcomes each criterion was actually scored over, so
    # a criterion evaluated twice cannot swing the headline as hard as one
    # evaluated a thousand times.
    num_m = num_b = weight = 0.0
    scored = 0
    for st in models:
        n = float(st.get("evaluated_over") or 0)
        m, bl = st.get("mean_abs_error"), st.get("baseline_abs_error")
        if n <= 0 or m is None or bl is None:
            continue
        num_m += float(m) * n
        num_b += float(bl) * n
        weight += n
        scored += 1

    return {
        "engine": "piD",
        "kind": "online linear forecaster (5 parameters per criterion)",
        "criteria": models,
        "total_observations": total_obs,
        "criteria_improving": improving,
        # None rather than 0 when nothing has been scored: zero error would be
        # a perfect forecaster, which is the opposite of "no data".
        "mean_abs_error": round(num_m / weight, 4) if weight else None,
        "baseline_abs_error": round(num_b / weight, 4) if weight else None,
        "evaluated_over": int(weight),
        "criteria_scored": scored,
        "memory_note": ("NumPy only. ~40 parameters total; no PyTorch import, "
                        "so the 500 MB process budget is unaffected."),
    }
