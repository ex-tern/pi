"""api.py: the ScholarPi API, assembled: the app and shared helpers (core.py), one router per
concern (routes/*.py), then the Lab, consent, layout, PiEn, recent, live, traffic and Super Neural
Engine routers and the static frontend. Run with `gunicorn api:app`. Names other modules and the
tests take from here (idle_worker, tests/test_orcid_return) are re-exported below."""
from core import *  # noqa: F401,F403
from core import _RATE_LIMIT_BUCKETS, _STATE_RESTORED  # noqa: F401

from routes import meta as _r_meta
from routes import auth as _r_auth
from routes import piq as _r_piq
from routes import chain as _r_chain
from routes import status as _r_status
from routes import identity as _r_identity
from routes import arcade as _r_arcade
from routes import visits as _r_visits
from routes import profile as _r_profile
from routes import assessments as _r_assessments
from routes import reviews as _r_reviews
from routes import history as _r_history
from routes import admin as _r_admin
from routes import reviewing as _r_reviewing
from routes import bugreport as _r_bugreport
from routes import assess as _r_assess
from routes import discover as _r_discover
from routes import scilem as _r_scilem
from routes import forecast as _r_forecast
from routes import analytics as _r_analytics
from routes import explorer as _r_explorer

app.include_router(_r_meta.router)
app.include_router(_r_auth.router)
app.include_router(_r_piq.router)
app.include_router(_r_chain.router)
app.include_router(_r_status.router)
app.include_router(_r_identity.router)
app.include_router(_r_arcade.router)
app.include_router(_r_visits.router)
app.include_router(_r_profile.router)
app.include_router(_r_assessments.router)
app.include_router(_r_reviews.router)
app.include_router(_r_history.router)
app.include_router(_r_admin.router)
app.include_router(_r_reviewing.router)
app.include_router(_r_bugreport.router)
app.include_router(_r_assess.router)
app.include_router(_r_discover.router)
app.include_router(_r_scilem.router)
app.include_router(_r_forecast.router)
app.include_router(_r_analytics.router)
app.include_router(_r_explorer.router)

from routes.meta import build_info, get_logs, health_check, robots_txt  # noqa: F401,E402
from routes.auth import WalletVerifyRequest, _ORCID_RETURN_DEFAULTS, _OWN_ORIGINS, _orcid_return_allowed, _orcid_state, _orcid_unstate, _request_origin, auth_session, orcid_callback, orcid_login_url, resolve_frontend_origin, resolve_orcid_redirect_uri, verify_wallet  # noqa: F401,E402
from routes.piq import PIQ_TOTAL_SQL, ZERO_ADDRESS, count_assessed_papers, is_tx_hash, normalize_identity, piq_fields, require_affordable, resolve_active_fee, settlement_state, user_piq_ledger, user_piq_total  # noqa: F401,E402
from routes.chain import backup_run, backup_status, chain_contracts, chain_status, donate_info  # noqa: F401,E402
from routes.status import get_challenge, providers_status, trial_status  # noqa: F401,E402
from routes.identity import _arcade_key, _display_name, _identity_values, _profile_key, require_identity, require_owner  # noqa: F401,E402
from routes.arcade import ArcadeRun, arcade_field_papers, arcade_finish, arcade_leaderboard_endpoint, arcade_start  # noqa: F401,E402
from routes.visits import RibFeedback, _visitor_key, engines_status, register_visit, rib_feedback, stats_count, visitor_counts  # noqa: F401,E402
from routes.profile import ProfileSlotRequest, ResearcherProfile, activate_profile, list_profiles, read_profile, remove_profile_slot, research_buddy, research_buddy_suggest, reset_profile, write_profile, write_profile_slot  # noqa: F401,E402
from routes.assessments import ChallengeConfirm, ChallengeStart, PublishRequest, challenge_confirm, challenge_options, challenge_start, claim_escrow, claimable_escrow, disown_paper, my_assessments, my_escrow, publish_assessment, publish_status, serve_paper_file  # noqa: F401,E402
from routes.reviews import REVIEW_MIN_CHARS, REVIEW_REQUIREMENTS, RatingRequest, RebuttalRequest, ReportRequest, ReviewRequest, ReviewSubmission, _perform_llm_review, cancel_review, journal, open_reviews, rate_review_endpoint, rebut_review, report_review_endpoint, request_llm_review, request_review, review_jobs, review_report_reasons, review_state  # noqa: F401,E402
from routes.history import ClearHistoryRequest, clear_my_history  # noqa: F401,E402
from routes.admin import CleanupRequest, GrantRequest, MAX_SINGLE_GRANT, ResetRequest, _cap_report, _dir_size, _human, _known_eval_hashes, _settle_state, _settlement_loop, admin_grant, admin_overview, admin_reset, admin_review_reports, reset_options, settle_batch, settle_pending, settlement_blockers, settlement_queue, start_auto_settlement, storage_cleanup, storage_report  # noqa: F401,E402
from routes.reviewing import remove_assessment, review_eligibility, submit_review  # noqa: F401,E402
from routes.bugreport import BugReport, bug_report_list, bug_report_status, submit_bug_report  # noqa: F401,E402
from routes.assess import HEARTBEAT_SECONDS, JOURNAL_CHECK_BUDGET_SECONDS, MAX_DISCOVERY_BATCH, _fmt_score, _json_safe, assess_stream, build_result_payload, estimate_word_count, retrieve_manuscript_bytes, stream_assessment_progress  # noqa: F401,E402
from routes.discover import DefenseRequest, TextAssessRequest, assess_text, defense_strategy, discover_hot_topics, discover_search  # noqa: F401,E402
from routes.scilem import ScilemChatRequest, ScilemFeedback, ScilemResetRequest, scilem_chat, scilem_feedback, scilem_learning_status, scilem_reset, scilem_status  # noqa: F401,E402
from routes.forecast import CRITERIA_KEYS, WEIGHT_MAX, WEIGHT_MIN, _run_forecast_impl, describe_forecast_criteria, project_weights_onto_simplex, reconstruct_weight_history, run_forecast  # noqa: F401,E402
from routes.analytics import RescoreRequest, aggregate_author_statistics, analytics_fields, analytics_leaderboard, analytics_map, analytics_summary, analytics_top_papers, architecture_parameters, format_topic_path, get_emission_policy, get_rubric, list_corpus_fields, rescore_corpus  # noqa: F401,E402
from routes.explorer import CRITERIA_TITLES, CRITERION_DEFINITIONS, DOSSIER_LICENSE, DOSSIER_SCHEMA_VERSION, EXPLORER_COLUMNS, _EXPLORER_SORTS, build_dossier_from_row, build_fair_dossier, coara_dossier_html, dossier_by_doi, explorer_dossier, explorer_latest, explorer_search, explorer_tx_url, fair_dossier, restrict_to_existing_columns  # noqa: F401,E402



