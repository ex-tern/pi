"""routes/discover.py: discovery: hot topics, search, assessing pasted text, the defense strategy. Split from api.py; see DESIGN.md section 5."""
from fastapi import APIRouter
from core import *  # noqa: F401,F403
from routes.assess import _fmt_score, build_result_payload  # noqa: F401

router = APIRouter()



# ---------------------------------------------------------------------------
# 3b. AUTO-DISCOVERY — search open-access literature (OpenAlex) to feed
#     straight into the assessment pipeline above
# ---------------------------------------------------------------------------
@router.get("/api/discover/hot-topics")
def discover_hot_topics():
    """Currently active research topics, pulled live from OpenAlex.

    The previous implementation returned a hand-written list frozen at
    authoring time, which would have silently aged into a set of stale
    suggestions. HOT_TOPICS survives only as a last-resort seed for when
    OpenAlex is unreachable, and the response says which source was used so
    the UI never implies staleness is freshness.
    """
    # A fresh draw per request, from both sources.
    #
    # This row was static: the same ten chips in the same order on every visit,
    # which teaches a returning user that the suggestions are decoration and
    # stops them looking. Sampling means the row is worth a glance each time,
    # and it widens the corpus — a topic nobody is ever shown is a topic nobody
    # assesses.
    #
    # OpenAlex first when reachable, and its picks are shuffled too: "most
    # active concepts" is a stable ranking, so taking the top ten produced the
    # same list every time even though the source was live.
    result = fetch_active_research_topics(limit=30)
    live = list(result.get("topics") or [])
    if live:
        random.shuffle(live)
        return {**result, "topics": live[:10], "sampled": True}

    seeds = list(HOT_TOPICS)
    random.shuffle(seeds)
    return {"topics": seeds[:10], "source": "fallback-seed", "cached": False, "sampled": True}


@router.get("/api/discover/search")
def discover_search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=15, ge=1, le=30),
):
    check_rate_limit(get_client_ip(request), bucket="discover")
    error = ""
    try:
        results, error = search_scholarly_works(q, limit=limit)
    except Exception as e:                                       # noqa: BLE001
        add_log(f"Discovery search error: {e}")
        results, error = [], f"The search could not be completed ({type(e).__name__})."
    if error:
        add_log(f"Discovery search for {q!r}: {error}")
    # `error` is carried to the client rather than folded into an empty list.
    # An empty result and an unreachable provider are different facts, and the
    # interface cannot tell a user which one they are looking at unless the
    # server says so.
    return {"results": results, "query": q, "error": error}


class TextAssessRequest(BaseModel):
    paper_text: str


@router.post("/api/assess/text")
def assess_text(req: TextAssessRequest, request: Request):
    """Kept for parity with the previous stub API: assess raw pasted text
    instead of an uploaded PDF, by wrapping it in a virtual PDF."""
    check_rate_limit(get_client_ip(request), bucket="assess")
    if not req.paper_text.strip():
        raise HTTPException(status_code=400, detail="Paper text cannot be empty.")
    if len(req.paper_text) > 500_000:
        raise HTTPException(status_code=413, detail="Paper text is too long (max 500,000 characters).")
    pdf_bytes = build_pdf_from_text(req.paper_text, title="Pasted Manuscript Text")
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Could not convert text into a processable document.")
    res = process_single_pdf(pdf_bytes, "Pasted_Text.pdf", "", "Anonymous")
    if not res:
        raise HTTPException(status_code=500, detail="Assessment failed.")
    item = build_result_payload(res, "Pasted_Text.pdf")
    add_log(f"Assessed pasted text: score {_fmt_score(item.get('score'))}")
    return item


# ---------------------------------------------------------------------------
# 4. DEFENSE STRATEGY
# ---------------------------------------------------------------------------
class DefenseRequest(BaseModel):
    # Bounded on the way in. The handler is deterministic and cheap, but an
    # unbounded dict is still free server memory for anyone who asks, and
    # validating shape at the edge is cheaper than defending it everywhere.
    scores: Dict[str, float] = Field(default_factory=dict, max_length=64)


@router.post("/api/defense-strategy")
def defense_strategy(req: DefenseRequest):
    return {"strategy": generate_rebuttal_strategy(req.scores)}
