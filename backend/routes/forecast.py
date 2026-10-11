"""routes/forecast.py: piD forecasting. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.explorer import CRITERIA_TITLES  # noqa: F401
from routes.piq import count_assessed_papers  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 6. PIDYNE FORECAST  (LSTM epoch-weight forecasting)
# ---------------------------------------------------------------------------
def describe_forecast_criteria(weights):
    labels = [
        ("C1", "Originality", "Semantic distance from literature corpus penalized by generative AI laundering heuristics."),
        ("C2", "Methodological Rigor", "Deterministic adherence to MDAR reporting standards and valid RRIDs via SciScore."),
        ("C3", "Interdisciplinary Synergy", "Measures cross-disciplinary integration and entropy across scientific domains."),
        ("C4", "Societal Impact", "Evaluates broader societal and open infrastructure contributions."),
        ("C5", "Open Science", "Evaluates open data, open code, and containerized reproducibility."),
        ("C6", "Literature Integration", "Evaluates citation polarity and integration with existing foundational literature."),
        ("C7", "Empirical Density", "Assesses empirical sample strength and baseline variance."),
        ("C8", "Future Actionability", "Evaluates future research actionability and adherence to FAIR principles."),
    ]
    return [
        {"id": lid, "title": title, "description": desc, "weight": float(w)}
        for (lid, title, desc), w in zip(labels, weights)
    ]


CRITERIA_KEYS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]


def reconstruct_weight_history(limit: int = 60):
    """Rebuild the epoch-weight series from stored criteria scores.

    Blocks written before per-block weighting all carry [1.0] * 8, which gives
    the forecaster a flat line and nothing to learn. The papers themselves
    still hold their C1-C8 scores, so the same derivation the ledger now uses
    can simply be replayed over them in timestamp order.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT c1, c2, c3, c4, c5, c6, c7, c8 FROM papers_assessment
               WHERE final_score IS NOT NULL
               ORDER BY timestamp ASC LIMIT ?""",
            (limit,),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    history, previous = [], None
    for row in rows:
        scores = {key: safe_float(value, 50.0)
                  for key, value in zip(BRAIN_CRITERIA_ORDER, row)}
        previous = derive_next_epoch_weights(scores, previous)
        history.append(list(previous))
    return history

WEIGHT_MIN = 0.05
# The largest a single weight can be while the other seven still hold their
# floor and all eight sum to 8.0. Clipping to anything tighter than this is
# infeasible: renormalizing after the clip just pushes the value back over
# the cap, so the stated bound would be quietly violated.
WEIGHT_MAX = 8.0 - (7 * WEIGHT_MIN)


def project_weights_onto_simplex(vec):
    """Project a raw weight vector onto {w : sum(w) = 8, MIN <= w_i <= MAX}.

    Clip and renormalize interact — each one breaks the other's invariant —
    so alternate between them until both hold.
    """
    w = np.asarray(vec, dtype=np.float64).copy()
    if not np.all(np.isfinite(w)):
        w = np.where(np.isfinite(w), w, 1.0)

    for _ in range(12):
        w = np.clip(w, WEIGHT_MIN, WEIGHT_MAX)
        total = float(np.sum(w))
        if total <= 0:
            return np.full(8, 1.0, dtype=np.float64)
        w = w * (8.0 / total)
        if np.all(w >= WEIGHT_MIN - 1e-9) and np.all(w <= WEIGHT_MAX + 1e-9):
            break
    return np.clip(w, WEIGHT_MIN, WEIGHT_MAX)


@router.get("/api/forecast")
def run_forecast(
    lookback: int = Query(default=3, ge=1, le=5),
    # Holt's smoothing constants, exposed so the projection can be interrogated
    # rather than taken on faith. Bounded well inside (0, 1): at the extremes
    # the method degenerates — alpha near 0 ignores the data, near 1 ignores
    # the history — and neither produces a forecast worth showing.
    alpha: float = Query(default=0.6, ge=0.05, le=0.95),
    beta: float = Query(default=0.3, ge=0.05, le=0.95),
    gain: float = Query(default=2.5, ge=1.0, le=4.0),
):
    """Public wrapper: never lets an internal fault look like a dead connection.

    A 500 and a dropped socket render identically in the browser ("could not
    reach the forecasting service"), which sends the operator looking at
    networking when the real fault is in this handler. Catching here means the
    UI gets a structured answer with a log reference either way.
    """
    try:
        return _run_forecast_impl(lookback, alpha=alpha, beta=beta, gain=gain)
    except Exception as exc:
        ref = uuid.uuid4().hex[:8]
        logging.exception("Forecast failed [ref %s]", ref)
        add_log(f"Forecast failed [ref {ref}]: {type(exc).__name__}: {exc}")
        return {
            "ready": False, "mode": "error",
            "message": (f"The forecaster hit an internal error and could not complete. "
                        f"Server log reference: {ref}."),
            "detail": (f"{type(exc).__name__}: {exc}" if ENVIRONMENT != "production" else ""),
            "blocks_recorded": 0, "blocks_required": 3,
            "history": [], "forecast": None, "criteria": [],
        }


def _run_forecast_impl(lookback: int = 3, alpha: float = 0.6,
                       beta: float = 0.3, gain: float = 2.5):
    """Trains the PiDN LSTM on the recorded per-block criteria weights and
    projects the next epoch's weighting.

    The chart this feeds used to be meaningless because every block was
    written with a constant [1.0] * 8 weight vector — eight perfectly flat,
    perfectly overlapping lines. Blocks now record the criteria weighting each
    assessed manuscript's evidence profile implies (see
    brain.derive_next_epoch_weights), so the series carries real signal, and this
    endpoint returns the observed history plus the forecast point explicitly
    marked, along with the per-criterion delta and trend direction.
    """
    try:
        conn = get_db_connection()
        try:
            rows = conn.execute(
                """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8, timestamp
                   FROM blockchain_por_weights ORDER BY block_height ASC"""
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as e:
        add_log(f"Forecast ledger read failed: {e}")
        return {"ready": False, "message": "The Proof-of-Research ledger is unavailable.",
                "blocks_recorded": 0, "blocks_required": 2, "history": [],
                "forecast": None, "criteria": []}

    # ---- Make the series reflect the papers, not just the ledger -----------
    #
    # An observation is a block whose weights actually differ from the uniform
    # genesis vector; a block that carries [1.0] * 8 says nothing happened.
    # When the ledger holds fewer observations than there are assessed papers —
    # a fresh deployment, blocks written before per-block weighting, or a
    # ledger that simply has not caught up — the papers still carry their
    # C1–C8 scores, so the series is replayed from them instead.
    #
    # This is what makes the section work from the first assessed manuscript.
    # Before it, the reconstruction was attempted only after the ledger had
    # already produced a flat series AND required three reconstructed points to
    # be usable, so a user with one or two assessed papers was shown "Not
    # enough ledger history yet" over an empty box — while the data needed to
    # draw something real sat in papers_assessment the whole time.
    def _observations(rs):
        """Indices of blocks that record an actual measurement."""
        return [i for i, r in enumerate(rs)
                if any(abs(safe_float(v, 1.0) - 1.0) > 1e-9 for v in r[1:9])]

    forced_source = None
    if len(_observations(rows)) < 2:
        reconstructed = reconstruct_weight_history()
        if len(reconstructed) > len(_observations(rows)):
            # Block numbering restarts at 1: these are derived observations in
            # paper order, not ledger blocks, and `series_source` says so.
            rows = [(i + 1, *w, None) for i, w in enumerate(reconstructed)]
            forced_source = "reconstructed"

    # How many manuscripts actually exist, so the empty state can tell "nothing
    # assessed yet" apart from "assessed, but every weight came out uniform".
    try:
        papers_assessed = int(count_assessed_papers() or 0)
    except Exception:
        papers_assessed = 0

    # Two regimes, because "forecast" and "report" are different claims.
    #
    # A trend cannot honestly be projected from a single assessment — one
    # point has no direction. But the moment there is one assessed paper there
    # IS something real to report: how that paper's evidence profile moved the
    # criteria weighting away from the genesis baseline. That is a measurement,
    # not a projection, so it is returned as a delta and labelled as one.
    # Fabricating a curve through one point would be the dishonest option, and
    # showing nothing at all was the useless one.
    # One assessment must produce something visible. Depending on whether the
    # genesis block is present, "one assessment" is either two rows (genesis +
    # the paper) or a single row, and the second case previously fell into the
    # "no manuscripts assessed yet" branch and showed an empty state to a user
    # who had just assessed a manuscript. Both are handled as the same measured
    # shift, against a uniform baseline when there is no recorded predecessor.
    # A single row that is only the genesis block is NOT one assessment — it is
    # zero. Routing it to the delta branch compared the uniform genesis
    # weighting against a uniform baseline, produced eight deltas of exactly
    # 0.0, and drew eight zero-length bars: a chart that is present, correct,
    # and completely invisible. That is the "forecast shows nothing" state a
    # fresh deployment sits in.
    #
    # The regime is chosen by how many OBSERVATIONS there are, not how many
    # rows: zero observations is the baseline chart, one is the measured delta,
    # two or more is a projection. Counting rows instead meant a genesis block
    # padded the count — and, worse, that two real observations (a direction,
    # which is projectable) were still routed to the single-point delta.
    obs_idx = _observations(rows)
    only_genesis = not obs_idx

    if len(obs_idx) == 1:
        i_cur = obs_idx[0]
        current = np.array([safe_float(v, 1.0) for v in rows[i_cur][1:9]], dtype=np.float32)
        # Measured against the block before it when there is one, and against
        # the uniform genesis weighting when the observation is the first row.
        baseline = (np.array([safe_float(v, 1.0) for v in rows[i_cur - 1][1:9]], dtype=np.float32)
                    if i_cur > 0 else np.full(8, 1.0, dtype=np.float32))
        criteria = []
        for i, key_c in enumerate(CRITERIA_KEYS):
            delta = float(current[i] - baseline[i])
            criteria.append({
                "id": key_c,
                "title": CRITERIA_TITLES.get(key_c, key_c),
                "current": round(float(current[i]), 5),
                "previous": round(float(baseline[i]), 5),
                "delta": round(delta, 5),
                "direction": "up" if delta > 1e-4 else ("down" if delta < -1e-4 else "flat"),
            })
        ranked = sorted(criteria, key=lambda c: abs(c["delta"]), reverse=True)
        movers = [c for c in ranked if c["direction"] != "flat"][:3]
        return {
            "ready": True,
            "mode": "delta",
            "method": "observed-delta",
            "message": (
                "One assessment recorded. This is the measured shift from the baseline "
                "weighting, not a projection — a trend needs a second assessed paper "
                "before a direction can be inferred."
            ),
            "blocks_recorded": len(rows), "blocks_required": 2,
            "series_source": forced_source or "ledger",
            "observations": 1,
            "history": [], "forecast": None,
            "criteria": criteria,
            "insight": (
                "Your first assessment weighted "
                + ", ".join(f"{c['title']} {'up' if c['direction'] == 'up' else 'down'}"
                            for c in movers)
                + " relative to the uniform baseline."
            ) if movers else (
                "Your first assessment produced a weighting indistinguishable from the "
                "uniform baseline — its evidence was evenly spread across all eight criteria."
            ),
        }

    if only_genesis or len(rows) < 1:
        # An empty state is not the same as no information. The rubric's
        # genesis weighting is a real, defined starting point — it is what the
        # forecast will move AWAY from — so it is rendered as a chart rather
        # than withheld behind "come back when you have data". Showing the
        # baseline also makes the first assessment's effect legible, because
        # the user has already seen what it started from.
        baseline = np.full(8, 1.0, dtype=np.float32)
        criteria = []
        for i, key_c in enumerate(CRITERIA_KEYS):
            criteria.append({
                "id": key_c,
                "title": CRITERIA_TITLES.get(key_c, key_c),
                "current": 1.0, "previous": 1.0, "delta": 0.0, "direction": "flat",
            })
        return {
            "ready": True,
            "mode": "baseline",
            "method": "genesis-baseline",
            "message": (
                "This is the genesis weighting: all eight criteria weighted equally, which is "
                "where every deployment starts. It is the baseline, not a prediction — assess a "
                "manuscript and this chart shows how its evidence profile moves the weighting."
            ) if not papers_assessed else (
                "The assessed corpus has not moved the weighting off its uniform baseline yet: "
                "every criterion is carrying equal evidence. This is a measurement, not an "
                "empty chart — it will separate as the corpus grows."
            ),
            "blocks_recorded": len(rows), "blocks_required": 2,
            "series_source": forced_source or "ledger",
            "observations": 0,
            "history": [], "forecast": None,
            "criteria": criteria,
            "insight": (
                "Nothing has been assessed yet, so no criterion carries more weight than any "
                "other. The framework does not assume which criteria matter — it learns that "
                "from the evidence profiles of the manuscripts it sees."
            ) if not papers_assessed else (
                f"{papers_assessed} paper{'s' if papers_assessed != 1 else ''} assessed, and "
                "the derived weighting is still indistinguishable from uniform — the evidence "
                "so far is evenly spread across all eight criteria."
            ),
        }

    weight_matrix = np.array([[safe_float(v, 1.0) for v in r[1:9]] for r in rows], dtype=np.float32)

    # Belt and braces. Reaching here means at least two observations, so the
    # series already varies; this only catches a series that varies between
    # rows but is column-wise constant. Two reconstructed points are enough —
    # two points are a direction, and Holt projects from a direction. The old
    # floor of three is what turned a corpus of two assessed papers into "not
    # enough ledger history".
    series_source = forced_source or "ledger"
    if float(np.max(np.ptp(weight_matrix, axis=0))) < 1e-6:
        reconstructed = reconstruct_weight_history()
        if len(reconstructed) >= 2:
            weight_matrix = np.array(reconstructed, dtype=np.float32)
            rows = [(i + 1, *w, None) for i, w in enumerate(reconstructed)]
            series_source = "reconstructed"
        else:
            return {
                "ready": False,
                "message": (
                    "The recorded blocks all carry identical criteria weights (they predate "
                    "per-block weighting), and there are not yet enough assessed papers to "
                    "reconstruct a series. Assess a manuscript to build one."
                ),
                "blocks_recorded": len(rows), "blocks_required": 2,
                "history": [], "forecast": None, "criteria": [],
            }

    # At least one step back, at most everything we have. With two rows this is
    # 1, which is what makes a two-observation corpus projectable at all.
    actual_lookback = max(1, min(lookback, len(rows) - 1))

    try:
        key = forecast_engine.cache_key(
            len(rows), actual_lookback,
            f"{series_source}:a{alpha:.2f}:b{beta:.2f}:g{gain:.2f}")
    except TypeError:
        key = forecast_engine.cache_key(len(rows), actual_lookback)
        
    cached = forecast_engine.get_cached(key)
    if cached:
        return cached

    raw_pred, method, final_loss = None, "holt-linear-trend", 0.0
    
    # The neural path is attempted only when explicitly enabled AND torch can
    # actually be loaded. Both conditions matter: a host that cannot afford the
    # import must degrade to the statistical projection rather than crashing
    # the worker, and a crashed worker is exactly what the user sees as
    # "could not reach the forecasting service".
    if USE_LSTM_FORECAST:
        t = load_torch()
        if t:
            raw_pred = forecast_engine.train_lstm_forecast(
                weight_matrix, actual_lookback,
                model_factory=PidyneLSTM,
                dataset_factory=PidyneBlockchainDataset,
                loader_factory=t["DataLoader"],
                torch_mod=t["torch"], nn_mod=t["nn"], optim_mod=t["optim"],
            )
            if raw_pred is not None:
                method = "pidyne-lstm"
            
    # piD learns here. Every block that has appeared since the last pass is
    # replayed one step ahead — predicted from only the blocks before it, then
    # scored against what was actually written — so the model is trained the
    # way it is used and never sees the answer first. This is what makes piD a
    # learner rather than a procedure that refits and forgets.
    criteria_keys = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]
    try:
        forecast_engine.learn_from_history(weight_matrix, criteria_keys)
        learned_pred = np.array(
            [forecast_engine.learned_forecast(weight_matrix[:, i], c)
             for i, c in enumerate(criteria_keys[:weight_matrix.shape[1]])])
    except Exception as e:
        logging.warning("piD learned forecast unavailable: %s", e)
        learned_pred = None

    if raw_pred is None and learned_pred is not None:
        raw_pred = learned_pred
        method = "pid-learned"
    if raw_pred is None:
        raw_pred = forecast_engine.holt_linear_forecast(weight_matrix, alpha=alpha, beta=beta)

    last = weight_matrix[-1]

    # The LSTM head ends in softmax * 8, which pulls every output toward a
    # uniform 1.0 and would otherwise render as eight near-identical lines.
    # Two corrections, in order:
    #
    #  1. Contrast: amplify the prediction's deviation from its own mean.
    #     This sharpens the signal without ever reordering the criteria —
    #     an earlier version extrapolated from the last observed block with
    #     a gain above 1.0, which overshot past the model's own prediction
    #     and could invert the ordering the network actually forecast.
    #  2. Continuity: blend lightly toward the last observed block so the
    #     forecast point joins the history smoothly rather than jumping.
    CONTRAST_GAIN = float(gain)
    CONTINUITY = 0.30

    pred_mean = float(np.mean(raw_pred))
    sharpened = pred_mean + (raw_pred - pred_mean) * CONTRAST_GAIN
    projected = (CONTINUITY * last) + ((1.0 - CONTINUITY) * sharpened)

    next_weights = project_weights_onto_simplex(projected)

    hist_slice = rows[-(actual_lookback + 1):]
    history = []
    for r in hist_slice:
        entry = {"block": int(r[0]), "label": f"Block {int(r[0])}", "timestamp": r[9], "is_forecast": False}
        for i, key_c in enumerate(CRITERIA_KEYS):
            entry[key_c] = round(safe_float(r[1 + i], 1.0), 5)
        history.append(entry)

    next_block = int(rows[-1][0]) + 1
    forecast_point = {"block": next_block, "label": f"Block {next_block} (forecast)",
                      "timestamp": None, "is_forecast": True}
    for i, key_c in enumerate(CRITERIA_KEYS):
        forecast_point[key_c] = round(float(next_weights[i]), 5)

    criteria = describe_forecast_criteria(next_weights)
    for i, c in enumerate(criteria):
        current = float(last[i])
        delta = float(next_weights[i]) - current
        c["current_weight"] = round(current, 5)
        c["delta"] = round(delta, 5)
        c["delta_pct"] = round((delta / current) * 100.0, 2) if current else 0.0
        c["trend"] = "rising" if delta > 0.01 else ("falling" if delta < -0.01 else "stable")

    ranked = sorted(criteria, key=lambda cx: cx["weight"], reverse=True)
    mover = max(criteria, key=lambda cx: abs(cx["delta"]))
    interpretation = (
        f"Across the last {len(hist_slice)} ledger blocks, {ranked[0]['id']} ({ranked[0]['title']}) "
        f"carries the most forecast weight at {ranked[0]['weight']:.3f}, while {ranked[-1]['id']} "
        f"({ranked[-1]['title']}) carries the least at {ranked[-1]['weight']:.3f}. The largest "
        f"projected shift is {mover['id']} ({mover['title']}), {mover['trend']} by "
        f"{abs(mover['delta_pct']):.1f}%. Higher weight means the assessed corpus is producing "
        f"stronger, more consistent evidence for that criterion."
    )

    result = {
        "ready": True,
        "history": history,
        "forecast": forecast_point,
        "criteria": criteria,
        "raw_sum": float(np.sum(next_weights)),
        "lookback_used": actual_lookback,
        "blocks_recorded": len(rows),
        "training_loss": round(final_loss, 6),
        "method": method,
        "settings": {"alpha": round(alpha, 3), "beta": round(beta, 3),
                     "gain": round(gain, 3), "lookback": actual_lookback},
        "cached": False,
        "series_source": series_source,
        "interpretation": interpretation,
        "top_criterion": ranked[0]["id"],
        "biggest_mover": mover["id"],
    }
    forecast_engine.store_cached(key, result)
    return result
