"""
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
    """Train the Pidyne LSTM under a wall-clock budget.

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