# ---------------------------------------------------------------------------
# 8b. Lab: private projects (owner only). Public Lab projects are static files.
# ---------------------------------------------------------------------------
import lab as _lab  # noqa: E402
app.include_router(_lab.build_router(BASE_DIR, require_owner))
app.include_router(_lab.build_features_router())

# Permission requests with a confirm link (/confirm/?t=...). See consent.py.
import consent as _consent  # noqa: E402
app.include_router(_consent.build_router(BASE_DIR, require_owner))

# A signed-in visitor's orbit layout (positions, sizes, open windows). See layout.py.
import layout as _layout  # noqa: E402
app.include_router(_layout.build_router(BASE_DIR, require_identity))

# PiEn: what everyone's use of the site teaches the mark, pooled anonymously. See pien.py.
import pien as _pien  # noqa: E402
app.include_router(_pien.build_router(BASE_DIR))

# Recent assessments, for everyone: field, score and day only. See recent.py.
import recent as _recent  # noqa: E402
app.include_router(_recent.build_router(get_db_connection))
import live as _live
import traffic as _traffic
app.include_router(_traffic.build_router(get_db_connection))
app.include_router(_live.build_router(get_db_connection, idle_worker.public_status, idle_worker.activity))

# The Super Neural Engine: a prompt made by wiring, answered by every engine. See super_engine.py.
import super_engine as _super  # noqa: E402


def _super_rows():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """SELECT p.eval_hash, p.title, p.author_name, p.fields, p.final_score, p.timestamp,
                      b.block_height, p.piq_minted
               FROM papers_assessment p
               LEFT JOIN blockchain_por_weights b ON p.eval_hash = b.eval_hash
               WHERE p.final_score IS NOT NULL AND COALESCE(p.title, '') <> ''
               ORDER BY p.timestamp DESC LIMIT 2000""").fetchall()
    finally:
        conn.close()
    return [{"eval_hash": r[0], "title": r[1], "author": clean_author_name(r[2]), "fields": r[3],
             "score": r[4], "timestamp": r[5], "on_ledger": r[6] is not None, "piq": r[7] or 0.0} for r in rows]


def _super_answer(prompt):
    if not ENABLE_SCILEM_ASSISTANT:
        return {}
    return scilem.answer(prompt)


def _super_route_call(juror, prompt, routes):
    """One answer from the first route of this juror's chain that responds,
    with the same cooldowns and failure handling as manuscript assessment."""
    from providers import (is_route_cooling, is_provider_unreachable, record_success, record_rate_limit,
                           record_provider_unreachable, parse_retry_after, classify_provider_error,
                           ends_chain, PROVIDER_ENDING)
    from brain import request_model_assessment
    if not routes:
        return {"failed": "not configured on this deployment"}
    last = "no route was reachable"
    dead = set()                  # a bad key or empty account: skip that provider's other routes, try the next
    for route in routes:
        if route["provider"] in dead:
            continue
        if is_provider_unreachable(route["provider"])[0] or is_route_cooling(route["model"], route["provider"])[0]:
            last = "temporarily rate-limited"
            continue
        _, data = request_model_assessment(juror, route["model"], route["key"], route["base"], prompt)
        if not data.get("api_failed"):
            record_success(route["model"], route["provider"])
            return {**data, "model": route["model"]}
        raw = data.get("_raw_error") or data.get("opinion", "")
        c = classify_provider_error(raw)
        if c["category"] == "rate_limit":
            record_rate_limit(route["model"], route["provider"], parse_retry_after(raw))
        elif c["category"] in ("credit", "auth"):
            record_rate_limit(route["model"], route["provider"], 600)
        elif c["category"] == "network":
            record_provider_unreachable(route["provider"])
        last = c["public"]
        if c["category"] in PROVIDER_ENDING:
            dead.add(route["provider"])
        if ends_chain(c):
            break
    return {"failed": last}


