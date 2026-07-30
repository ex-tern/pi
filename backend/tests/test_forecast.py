"""
Forecast caching, budgeting and degradation.

The endpoint previously trained a 300-epoch LSTM inside the HTTP request. On a
small host that either exceeded the gateway timeout or was OOM-killed, which
reached the browser as an unexplained "could not reach the forecasting
service". These tests pin the properties that prevent that: results are cached,
training is bounded, and a statistical projection is always available.

Run with:  cd backend && pytest tests/ -v
"""
import os
import sys
import tempfile

import numpy as np
import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import forecast


@pytest.fixture(autouse=True)
def clear_cache():
    forecast._cache.clear()
    yield


# --------------------------------------------------------------------------
# Caching
# --------------------------------------------------------------------------
def test_a_cold_key_misses():
    assert forecast.get_cached(forecast.cache_key(5, 3, "ledger")) is None


def test_a_stored_result_is_returned_and_marked_cached():
    key = forecast.cache_key(5, 3, "ledger")
    forecast.store_cached(key, {"ready": True})
    assert forecast.get_cached(key)["cached"] is True


def test_a_new_block_invalidates_the_cache():
    """The series only changes when a block is written, so block count is the key."""
    forecast.store_cached(forecast.cache_key(5, 3, "ledger"), {"ready": True})
    assert forecast.get_cached(forecast.cache_key(6, 3, "ledger")) is None


def test_a_different_lookback_is_a_different_forecast():
    forecast.store_cached(forecast.cache_key(5, 3, "ledger"), {"ready": True})
    assert forecast.get_cached(forecast.cache_key(5, 5, "ledger")) is None


def test_the_cache_is_bounded():
    for i in range(120):
        forecast.store_cached(forecast.cache_key(i, 3, "ledger"), {"ready": True})
    assert len(forecast._cache) <= 65


# --------------------------------------------------------------------------
# Training budget
# --------------------------------------------------------------------------
def test_epochs_scale_with_available_data():
    assert forecast.epochs_for(2) < forecast.epochs_for(20)


def test_epochs_are_bounded_at_both_ends():
    assert forecast.epochs_for(0) >= forecast.MIN_EPOCHS
    assert forecast.epochs_for(10 ** 6) <= forecast.MAX_EPOCHS


def test_training_returns_none_when_the_model_cannot_be_built():
    """The caller must fall back rather than propagate an error to the user."""
    def exploding_factory():
        raise RuntimeError("torch unavailable")

    result = forecast.train_lstm_forecast(
        np.ones((6, 8), dtype=np.float32), 3,
        model_factory=exploding_factory, dataset_factory=lambda m, l: [0],
        loader_factory=lambda ds, **k: [(None, None)],
        torch_mod=None, nn_mod=None, optim_mod=None,
    )
    assert result is None


# --------------------------------------------------------------------------
# Statistical fallback — the always-available path
# --------------------------------------------------------------------------
def test_holt_projects_an_existing_trend_forward():
    rising = np.array([[1.0], [1.2], [1.4], [1.6]])
    assert forecast.holt_linear_forecast(rising)[0] > 1.6


def test_holt_follows_a_falling_trend_down():
    falling = np.array([[2.0], [1.8], [1.6], [1.4]])
    assert forecast.holt_linear_forecast(falling)[0] < 1.4


def test_holt_handles_all_eight_criteria_together():
    series = np.array([
        [1.0] * 8,
        [1.2, 0.9, 1.1, 0.8, 1.0, 1.0, 1.1, 0.9],
        [1.35, 0.82, 1.18, 0.72, 1.02, 0.98, 1.15, 0.84],
    ])
    projection = forecast.holt_linear_forecast(series)
    assert projection.shape == (8,)
    assert projection[0] > series[-1][0], "rising criterion should continue rising"
    assert projection[1] < series[-1][1], "falling criterion should continue falling"


def test_holt_is_stable_on_a_flat_series():
    flat = np.array([[1.0] * 8] * 5)
    assert np.allclose(forecast.holt_linear_forecast(flat), 1.0, atol=1e-6)


def test_holt_handles_a_single_observation():
    single = np.array([[1.0] * 8])
    assert forecast.holt_linear_forecast(single).shape == (8,)


def test_holt_never_produces_nan():
    for series in (np.zeros((4, 8)), np.ones((4, 8)) * 1e6, np.array([[0.05] * 8, [7.6] * 8])):
        assert np.all(np.isfinite(forecast.holt_linear_forecast(series)))