def _super_ask_juror(juror, prompt):
    from providers import build_routes
    return _super_route_call(juror, prompt, build_routes(juror))


def _super_judge(prompt):
    from providers import build_routes, is_scilm_route
    return _super_route_call("judge", prompt, [r for r in build_routes("judge") if not is_scilm_route(r)])


def _super_juror_ready(juror):
    from providers import build_routes
    return bool(build_routes(juror))


def _super_jurors():
    from brain import MODEL_REGISTRY
    return [{"key": k, "label": v["label"].split(" (")[0]} for k, v in MODEL_REGISTRY.items() if v.get("kind") == "external"]


app.include_router(_super.build_router(
    answer=_super_answer, rows=_super_rows, suggest=rib_suggest.suggest, hot=rib_suggest.hot_topics,
    pid_status=lambda: forecast_engine.engine_status(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]),
    pien_db=os.path.join(BASE_DIR, "pien.db"),
    rate_limit=lambda request: check_rate_limit(get_client_ip(request), bucket="scilem"),
    jurors=_super_jurors(), ask_juror=_super_ask_juror, judge=_super_judge,
    # each panel question calls up to six models: its own, stricter bucket
    panel_rate_limit=lambda request: check_rate_limit(get_client_ip(request), bucket="assess"),
    # the super prompt box asks each engine on its own: one bucket per engine
    juror_ready=_super_juror_ready,
    one_rate_limit=lambda request, engine: check_rate_limit(get_client_ip(request), bucket="sp-" + engine)))


# ---------------------------------------------------------------------------
# 9. Serve the frontend (single-page static app)
# ---------------------------------------------------------------------------
_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

# Asset versions are derived from file mtimes, not maintained by hand.
#
# index.html references its assets as `app.js?v=16`. That integer was edited
# manually on each release, and when it was forgotten — which is the normal
# outcome for a number a human has to remember to change — every returning
# browser kept serving the previously cached JS and CSS. The symptom is
# indistinguishable from the code being broken: fixes ship, the deployment is
# correct, and the user sees the old behaviour with no error anywhere.
#
# Rewriting the query string from the file's modification time removes the
# step. Change a file, its version changes; do not, and the browser cache
# stays valid. Done on the way out rather than by editing the file on disk, so
# the source stays readable and nothing has to be regenerated at build time.
_ASSET_QUERY = re.compile(r'\b(?P<file>[\w./-]+\.(?:js|css))\?v=[\w.]+')


def _asset_version(filename: str) -> str:
    try:
        return str(int(os.path.getmtime(os.path.join(_FRONTEND_DIR, filename))))
    except OSError:
        # Unknown file: leave the cache-buster alone rather than invent one
        # that changes on every request and defeats caching entirely.
        return ""


def _versioned_index() -> str:
    with open(os.path.join(_FRONTEND_DIR, "index.html"), "r", encoding="utf-8") as fh:
        html = fh.read()

    def sub(match):
        version = _asset_version(match.group("file"))
        return f"{match.group('file')}?v={version}" if version else match.group(0)

    return _ASSET_QUERY.sub(sub, html)


if os.path.isdir(_FRONTEND_DIR):
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def _serve_index():
        """index.html with asset versions stamped from the files on disk.

        no-store on the HTML itself, because it is the document that carries
        the version numbers — a cached copy of it would pin the browser to
        whatever asset versions were current when it was cached, which is the
        exact failure this exists to prevent. The assets it points at stay
        aggressively cacheable, which is where the benefit actually is.
        """
        try:
            headers = {"Cache-Control": "no-store, must-revalidate"}
            if IS_EXPERIMENTAL:
                headers["X-Robots-Tag"] = "noindex, nofollow"
            return HTMLResponse(_versioned_index(), headers=headers)
        except OSError:
            raise HTTPException(status_code=404, detail="Frontend is not available.")

    # The Lab boots HAL-OS in the browser with v86, which is an ES module
    # (.mjs) plus WebAssembly. Browsers refuse a module script served with a
    # non-JavaScript MIME type, and python:3.11-slim has no /etc/mime.types to
    # fall back on, so the two types are registered explicitly rather than
    # left to whatever the container happens to know.
    import mimetypes
    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("font/woff2", ".woff2")   # the self-hosted Geist typeface

    # Mounted after the routes above so "/" resolves to the stamped index
    # rather than to the raw file on disk.
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
