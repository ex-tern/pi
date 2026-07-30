import os

# Must happen BEFORE numpy/torch are imported below — these libraries read
# these env vars once, at import time, to size their internal thread pools.
# On a memory-constrained host (e.g. a 512MB container), the default thread
# count (based on the host's *reported* CPU count, which is often
# misleading in shared/containerized environments) allocates far more
# thread-local memory than a small instance can spare. Capping at 1 is a
# meaningful, low-risk memory reduction for this app's actual workload
# (small MLP/LSTM forward passes, not large batch training).
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

import json
import time
import logging
import math
import random
import hashlib
import re
import difflib
import concurrent.futures
from datetime import datetime
from typing import Tuple, Dict

import fitz
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset
from openai import OpenAI
from functools import lru_cache

torch.set_num_threads(1)  # belt-and-suspenders; some backends don't fully honor the env vars above

try:
    from openrouter import OpenRouter
    OPENROUTER_SDK_AVAILABLE = True
except Exception:
    OpenRouter = None
    OPENROUTER_SDK_AVAILABLE = False

from config import (
    GROQ_API_KEY, OR_API_KEY, GEMINI_API_KEY,
    PRIMARY_MODEL, FALLBACK_MODEL, MAX_TEXT_TOKENS, EPOCH_BLOCK_SIZE, BASE_DIR
)
from database import get_db_connection
from ledger import (
    backup_state_to_web3, generate_zk_snark_proof, mint_pi_quotient_token, 
    validate_block_por, generate_blockchain_pi
)
from integrations import (
    clean_author_name, is_likely_institution, fetch_legacy_author_metrics,
    measure_legacy_citation_entropy
)
from scientometrics import (
    fetch_topic_diversity_for_doi, audit_citation_integrity, assess_authorship_consistency,
    classify_manuscript_fields, measure_panel_corroboration, measure_citation_engagement,
    measure_citation_resolvability, measure_open_licensing, measure_persistent_identifier_use,
    fetch_author_metrics,
)
from rubric import (
    apply_scoring_rubric, explain_all_criteria, compute_composite_score, CRITERIA_ORDER as RUBRIC_CRITERIA_ORDER,
    RUBRIC_VERSION,
)
from security import (
    issue_integrity_canary, build_security_directive, run_static_integrity_scan,
    apply_panel_integrity_verdict, redact_canary, detect_canary_in_panel_output,
)
from rebuttal import generate_rebuttal_strategy as _optimized_rebuttal_strategy
from providers import (
    build_routes, classify_provider_error, redact_provider_text, provider_configuration,
)
from emission import compute_piq_emission, emission_manifest
from extraction import (
    extract_from_pdf_layout, fetch_registry_metadata, reconcile_bibliographic_record,
    parse_reference_entries, summarize_references, clean_author_list,
)
from http_client import guarded, run_bounded

# The ScilemNetwork LSTM that lived here has been removed. It embedded
# md5-hashed token IDs — arbitrary integers with no relation to word meaning
# and frequent collisions — and was trained to regress a hash digest. Neither
# its inputs nor its target carried learnable signal, so its output was noise
# with a neural network wrapped around it. `compute_structural_quality()`
# replaces it with the deterministic checks that were doing the real work.


@lru_cache(maxsize=1)
def load_local_language_model():
    from transformers import pipeline
    return pipeline("text-generation", model="TinyLlama/TinyLlama-1.1B-Chat-v1.0", device_map="auto")

def generate_assistant_reply(raw_text):
    try:
        scilem_nlp = load_local_language_model()
        prompt = f"<|system|>\nYou are Scilem, the AI assistant for the Pi-Index Framework.\n<|user|>\n{raw_text}\n<|assistant|>"
        response = scilem_nlp(prompt, max_new_tokens=150, truncation=True)
        generated_text = response[0]['generated_text'].split("<|assistant|>")[-1].strip()
        return f"**Scilem:** {generated_text}"
    except Exception as e:
        return f"Scilem Local Neural Engine initialization failed: {e}"

def compute_structural_quality(paper_text: str) -> float:
    """Deterministic structural quality in [0, 1].

    This replaced the Scilem neural score, which was not capable of measuring
    anything. That network hashed each word to an arbitrary integer in
    [0, 10000) and embedded the result: token IDs bore no relation to meaning,
    unrelated words collided constantly, and the whole thing was trained on a
    hash digest. Its output was a deterministic function of the text with no
    learned structure — noise with a neural network wrapped around it.

    What remains is the part that was always doing the real work: the
    deterministic reporting, reproducibility and empirical-density checks. They
    are transparent, reproducible, explainable to a researcher, and cost
    nothing to run.
    """
    if not paper_text or not paper_text.strip():
        return 0.0
    mdar, rrid_count = measure_mdar_adherence(paper_text)
    repro, _ = measure_reproducibility_markers(paper_text)
    density = measure_empirical_density(paper_text)
    rrid_component = min(1.0, rrid_count / 5.0)
    # Weighted to match the rubric's emphasis: methodology and evidence
    # dominate, open-science artefacts contribute, RRIDs are a bonus signal.
    return round(min(1.0, max(0.0,
        (mdar * 0.35) + (density * 0.30) + (repro * 0.25) + (rrid_component * 0.10))), 6)


def assess_with_structural_analyzer(paper_text, canary=""):
    scilem_numeric_score = compute_structural_quality(paper_text) * 100.0

    lines = [l.strip() for l in paper_text.split("\n") if l.strip()]
    cand_title = lines[0] if lines else "Scilem Neural Extraction"
    cand_author = "Independent Research Scholar"
    for line in lines[1:10]:
        if any(kw in line.lower() for kw in ["by", "author", "university", "department", "@"]):
            cand_author = line
            break

    mdar_signal, rrid_signal = measure_mdar_adherence(paper_text)
    repro_signal, repro_flags = measure_reproducibility_markers(paper_text)
    density_signal = measure_empirical_density(paper_text)
    detected_markers = [k.replace("_", " ") for k, v in repro_flags.items() if v]

    opinion = (
        f"Scilem Structural Analysis: composite structural quality = "
        f"{scilem_numeric_score:.1f}/100, computed deterministically from the checks below. "
        f"Deterministic MDAR/RRID adherence measured at {mdar_signal * 100:.1f}% ({rrid_signal} valid RRID token(s)). "
        f"Empirical density signal (statistics, sample sizes, quantitative results) measured at {density_signal * 100:.1f}%. "
        f"Open-science reproducibility markers detected: "
        f"{', '.join(detected_markers) if detected_markers else 'none found in extracted text'} "
        f"(composite reproducibility signal {repro_signal * 100:.1f}%)."
    )

    return "scilem", {
        "title": cand_title[:120],
        "authors": clean_author_name(cand_author)[:80],
        "opinion": opinion,
        "references": [],
        "api_failed": False,
        "is_heuristic_fallback": True,
        "scilem_score": scilem_numeric_score,
    }

def update_structural_analyzer(raw_text, evidence_report, target_quality=None):
    """Retained as a no-op for call-site compatibility.

    The local network this trained has been removed: it embedded md5-hashed
    token IDs, so there was no learnable relationship between its inputs and
    any target. Structural quality is now computed deterministically by
    `compute_structural_quality`, which needs no training and is explainable.
    """
    return ("Scilem structural analysis is deterministic; no model training is performed.")


def clear_structural_analyzer_state():
    """Clear any weights left over from the removed neural scorer."""
    stale = os.path.join(BASE_DIR, "scilem_weights.pt")
    if os.path.exists(stale):
        try:
            os.remove(stale)
            return "Removed stale Scilem weights. Structural analysis is deterministic and needs no reset."
        except OSError as e:
            return f"Could not remove stale weights file: {e}"
    return "Nothing to reset: Scilem structural analysis is deterministic."

class PiBlockchainDataset(Dataset):
    def __init__(self, data_matrix, lookback):
        self.data = data_matrix
        self.lookback = lookback

    def __len__(self):
        return len(self.data) - self.lookback

    def __getitem__(self, idx):
        x = self.data[idx : idx + self.lookback]
        y = self.data[idx + self.lookback]
        return torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)

PidyneBlockchainDataset = PiBlockchainDataset

class PiBrainLSTM(nn.Module):
    def __init__(self, input_size=8, hidden_layer_size=32, output_size=8):
        super(PiBrainLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_layer_size, batch_first=True)
        self.linear = nn.Sequential(
            nn.Linear(hidden_layer_size, 16),
            nn.ReLU(),
            nn.Linear(16, output_size),
        )

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        predictions = self.linear(lstm_out[:, -1, :])
        return torch.softmax(predictions, dim=-1) * 8.0

PidyneLSTM = PiBrainLSTM

def request_model_assessment(provider_name, model_name, api_key, base_url, prompt):
    if not api_key or not str(api_key).strip():
        return provider_name, {
            "title": "N/A",
            "authors": "Unconfigured Key",
            "opinion": f"API key for {provider_name.upper()} is missing.",
            "references": [],
            "api_failed": True
        }
    try:
        if "openrouter" in base_url.lower() and OPENROUTER_SDK_AVAILABLE:
            with OpenRouter(api_key=api_key.strip()) as client:
                response = client.chat.send(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                )
                
                content = response.choices[0].message.content
                if content.startswith("```json"):
                    content = content.split("```json")[1].split("```")[0].strip()
                elif content.startswith("```"):
                    content = content.split("```")[1].split("```")[0].strip()
                    
                data = json.loads(content)
                data["api_failed"] = False
                return provider_name, data
        
        else:
            client = OpenAI(api_key=api_key.strip(), base_url=base_url)
            response = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            data = json.loads(response.choices[0].message.content)
            data["api_failed"] = False
            return provider_name, data
            
    except Exception as e:
        # The raw provider message is retained internally for the operator
        # diagnostics endpoint and the logs, but never becomes user-visible
        # text: these strings routinely name vendors, accounts and settings
        # URLs that are not a researcher's concern and are useful to an
        # attacker probing the deployment.
        raw = str(e)
        classified = classify_provider_error(raw)
        logging.warning("Provider call failed for %s/%s [%s]: %s",
                        provider_name, model_name, classified["category"], raw[:300])
        return provider_name, {
            "title": "N/A",
            "authors": "N/A",
            "opinion": classified["public"],
            "references": [],
            "api_failed": True,
            "failure_category": classified["category"],
            "_raw_error": raw,
        }

def build_assessment_prompt(paper_text, canary=""):
    front_matter = paper_text[:3000]
    lower_text = paper_text.lower()
    ref_section = ""
    for keyword in ["references", "bibliography", "works cited"]:
        idx = lower_text.rfind(keyword)
        if idx != -1:
            ref_section = paper_text[idx:idx+4000]
            break
    if not ref_section:
        ref_section = paper_text[-4000:]

    # The security directive is prepended so it establishes precedence before
    # the model ever reaches untrusted manuscript text, and the manuscript is
    # explicitly delimited as data.
    guard = build_security_directive(canary) if canary else ""

    return guard + f"""You are one of several independent expert reviewers assessing a manuscript.
Other reviewers are assessing it separately; your judgement will be compared against theirs, so
report what you actually observe rather than what you expect a reviewer to say.

Respond with JSON only. No prose outside the JSON object.

EXTRACTION RULES — accuracy here matters more than completeness:
- "title": the manuscript's own title. NOT the journal name, a running header, a DOI line, a
  copyright notice, or a preprint banner. If you cannot identify it confidently, return "".
- "authors": the human author names only, comma-separated, in order. Exclude affiliations,
  departments, universities, email addresses, superscript markers and corresponding-author notes.
  If none are identifiable, return "".

ASSESSMENT RULES:
- Judge only what the text actually contains. Do not credit work that is not evidenced.
- Be specific: cite what the manuscript says, not general praise or criticism.
- If a criterion cannot be judged from the excerpts provided, say so for that criterion.

Required JSON keys:
1. "title": string
2. "authors": string
3. "opinion": 120-250 words of substantive assessment. State the central claim, then the strongest
   and weakest aspects, referencing concrete evidence from the text.
4. "criteria": object with keys C1..C8. Each value is an object:
   {{"score": <0-100 integer>, "evidence": "<one specific sentence citing the manuscript>"}}
   C1 Semantic Originality, C2 Methodological Rigor, C3 Interdisciplinary Synergy,
   C4 Societal Impact, C5 Open Science, C6 Literature Integration, C7 Empirical Density,
   C8 Future Actionability.
5. "key_claims": array of up to 3 short strings — the manuscript's main claims as stated.
6. "concerns": array of up to 3 short strings — specific, actionable methodological concerns.
7. "references": array of up to 10 objects {{"citation": "[1]", "authors": "...", "year": "2024"}}

--- FRONT MATTER ---
{front_matter}

--- REFERENCES SECTION ---
{ref_section}
"""

def assess_with_route_chain(juror: str, paper_text: str, canary: str = ""):
    """Try each configured route for a juror until one returns a verdict.

    Previously each juror had exactly one route, so a single provider-side
    restriction removed it from the panel permanently — which is how a
    four-juror panel silently became a one-juror panel. Walking a chain means a
    blocked or rate-limited route degrades to the next rather than to nothing.

    Only errors that another route could plausibly fix are retried. An
    authentication failure or a credit exhaustion is an account-level fact and
    will recur identically on the next attempt, so retrying wastes the time
    budget without improving the outcome.
    """
    prompt = build_assessment_prompt(paper_text, canary)
    routes = build_routes(juror)
    if not routes:
        return juror, {
            "title": "N/A", "authors": "N/A",
            "opinion": "This model is not configured on this deployment.",
            "references": [], "api_failed": True,
            "failure_category": "not_configured",
        }

    attempts = []
    for route in routes:
        provider, data = request_model_assessment(
            juror, route["model"], route["key"], route["base"], prompt)
        if not data.get("api_failed"):
            data["route"] = {"model": route["model"], "provider": route["provider"]}
            data["route_attempts"] = attempts
            return juror, data

        classified = classify_provider_error(data.get("_raw_error") or data.get("opinion", ""))
        attempts.append({
            "model": route["model"], "provider": route["provider"],
            "category": classified["category"],
        })
        logging.warning("Juror %s route %s (%s) failed [%s]: %s",
                        juror, route["model"], route["provider"],
                        classified["category"], classified["internal"][:200])
        if not classified["retryable"]:
            break

    last = classified if attempts else {"public": "No route was reachable.", "category": "unknown"}
    return juror, {
        "title": "N/A", "authors": "N/A",
        # Public-safe: names no vendor, no account, no configuration URL.
        "opinion": last["public"],
        "references": [], "api_failed": True,
        "failure_category": last["category"],
        "route_attempts": attempts,
    }


def assess_with_llama(paper_text, canary=""):
    return assess_with_route_chain("llama", paper_text, canary)


def assess_with_mistral(paper_text, canary=""):
    return assess_with_route_chain("mistral", paper_text, canary)


def assess_with_qwen(paper_text, canary=""):
    return assess_with_route_chain("qwen", paper_text, canary)


def assess_with_gemini(paper_text, canary=""):
    return assess_with_route_chain("gemini", paper_text, canary)


def collect_independent_model_assessments(paper_text, canary=""):
    results = {}
    llm_funcs = {
        "llama": assess_with_llama,
        "mistral": assess_with_mistral,
        "qwen": assess_with_qwen,
        "gemini": assess_with_gemini,
        "scilem": assess_with_structural_analyzer
    }

    # 3 rather than one-per-provider: each thread reserves its own stack,
    # which adds up on a memory-constrained host. 5 short-lived HTTP calls
    # finishing slightly less in parallel is a good trade for not OOMing.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(func, paper_text, canary): name for name, func in llm_funcs.items()}
        for future in concurrent.futures.as_completed(futures):
            provider, data = future.result()
            results[provider] = data
    return results

def merge_assessments_into_report(consensus_results):
    successful_llms = [
        k for k, v in consensus_results.items()
        if not k.startswith("_") and isinstance(v, dict) and not v.get("api_failed", False)
    ]
    if not successful_llms:
        return "Synthesized Evidence Report (Unified Consensus)\n\nExternal APIs offline. Local Scilem neural analysis active."
    
    report_md = "Synthesized Evidence Report (Unified Consensus)\n\n"
    for provider in successful_llms:
        data = consensus_results[provider]
        report_md += f"### {provider.upper()} Assessment\n"
        report_md += f"- **Title Extracted:** {data.get('title', 'N/A')}\n"
        report_md += f"- **Authors:** {data.get('authors', 'N/A')}\n"
        report_md += f"- **Criteria Assessment:** {data.get('opinion', 'N/A')}\n\n"
    return report_md

MODEL_REGISTRY = {
    "llama": {"label": "Llama 3.3 70B", "role": "Panel Juror", "kind": "external"},
    "mistral": {"label": "Mistral Large", "role": "Panel Juror", "kind": "external"},
    "qwen": {"label": "Qwen 2.5 72B", "role": "Panel Juror", "kind": "external"},
    "gemini": {"label": "Gemini 2.0 Flash", "role": "Panel Juror", "kind": "external"},
    "scilem": {"label": "Scilem Local Neural Engine", "role": "Deterministic Structural Analyst", "kind": "local"},
}


def measure_title_agreement(consensus_results) -> float:
    """Pairwise similarity of the titles independently extracted by each
    participating model. High agreement means the panel converged on the
    same document interpretation, which is the strongest available signal
    that the consensus is trustworthy."""
    titles = [
        str(v.get("title", "")).strip().lower()
        for k, v in consensus_results.items()
        if k in MODEL_REGISTRY and not v.get("api_failed", False)
        and v.get("title") and "n/a" not in str(v.get("title", "")).lower()
    ]
    if len(titles) < 2:
        return 0.0
    ratios = []
    for i in range(len(titles)):
        for j in range(i + 1, len(titles)):
            ratios.append(difflib.SequenceMatcher(None, titles[i], titles[j]).ratio())
    return sum(ratios) / len(ratios) if ratios else 0.0


def grade_adjudication_quality(consensus_results) -> dict:
    """Grades the reliability of the panel's verdict.

    The core claim the Pidyne engine makes is that a verdict corroborated by
    several *independent* LLMs is materially higher quality than one produced
    by a single model: independent errors tend not to correlate, so agreement
    across providers is evidence, while a lone model's confidence is not.
    This function turns that into an explicit, reportable grade.
    """
    participating, failed = [], []
    for key, meta in MODEL_REGISTRY.items():
        entry = consensus_results.get(key)
        if entry is None:
            continue
        record = {
            "key": key,
            "label": meta["label"],
            "role": meta["role"],
            "kind": meta["kind"],
            "status": "failed" if entry.get("api_failed", False) else "active",
            "detail": str(entry.get("opinion", ""))[:400],
        }
        (failed if entry.get("api_failed", False) else participating).append(record)

    external_active = [m for m in participating if m["kind"] == "external"]
    n_external = len(external_active)
    agreement = measure_title_agreement(consensus_results)

    if n_external >= 3:
        tier, confidence = "High", 0.90 + min(0.08, 0.02 * (n_external - 3))
        rationale = (
            f"{n_external} independent external LLMs plus the local Scilem engine each assessed this "
            f"manuscript separately, and the Pidyne engine adjudicated their combined evidence. "
            f"Because the jurors come from different providers, model families and training corpora, "
            f"their errors are largely uncorrelated — agreement between them is therefore strong "
            f"evidence rather than repetition. Judgement quality for this assessment is HIGH."
        )
    elif n_external == 2:
        tier, confidence = "High", 0.82
        rationale = (
            "Two independent external LLMs cross-checked this manuscript alongside the local Scilem "
            "engine. Cross-provider corroboration was achieved, so the Pidyne verdict is treated as "
            "high quality, though a third juror would further tighten the confidence interval."
        )
    elif n_external == 1:
        tier, confidence = "Moderate", 0.65
        rationale = (
            "Only one external LLM was reachable for this assessment. The verdict is usable but was "
            "not corroborated across independent providers, so single-model bias cannot be ruled out. "
            "Judgement quality is MODERATE."
        )
    else:
        tier, confidence = "Limited", 0.40
        rationale = (
            "No external LLM was reachable. The verdict rests on the local Scilem neural engine and "
            "deterministic MDAR/RRID/reproducibility heuristics alone. These are reproducible and "
            "unbiased, but they cannot perform qualitative reasoning about novelty or argumentation. "
            "Judgement quality is LIMITED — treat the score as indicative only."
        )

    if n_external >= 2:
        if agreement >= 0.75:
            rationale += f" Inter-model agreement on document identification was strong ({agreement * 100:.0f}%)."
        elif agreement > 0:
            rationale += (
                f" Note: inter-model agreement on document identification was only {agreement * 100:.0f}%, "
                f"indicating the jurors diverged on how to read the manuscript's front matter."
            )
            if agreement < 0.4:
                tier, confidence = "Moderate", min(confidence, 0.60)

    return {
        "tier": tier,
        "confidence": round(confidence, 2),
        "rationale": rationale,
        "participating_models": participating,
        "failed_models": failed,
        "external_juror_count": n_external,
        "total_juror_count": len(participating),
        "inter_model_agreement": round(agreement, 3),
        "multi_llm": n_external >= 2,
    }


def summarize_panel_criteria(consensus_results) -> str:
    """Render per-criterion scores across jurors, with their spread.

    Divergence between independent jurors on a specific criterion is exactly
    the signal a human reviewer should look at first, so it is surfaced as a
    column rather than buried in prose.
    """
    labels = {
        "C1": "Semantic Originality", "C2": "Methodological Rigor",
        "C3": "Interdisciplinary Synergy", "C4": "Societal Impact",
        "C5": "Open Science", "C6": "Literature Integration",
        "C7": "Empirical Density", "C8": "Future Actionability",
    }
    collected = {key: [] for key in labels}
    evidence = {key: [] for key in labels}
    for provider, data in (consensus_results or {}).items():
        if provider.startswith("_") or not isinstance(data, dict) or data.get("api_failed"):
            continue
        block = data.get("criteria")
        if not isinstance(block, dict):
            continue
        for key in labels:
            entry = block.get(key)
            if isinstance(entry, dict):
                try:
                    collected[key].append(float(entry.get("score")))
                except (TypeError, ValueError):
                    pass
                note = str(entry.get("evidence", "")).strip()
                if note:
                    evidence[key].append(f"{provider.upper()}: {note}")
            else:
                try:
                    collected[key].append(float(entry))
                except (TypeError, ValueError):
                    pass

    if not any(collected.values()):
        return ""

    rows = ["\n#### Panel Criteria Assessment\n",
            "| Criterion | Jurors | Mean | Range | Agreement |",
            "| --- | --- | --- | --- | --- |"]
    for key, label in labels.items():
        values = collected[key]
        if not values:
            rows.append(f"| {key} {label} | 0 | — | — | not assessed |")
            continue
        mean = sum(values) / len(values)
        spread = max(values) - min(values)
        agreement = ("strong" if spread <= 10 else
                     "moderate" if spread <= 25 else "weak — jurors diverged")
        rows.append(
            f"| {key} {label} | {len(values)} | {mean:.0f} | "
            f"{min(values):.0f}–{max(values):.0f} | {agreement} |")

    detail = []
    for key, notes in evidence.items():
        if notes:
            detail.append(f"- **{key} {labels[key]}** — {notes[0][:240]}")
    if detail:
        rows.append("\n**Supporting evidence cited by jurors**\n")
        rows.extend(detail[:8])
    return "\n".join(rows) + "\n"


def collect_panel_lists(consensus_results, field: str, heading: str) -> str:
    """Merge a list-valued field across jurors, de-duplicated."""
    seen, items = set(), []
    for provider, data in (consensus_results or {}).items():
        if provider.startswith("_") or not isinstance(data, dict) or data.get("api_failed"):
            continue
        for entry in (data.get(field) or [])[:3]:
            text = str(entry).strip()
            key = text.lower()[:60]
            if text and key not in seen:
                seen.add(key)
                items.append(f"- {text[:220]}")
    if not items:
        return ""
    return f"\n#### {heading}\n\n" + "\n".join(items[:8]) + "\n"


def adjudicate_panel_verdict(consensus_results, text=None):
    prompt = "You are the Pidyne Assessment Engine. Review these independent model assessments:\n\n"
    active_count = 0
    for provider, data in consensus_results.items():
        if provider.startswith("_"):
            continue
        if not data.get("api_failed", False):
            active_count += 1
            prompt += f"### {provider.upper()} Assessment:\n"
            prompt += f"- Extracted Title: {data.get('title', 'N/A')}\n"
            prompt += f"- Extracted Authors: {data.get('authors', 'N/A')}\n"
            prompt += f"- Criteria Assessment: {data.get('opinion', 'N/A')}\n\n"

    prompt += """
Generate a comprehensive, structured Markdown Evidence Report and provide an overall AI Rating (0.0 to 100.0).
Respond strictly in JSON with keys:
1. "evidence_report": string containing the markdown report with sections for Executive Summary, 8 Criteria Audit, and Methodological Quality.
2. "ai_rating": float between 0.0 and 100.0.
"""
    api_key = GROQ_API_KEY or OR_API_KEY or GEMINI_API_KEY
    base_url = "https://api.groq.com/openai/v1" if GROQ_API_KEY else ("https://openrouter.ai/api/v1" if OR_API_KEY else "https://generativelanguage.googleapis.com/v1beta/openai/")
    
    if GROQ_API_KEY:
        model_name = PRIMARY_MODEL
        judge_platform = "Groq Cloud"
    elif OR_API_KEY:
        model_name = "meta-llama/llama-3.3-70b-instruct"
        judge_platform = "OpenRouter"
    elif GEMINI_API_KEY:
        model_name = "gemini-2.0-flash"
        judge_platform = "Google Gemini"
    else:
        model_name = "Scilem Local Neural Engine"
        judge_platform = "Local (API Fallback)"
    judge_provider = f"{judge_platform} (Model: {model_name})"

    data = None
    if api_key and active_count > 0:
        _, data = request_model_assessment("pidyne", model_name, api_key, base_url, prompt)
        if data.get("api_failed", True):
            data = None

    quality = grade_adjudication_quality(consensus_results)
    judge_succeeded = data is not None

    consensus_results["_judge_metadata"] = {
        "judge_provider": judge_provider,
        "judge_platform": judge_platform,
        "model_name": model_name,
        "judge_succeeded": judge_succeeded,
        "final_judge_label": (
            f"{model_name} via {judge_platform}" if judge_succeeded
            else "Scilem Local Neural Engine (deterministic fallback)"
        ),
        "timestamp": datetime.now().isoformat(),
        **quality,
    }

    juror_line = ", ".join(
        f"{m['label']}" for m in quality["participating_models"]
    ) or "none"

    # Aggregate the panel's structured per-criterion judgements. Previously the
    # report carried only free prose, so a reader could not see where the
    # jurors agreed and where they diverged — which is the most useful thing a
    # multi-model panel produces.
    criteria_table = summarize_panel_criteria(consensus_results)
    claims_block = collect_panel_lists(consensus_results, "key_claims", "Claims identified")
    concerns_block = collect_panel_lists(consensus_results, "concerns", "Concerns raised")
    header_prefix = (
        "### Final Verdict & Evidence Synthesis\n\n"
        f"| Field | Value |\n| --- | --- |\n"
        f"| Final Judge | `{consensus_results['_judge_metadata']['final_judge_label']}` |\n"
        f"| Jury Panel | {juror_line} |\n"
        f"| Independent External Jurors | {quality['external_juror_count']} |\n"
        f"| Judgement Quality | **{quality['tier']}** (confidence {quality['confidence']:.2f}) |\n"
        f"| Inter-Model Agreement | {quality['inter_model_agreement'] * 100:.0f}% |\n\n"
        f"> {quality['rationale']}\n\n"
        + criteria_table + claims_block + concerns_block +
        "\n---\n\n"
    )

    if not data:
        fallback_rep = merge_assessments_into_report(consensus_results)
        evidence_report = header_prefix + "**Note:** The external judge model was unavailable; this verdict was synthesized via the unified fallback consensus path.\n\n" + fallback_rep
        scilem_score = consensus_results.get("scilem", {}).get("scilem_score", 75.0)
        rating = float(scilem_score)
    else:
        raw_rep = data.get("evidence_report", "Synthesized Evidence Report generated successfully.")
        if "Synthesized Evidence Report" in raw_rep[:50] or raw_rep.startswith("###"):
            evidence_report = header_prefix + raw_rep
        else:
            evidence_report = header_prefix + f"Synthesized Evidence Report (Unified Consensus)\n\n{raw_rep}"
        try:
            rating = float(data.get("ai_rating", 75.0))
        except Exception:
            rating = 75.0
            
    return evidence_report, rating

def generate_scilem_fallback_report(text):
    scilem_rep = generate_assistant_reply(text)
    return f"Synthesized Evidence Report (Unified Consensus)\n\n### Scilem Neural Assessment\n{scilem_rep}"

def measure_mdar_adherence(text: str) -> Tuple[float, int]:
    text_lower = text.lower()
    blinded = 1.0 if re.search(r'\b(blinded|double-blind|single-blind|masking)\b', text_lower) else 0.0
    randomized = 1.0 if re.search(r'\b(randomized|randomly assigned|random sequence)\b', text_lower) else 0.0
    power_calc = 1.0 if re.search(r'\b(power analysis|sample size calculation|statistical power)\b', text_lower) else 0.0
    
    rrid_matches = re.findall(r'\brrid\s*:?\s*[a-zA-Z0-9_:-]+\b', text_lower)
    rrid_count = len(set(rrid_matches)) 
    rrid_score = min(1.0, rrid_count / 3.0) 
    mdar_adherence = (blinded + randomized + power_calc + rrid_score) / 4.0
    
    return mdar_adherence, rrid_count

def measure_reproducibility_markers(text: str) -> Tuple[float, Dict]:
    text_lower = text.lower()
    signals = {
        "code_or_data_repository": bool(re.search(
            r'\b(github\.com|gitlab\.com|bitbucket\.org|zenodo\.org|osf\.io|huggingface\.co)\b', text_lower)),
        "data_availability_statement": bool(re.search(
            r'\bdata availability\b|\bdata are available\b|\bdataset(?:s)? (?:is|are) available\b|\bcode availability\b',
            text_lower)),
        "open_license": bool(re.search(
            r'\b(mit license|apache license|gpl license|creative commons|cc[- ]by)\b', text_lower)),
        "containerized_execution": bool(re.search(
            r'\b(docker|singularity|containeri[sz]ed|reproducible environment|conda environment)\b', text_lower)),
        "supplementary_materials": bool(re.search(
            r'\bsupplementary (material|data|information|table|figure)\b', text_lower)),
        "preregistration": bool(re.search(
            r'\bpre-?registered\b|\bpre-?registration\b|\bosf\.io/registrations\b', text_lower)),
    }
    hits = sum(1 for v in signals.values() if v)
    total = len(signals)
    score = 0.30 + (hits / total) * 0.70
    return min(1.0, max(0.0, score)), signals

def measure_empirical_density(text: str) -> float:
    text_lower = text.lower()
    stat_terms = len(re.findall(
        r'\b(p\s*[<>=]\s*0?\.\d+|confidence interval|standard deviation|standard error|'
        r'anova|regression|t-test|chi-square|correlation coefficient|effect size|'
        r'p-value)\b', text_lower))
    sample_size_mentions = len(re.findall(r'\bn\s*=\s*\d+', text_lower))
    numeric_results = len(re.findall(r'\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*(?:ms|kg|mm|cm|km|hz|db)\b', text_lower))

    raw_signal = (stat_terms * 2) + (sample_size_mentions * 1.5) + numeric_results
    normalized = min(1.0, raw_signal / 40.0)
    return normalized

def truncate_to_token_budget(text, max_tokens):
    if len(text) <= max_tokens:
        return text
    front_matter = text[: int(max_tokens * 0.4)]
    back_matter = text[-int(max_tokens * 0.6) :]
    return front_matter + "\n...[TRUNCATED FOR TOKEN LIMITS]...\n" + back_matter

def select_consensus_value(consensus_results, field):
    """Pick the value the largest share of jurors agree on.

    Values are clustered by fuzzy similarity rather than exact equality, since
    models differ on capitalisation, subtitle inclusion and trailing
    punctuation while extracting the same underlying title. Returns the
    representative value and the fraction of jurors supporting it, which
    doubles as a confidence measure.
    """
    candidates = []
    for key, entry in (consensus_results or {}).items():
        if key.startswith("_") or not isinstance(entry, dict):
            continue
        if entry.get("api_failed"):
            continue
        val = str(entry.get(field, "") or "").strip()
        if not val or "n/a" in val.lower() or val.lower() in ("unconfigured key", "none"):
            continue
        candidates.append(val)

    if not candidates:
        return ("Untitled Manuscript" if field == "title" else "Unidentified"), 0.0
    if len(candidates) == 1:
        return candidates[0], 1.0 / max(1, len(consensus_results))

    clusters = []
    for val in candidates:
        placed = False
        for cluster in clusters:
            if difflib.SequenceMatcher(None, val.lower(), cluster[0].lower()).ratio() >= 0.80:
                cluster.append(val)
                placed = True
                break
        if not placed:
            clusters.append([val])

    winner = max(clusters, key=len)
    # Within the winning cluster, prefer the longest form — models truncate
    # more often than they invent, so the fullest variant is usually correct.
    representative = max(winner, key=len)
    return representative, round(len(winner) / len(candidates), 4)


def run_evaluation_pipeline(text, model, text_limit, file_hash="unknown", canary=""):
    text = truncate_to_token_budget(text, text_limit)
    consensus_results = collect_independent_model_assessments(text, canary)

    evidence_report, pidyne_ai_rating = adjudicate_panel_verdict(consensus_results, text)

    # Scan for the canary BEFORE stripping it — order matters here, since
    # stripping first would erase the very signal we are looking for.
    canary_result = detect_canary_in_panel_output(consensus_results, canary) if canary else \
        {"detected": False, "models": [], "confidence": "none"}

    # The canary is an internal control signal. Remove it from anything that
    # will be stored or displayed, so it cannot be harvested from a published
    # dossier and pre-empted by a later submitter.
    for _k, _entry in consensus_results.items():
        if isinstance(_entry, dict):
            _entry.pop("_raw_error", None)

    if canary:
        evidence_report = redact_canary(evidence_report, canary)
        for key, entry in consensus_results.items():
            if key.startswith("_") or not isinstance(entry, dict):
                continue
            if isinstance(entry.get("opinion"), str):
                entry["opinion"] = redact_provider_text(redact_canary(entry["opinion"], canary))
            # Raw provider errors must never reach the persisted record.
            entry.pop("_raw_error", None)

    scilem_opinion = update_structural_analyzer(text, evidence_report, pidyne_ai_rating)

    # Consensus extraction by agreement, not first-past-the-post. The previous
    # implementation took the first juror in a fixed provider order that
    # returned anything non-"N/A", so one model's misreading of the front
    # matter became the record even when three others agreed on something else.
    best_title, title_support = select_consensus_value(consensus_results, "title")
    best_author, author_support = select_consensus_value(consensus_results, "authors")

    scilem_score = consensus_results.get("scilem", {}).get("scilem_score", pidyne_ai_rating)

    # Confidence was hardcoded at 0.85 regardless of what actually happened.
    # It now reflects the panel: how many jurors returned a verdict and how
    # strongly they agreed on what they were reading.
    quality = (consensus_results.get("_judge_metadata") or {})
    agreement = float(quality.get("inter_model_agreement") or 0.0)
    jurors = int(quality.get("total_juror_count") or 0)
    confidence = round(min(0.99, (agreement * 0.5) + (min(jurors, 5) / 5.0 * 0.35)
                           + (title_support * 0.15)), 4)

    return {
        "Extracted_Title": best_title,
        "Extracted_Author": best_author,
        "Overall_Confidence": confidence,
        "_title_support": title_support,
        "_author_support": author_support,
        "_consensus_raw": consensus_results,
        "_evidence_report": evidence_report,
        "_pidyne_rating": pidyne_ai_rating,
        "_scilem_score": scilem_score,
        "_canary_result": canary_result,
    }

def compute_rubric_fingerprint():
    return hashlib.sha256(b"Pi-Index-Formula-State-v2.0").hexdigest()

def build_signal_vector(*, panel_rating, corroboration, mdar_adherence, rrid_count,
                        reproducibility, empirical_density, topology_detail,
                        reference_audit, text, text_complete=True):
    """Assemble the normalized [0, 1] signal vector the rubric consumes.

    This is the single place raw measurements become rubric inputs, so every
    normalization is visible in one function rather than scattered through
    scoring arithmetic.
    """
    topo = topology_detail or {}
    return {
        "panel_rating": (panel_rating or 0.0) / 100.0,
        "corroboration": corroboration,
        "mdar_adherence": mdar_adherence,
        # Saturates at 5 RRIDs: registering five distinct resources already
        # demonstrates the practice; the twentieth adds nothing.
        "rrid_density": min(1.0, (rrid_count or 0) / 5.0),
        "reproducibility": reproducibility,
        "empirical_density": empirical_density,
        "topic_diversity": topo.get("score", 0.35),
        "domain_span": 1.0 if topo.get("spans_domains") else 0.0,
        "citation_engagement": measure_citation_engagement(text, reference_audit),
        "reference_integrity": measure_citation_resolvability(reference_audit),
        "openness_licence": measure_open_licensing(text),
        "persistent_identifiers": measure_persistent_identifier_use(text),
        "text_completeness": 1.0 if text_complete else 0.0,
    }


def score_criteria_from_legacy_args(**kwargs):
    """Backwards-compatible shim over the versioned rubric.

    The historical signature took loose keyword arguments and applied
    undocumented coefficients. Scoring now lives in rubric.py; this wrapper
    keeps older call sites (and the test suite) working.
    """
    signals = kwargs.get("signals")
    if signals is None:
        signals = build_signal_vector(
            panel_rating=kwargs.get("ai_rating", 75.0),
            corroboration=kwargs.get("corroboration", 0.5),
            mdar_adherence=kwargs.get("sciscore_adherence", 0.8),
            rrid_count=kwargs.get("rrid_count", 0),
            reproducibility=kwargs.get("reproducibility_score", 0.0),
            empirical_density=kwargs.get("empirical_density") or 0.0,
            topology_detail=kwargs.get("topology_detail")
            or {"score": kwargs.get("topological_entropy", 0.5)},
            reference_audit=kwargs.get("reference_audit"),
            text=kwargs.get("text", ""),
        )
    return apply_scoring_rubric(signals)

CRITERIA_ORDER = [
    "C1_Semantic_Originality",
    "C2_Methodological_Rigor_SciScore",
    "C3_Interdisciplinary_Entropy",
    "C4_Societal_Impact",
    "C5_Open_Science_Repro",
    "C6_Literature_Integration",
    "C7_Empirical_Density",
    "C8_Future_Actionability_FAIR",
]

WEIGHT_INERTIA = 0.72  # how much of the previous epoch's weighting carries forward


def derive_next_epoch_weights(scores_dict, previous_weights=None):
    """Turn one manuscript's C1-C8 profile into the next block's criteria
    weights.

    This is the fix for the previously meaningless forecast: every block used
    to be written as a hard-coded [1.0] * 8, so the weight series was a flat
    line and the LSTM had literally no signal to learn from. Now each block
    records where the corpus's evidence actually concentrated.

    The mapping is: a criterion that manuscripts consistently score well on
    is well-evidenced and carries more weight; one they score poorly on is
    sparsely evidenced and is down-weighted. An exponential moving average
    against the previous block keeps the series a smooth, genuinely
    forecastable trajectory instead of per-paper noise, and the result is
    renormalized so the eight weights always sum to 8.0.
    """
    raw = []
    for key in CRITERIA_ORDER:
        val = scores_dict.get(key, 50.0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            val = 50.0
        raw.append(max(1.0, min(100.0, val)))

    total = sum(raw)
    if total <= 0:
        observed = [1.0] * 8
    else:
        observed = [(v / total) * 8.0 for v in raw]

    if previous_weights and len(previous_weights) == 8:
        prev = []
        for p in previous_weights:
            try:
                prev.append(float(p))
            except (TypeError, ValueError):
                prev.append(1.0)
        blended = [
            (WEIGHT_INERTIA * p) + ((1.0 - WEIGHT_INERTIA) * o)
            for p, o in zip(prev, observed)
        ]
    else:
        blended = observed

    # Clip and renormalize fight each other, so alternate until the vector
    # both sums to 8.0 and respects the per-criterion floor/ceiling. The
    # ceiling is the largest value feasible while the other seven hold their
    # floor — a tighter cap could not survive renormalization.
    w_min = 0.05
    w_max = 8.0 - (7 * w_min)
    for _ in range(12):
        blended = [max(w_min, min(w_max, w)) for w in blended]
        total = sum(blended)
        if total <= 0:
            return [1.0] * 8
        blended = [w * (8.0 / total) for w in blended]
        if all(w_min - 1e-9 <= w <= w_max + 1e-9 for w in blended):
            break
    return [round(w, 6) for w in blended]


def generate_rebuttal_strategy(scores_dict):
    """Delegates to the genetic-algorithm optimiser in rebuttal.py.

    The previous implementation returned one generic sentence naming the
    lowest criterion — the "lazy review" failure mode. Feedback is now evolved
    against an explicit fitness function rewarding actionability and
    specificity while penalising sycophantic and off-task language.
    """
    return _optimized_rebuttal_strategy(scores_dict)

# CRediT contributor roles, detected from what the manuscript actually
# describes. Previously every record was written as ["Data Curation"]
# unconditionally, which made the field meaningless.
_CREDIT_PATTERNS = {
    "Conceptualization": r"\b(conceptuali[sz]ation|study design|research question|hypothes[ei]s)\b",
    "Methodology": r"\b(methodolog|experimental design|protocol|procedure)\b",
    "Software": r"\b(github\.com|gitlab\.com|source code|implementation|we implemented|codebase)\b",
    "Validation": r"\b(validat|cross-validation|replicat|verified|robustness check)\b",
    "Formal Analysis": r"\b(statistical analys|regression|anova|significance test|formal analysis)\b",
    "Investigation": r"\b(we (conducted|performed|carried out)|experiment(s)? (were|was)|fieldwork)\b",
    "Data Curation": r"\b(dataset|data availability|data collection|curat|repositor)\b",
    "Writing": r"\b(this (paper|manuscript|article)|we (present|report|describe))\b",
    "Funding Acquisition": r"\b(funded by|grant no|financial support|acknowledge.{0,40}funding)\b",
}


def infer_credit_taxonomy_roles(text: str):
    """Detect CRediT taxonomy roles evidenced in the manuscript text."""
    if not text:
        return ["Unspecified"]
    lowered = text.lower()
    roles = [role for role, pattern in _CREDIT_PATTERNS.items()
             if re.search(pattern, lowered, re.IGNORECASE)]
    return roles or ["Unspecified"]


def _EMPTY_INTEGRITY():
    return {"compromised": False, "severity": "none", "techniques": [], "findings": [],
            "warnings": [], "hidden_text_detected": False, "scanned": False,
            "canary": {"detected": False, "models": [], "confidence": "none"}}


def _EMPTY_REFERENCE_AUDIT():
    return {"checked": 0, "verified": 0, "fabricated": 0, "unverified": 0, "total_found": 0,
            "fabricated_dois": [], "unverified_dois": [], "hallucination_ratio": 0.0,
            "verdict": "not_assessed", "warnings": [], "penalty_applied": False}


def _EMPTY_AUTHORSHIP():
    return {"assessed": False, "flag": "not_assessed", "confidence": "none",
            "indicators": [], "note": "", "affects_score": False}


def _EMPTY_TOPOLOGY():
    return {"score": 0.50, "basis": "unavailable", "topic_count": 0, "domains": [],
            "fields": [], "subfields": [], "spans_domains": False}


def process_single_pdf(
    file_bytes,
    filename,
    scope,
    user_id,
    book_address="None",
    email="None",
    provided_doi="None",
    force_proceed=False,
):
    active_weights = [1.0] * 8
    warnings_list = []

    if file_bytes is None or len(file_bytes) == 0:
        empty_scores = {k: 0.0 for k in [
            "C1_Semantic_Originality", "C2_Methodological_Rigor_SciScore", 
            "C3_Interdisciplinary_Entropy", "C4_Societal_Impact", 
            "C5_Open_Science_Repro", "C6_Literature_Integration", 
            "C7_Empirical_Density", "C8_Future_Actionability_FAIR"
        ]}
        warnings_list.append("Binary payload is empty or download/extraction failed.")
        return ("Download/Extraction Failed", "Independent Research Scholar", 0.0, 0.0,
                {}, [],
                ["Unclassified"], ["Unclassified"], empty_scores, "Failed", 0.0,
                "None", "None", active_weights, 0.0, 0, 0.0, False, warnings_list, {}, "", "N/A",
                _EMPTY_INTEGRITY(), _EMPTY_REFERENCE_AUDIT(), _EMPTY_AUTHORSHIP(), _EMPTY_TOPOLOGY(), {}, {})

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        cursor.execute(
            """SELECT title, author_name, final_score, logic_score, c1, c2, c3, c4, c5, c6, c7, c8,
                      piq_minted, tx_hash, zk_proof, mdar_adherence_score, rrid_valid_count,
                      reproducibility_score, consensus_data, evidence_report, scilem_score,
                      warnings_json, integrity_report, reference_audit, authorship_signal,
                      topology_detail, classification, criteria_breakdown, fields, subfields,
                      author_metrics, emission_record
               FROM papers_assessment WHERE eval_hash = ?""",
            (file_hash,),
        )
        existing = cursor.fetchone()
        if existing and not force_proceed:
            tx_prev = existing[13]
            was_minted_ok = (
                (isinstance(tx_prev, str) and tx_prev.startswith("0x") and len(tx_prev) == 66)
                or tx_prev == "Simulated_Ledger_Record"
            )
            if was_minted_ok:
                (
                    e_title, e_author, e_score, e_logic, e_c1, e_c2, e_c3, e_c4, e_c5, e_c6, e_c7, e_c8,
                    e_piq, e_tx, e_zk, e_mdar, e_rrid, e_repro, e_consensus, e_report, e_scilem,
                    e_warnings, e_integrity, e_refaudit, e_authorship, e_topology,
                    e_classification, e_breakdown, e_fields, e_subfields, e_authormetrics,
                    e_emission,
                ) = existing

                def _load(raw, fallback):
                    try:
                        parsed = json.loads(raw) if raw else None
                        return parsed if parsed else fallback
                    except Exception:
                        return fallback

                cached_warnings = _load(e_warnings, [])
                if not isinstance(cached_warnings, list):
                    cached_warnings = []
                cached_warnings = list(cached_warnings) + [
                    "CACHED RECORD: This manuscript was already assessed previously; the stored, "
                    "already-minted record is being returned instead of re-processing. No new "
                    "processing fee was charged."
                ]
                e_scores_dict = {
                    "C1_Semantic_Originality": e_c1, "C2_Methodological_Rigor_SciScore": e_c2,
                    "C3_Interdisciplinary_Entropy": e_c3, "C4_Societal_Impact": e_c4,
                    "C5_Open_Science_Repro": e_c5, "C6_Literature_Integration": e_c6,
                    "C7_Empirical_Density": e_c7, "C8_Future_Actionability_FAIR": e_c8,
                }
                return (
                    e_title, e_author, e_score, e_logic,
                    _load(e_classification, {}), _load(e_breakdown, []),
                    _load(e_fields, ["Unclassified"]), _load(e_subfields, ["Unclassified"]),
                    e_scores_dict, file_hash,
                    e_piq, e_tx, e_zk, active_weights, e_mdar, e_rrid, e_repro, True,
                    cached_warnings,
                    _load(e_consensus, {}), e_report or "", e_scilem,
                    _load(e_integrity, _EMPTY_INTEGRITY()),
                    _load(e_refaudit, _EMPTY_REFERENCE_AUDIT()),
                    _load(e_authorship, _EMPTY_AUTHORSHIP()),
                    _load(e_topology, _EMPTY_TOPOLOGY()),
                    _load(e_authormetrics, {}),
                    _load(e_emission, {}),
                )

        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pdf_meta_author = doc.metadata.get("author", "").strip()
            text_blocks = [page.get_text("text", sort=True) for page in doc]
            full_text = "\n".join(text_blocks)
        except Exception as e:
            warnings_list.append(f"PyMuPDF parsing note: {e}")
            full_text = ""

        mdar_score, rrid_count = measure_mdar_adherence(full_text)
        reproducibility_score, _repro_flags = measure_reproducibility_markers(full_text)
        empirical_density = measure_empirical_density(full_text)

        # --- External enrichment, bounded and fault-isolated -------------
        # Topic lookup, reference verification and author bibliometrics each
        # call third-party APIs. Run sequentially they could occupy the request
        # for minutes when a registry is slow, which surfaced as an unexplained
        # gateway timeout with the paper's fee already charged. They now run
        # concurrently under one budget, and any step that fails or overruns
        # degrades its own field rather than aborting the assessment.
        enrichment = run_bounded([
            ("topology", lambda: fetch_topic_diversity_for_doi(provided_doi)),
            ("references", lambda: audit_citation_integrity(full_text, budget_seconds=8.0)),
        ], budget_seconds=12.0, max_workers=2)

        topology_detail = enrichment.get("topology") or _EMPTY_TOPOLOGY()
        reference_audit = enrichment.get("references") or _EMPTY_REFERENCE_AUDIT()

        if "topology" not in enrichment:
            warnings_list.append(
                "TOPIC LOOKUP UNAVAILABLE: OpenAlex did not respond within the time budget, so "
                "interdisciplinarity fell back to a neutral prior rather than measured evidence."
            )
        if "references" not in enrichment:
            warnings_list.append(
                "REFERENCE AUDIT SKIPPED: the citation registries did not respond within the time "
                "budget. No references were counted as fabricated and no penalty was applied."
            )

        topological_entropy = topology_detail.get("score", 0.50)
        if topology_detail.get("basis") == "legacy-concepts":
            warnings_list.append(
                "TOPIC TAXONOMY: OpenAlex has not yet reprocessed this work under its current topic "
                "hierarchy, so interdisciplinarity was measured from the legacy concept taxonomy. "
                "C3 and C4 are correspondingly less precise."
            )
        elif topology_detail.get("basis") == "unavailable" and provided_doi not in ("None", "", None):
            warnings_list.append(
                "TOPIC LOOKUP FAILED: this work could not be resolved in OpenAlex, so "
                "interdisciplinarity fell back to a neutral prior rather than measured evidence."
            )
        warnings_list.extend(reference_audit.get("warnings", []))

        # --- Static adversarial integrity scan (pre-model, local only) ---
        integrity = guarded(lambda: run_static_integrity_scan(file_bytes, full_text),
                            fallback=_EMPTY_INTEGRITY(), label="integrity scan")

        # --- Advisory authorship signal (local only; never affects the score) ---
        authorship = guarded(lambda: assess_authorship_consistency(full_text),
                             fallback=_EMPTY_AUTHORSHIP(), label="authorship signal")

        # Single-use trigger for the inject-and-detect defence.
        canary = issue_integrity_canary(file_hash)

        raw_data = run_evaluation_pipeline(full_text, PRIMARY_MODEL, MAX_TEXT_TOKENS, file_hash, canary)

        pidyne_ai_rating = raw_data.get("_pidyne_rating", 75.0)
        scilem_score = raw_data.get("_scilem_score", pidyne_ai_rating)
        consensus_raw = raw_data.get("_consensus_raw", {})
        evidence_report = raw_data.get("_evidence_report", "")

        judge_meta_early = consensus_raw.get("_judge_metadata", {})

        # Replaces VAPRI. The old term was md5(evidence_report) % 1000 / 1000 —
        # a hash digest used as a score input. This measures how well the
        # evaluation actually corroborated itself.
        corroboration_detail = measure_panel_corroboration(judge_meta_early, evidence_report)
        corroboration = corroboration_detail["index"]

        # Real field classification. Every paper was previously written to the
        # database as ["Computer Science"] / ["Core Research Domain"], which
        # made the Global Map of Science a map of two string literals.
        classification = classify_manuscript_fields(full_text, topology_detail.get("_topics"))
        topology_detail.pop("_topics", None)

        external_active = any(
            not v.get("api_failed", False) 
            for k, v in consensus_raw.items() 
            if k != "scilem" and k != "_judge_metadata"
        )
        
        # Bibliographic reconciliation. Registry metadata beats PDF typography,
        # which beats the model panel's reading, which beats the filename.
        # Previously the title was whichever juror answered first, with a local
        # fallback of "line one of the PDF" — which on a published paper is
        # usually a journal banner rather than the title.
        registry_meta = guarded(lambda: fetch_registry_metadata(provided_doi),
                                fallback={}, label="registry metadata") or {}
        layout_meta = guarded(lambda: extract_from_pdf_layout(file_bytes),
                              fallback={}, label="pdf layout") or {}
        bibliographic = reconcile_bibliographic_record(
            registry=registry_meta,
            layout=layout_meta,
            model_title=raw_data.get("Extracted_Title", ""),
            model_authors=raw_data.get("Extracted_Author", ""),
            filename=filename,
        )
        title = bibliographic["title"]
        extracted_author = bibliographic["authors"]
        if extracted_author in ("", "Unidentified") and pdf_meta_author:
            cleaned_meta = clean_author_list(pdf_meta_author)
            if cleaned_meta:
                extracted_author = cleaned_meta
                bibliographic["authors"] = cleaned_meta
                bibliographic["authors_basis"] = "pdf-metadata"
                bibliographic["authors_confidence"] = 0.4

        if bibliographic["title_confidence"] < 0.5:
            warnings_list.append(
                f"LOW-CONFIDENCE TITLE: the title was inferred from "
                f"{bibliographic['title_basis'].replace('-', ' ')} and may be wrong. Supplying a DOI "
                f"lets the publisher-deposited record be used instead."
            )
        if bibliographic["authors_confidence"] < 0.5:
            warnings_list.append(
                f"LOW-CONFIDENCE AUTHORS: the author list was inferred from "
                f"{bibliographic['authors_basis'].replace('-', ' ')}. piQ attribution depends on this, "
                f"so verify it before relying on the leaderboard entry."
            )

        # Structured reference parsing, independent of DOI presence.
        reference_entries = guarded(lambda: parse_reference_entries(full_text),
                                    fallback=[], label="reference parsing") or []
        reference_summary = summarize_references(reference_entries)
        reference_audit["parsed_entries"] = len(reference_entries)
        reference_audit["summary"] = reference_summary
        if registry_meta.get("reference_count") and reference_summary["total"]:
            declared = registry_meta["reference_count"]
            found = reference_summary["total"]
            if found < declared * 0.5:
                warnings_list.append(
                    f"REFERENCE EXTRACTION INCOMPLETE: the publisher record lists {declared} "
                    f"references but only {found} could be parsed from the PDF. Literature "
                    f"engagement may be understated."
                )
        
        signal_vector = build_signal_vector(
            panel_rating=pidyne_ai_rating,
            corroboration=corroboration,
            mdar_adherence=mdar_score,
            rrid_count=rrid_count,
            reproducibility=reproducibility_score,
            empirical_density=empirical_density,
            topology_detail=topology_detail,
            reference_audit=reference_audit,
            text=full_text,
            text_complete=bool(full_text.strip()),
        )
        # Real author bibliometrics (h-index, i10-index). Reported for context;
        # deliberately NOT part of the signal vector, per CoARA's commitment to
        # abandon publication-based metrics in quality assessment.
        author_metrics = guarded(lambda: fetch_author_metrics(extracted_author),
                                 fallback={}, label="author bibliometrics")

        scores_dict = apply_scoring_rubric(signal_vector)
        criteria_breakdown = explain_all_criteria(signal_vector)

        # Fabricated citations invalidate the methodology section outright: a
        # methods claim resting on works that do not exist cannot be rigorous.
        if reference_audit.get("penalty_applied"):
            scores_dict["C2_Methodological_Rigor_SciScore"] = 0.0
            for entry in criteria_breakdown:
                if entry["id"] == "C2_Methodological_Rigor_SciScore":
                    entry["score"] = 0.0
                    entry["override"] = "Zeroed: fabricated references detected."

        # The Pidyne forecast previously predicted criteria weights that
        # affected nothing, because the composite was a flat mean. The current
        # epoch's weights now genuinely reweight it, and the epoch is recorded
        # alongside the score so historical results stay interpretable when the
        # weighting moves.
        cursor.execute(
            """SELECT block_height, w1, w2, w3, w4, w5, w6, w7, w8
               FROM blockchain_por_weights ORDER BY block_height DESC LIMIT 1"""
        )
        weight_row = cursor.fetchone()
        scoring_epoch = weight_row[0] if weight_row else 0
        epoch_weights = list(weight_row[1:9]) if weight_row else None

        final_score = compute_composite_score(scores_dict, epoch_weights)
        unweighted_score = compute_composite_score(scores_dict)

        # Logic integrity: how far the adjudicated verdict survives adversarial
        # discounting. The premise gap is the panel's own uncertainty; weak
        # corroboration compounds it, because an uncorroborated verdict is a
        # weaker premise than a corroborated one.
        premise_gap = 1.0 - (pidyne_ai_rating / 100.0)
        corroboration_gap = 1.0 - corroboration
        adversarial_penalty = math.exp(-(1.5 * premise_gap + 0.6 * corroboration_gap))
        logic_integrity = min(100.0, max(0.0, pidyne_ai_rating * adversarial_penalty))

        # --- Fold in the model panel's canary verdict ---
        integrity = apply_panel_integrity_verdict(integrity, consensus_raw, canary)

        # An attempt to manipulate the referee is disqualifying. Zeroing logic
        # integrity trips the existing minting gate below, so no piQ is issued
        # and the attempt is recorded permanently in the ledger dossier.
        if integrity.get("compromised"):
            logic_integrity = 0.0
        warnings_list.extend(integrity.get("warnings", []))

        # --- piQ emission, difficulty-adjusted for adoption ---
        # A flat piX/10 reward meant the hundred-thousandth paper earned what
        # the first did: unbounded supply, and early contributors diluted by
        # later volume at no disadvantage. Emission now hardens as the corpus
        # grows (halving schedule), the qualifying bar rises with it, and an
        # individual author's rate decays with their own output so piQ tracks
        # quality rather than volume.
        cursor.execute("SELECT COUNT(*) FROM papers_assessment")
        corpus_row = cursor.fetchone()
        corpus_size = corpus_row[0] if corpus_row else 0

        # Author identity resolves by OpenAlex ID where available. Matching on
        # the raw name string treated "J. Smith" and "John Smith" as different
        # researchers, which made per-author emission decay trivially evadable
        # by varying the byline.
        author_key = (author_metrics or {}).get("openalex_id") or ""
        author_paper_count = 0
        try:
            if author_key:
                cursor.execute(
                    """SELECT COUNT(*) FROM papers_assessment
                       WHERE author_openalex_id = ? AND eval_hash != ?""",
                    (author_key, file_hash),
                )
            else:
                cursor.execute(
                    """SELECT COUNT(*) FROM papers_assessment
                       WHERE LOWER(TRIM(author_name)) = LOWER(TRIM(?)) AND eval_hash != ?""",
                    (extracted_author or "", file_hash),
                )
            row = cursor.fetchone()
            author_paper_count = row[0] if row else 0
        except Exception:
            author_paper_count = 0

        emission = compute_piq_emission(
            pix_score=final_score,
            logic_integrity=logic_integrity,
            total_papers=corpus_size,
            author_paper_count=author_paper_count,
        )
        piq_minted = emission["minted"]
        if not emission["qualified"]:
            warnings_list.append("piQ NOT MINTED: " + " ".join(emission["reasons"]))
        elif emission["halving_epoch"] > 0 or emission["author_factor"] < 1.0:
            warnings_list.append(
                f"EMISSION DIFFICULTY: minted {piq_minted:.4f} piQ at halving epoch "
                f"{emission['halving_epoch']} (supply factor {emission['supply_factor']:.4f}, "
                f"author factor {emission['author_factor']:.4f}). Emission hardens as the "
                f"platform grows."
            )

        zk_proof = generate_zk_snark_proof(file_hash, pidyne_ai_rating, logic_integrity, "None")
        
        if external_active and book_address and book_address != "0x0000000000000000000000000000000000000000" and piq_minted > 0:
            tx_hash = mint_pi_quotient_token(book_address, piq_minted, file_hash, zk_proof)
        else:
            tx_hash = "Simulated_Ledger_Record"

        judge_meta = consensus_raw.get("_judge_metadata", {})
        if not external_active:
            warnings_list.append(
                "NOTICE: No external LLM juror was reachable. This assessment was completed using the "
                "local Scilem neural model and deterministic heuristics only; judgement quality is LIMITED."
            )
        elif judge_meta.get("external_juror_count", 0) == 1:
            warnings_list.append(
                "NOTICE: Only one external LLM juror participated. The verdict was not corroborated "
                "across independent providers; judgement quality is MODERATE."
            )
        if judge_meta.get("failed_models"):
            warnings_list.append(
                "MODEL AVAILABILITY: " + "; ".join(
                    f"{m['label']} did not return a verdict" for m in judge_meta["failed_models"]
                ) + "."
            )
        if not judge_meta.get("judge_succeeded", True):
            warnings_list.append(
                "JUDGE FALLBACK: The final adjudicating model was unavailable; the verdict was "
                "synthesized from the unified fallback consensus path instead."
            )
        agreement = judge_meta.get("inter_model_agreement", 0.0)
        if judge_meta.get("external_juror_count", 0) >= 2 and agreement < 0.4:
            warnings_list.append(
                f"LOW INTER-MODEL AGREEMENT: Jurors converged on the document's identity only "
                f"{agreement * 100:.0f}% of the time, suggesting ambiguous or poorly structured front matter."
            )
        if not full_text.strip():
            warnings_list.append(
                "TEXT EXTRACTION EMPTY: No machine-readable text could be extracted from this PDF "
                "(it may be a scanned image). Scores derive from limited signal."
            )
        elif len(full_text) < 2000:
            warnings_list.append(
                f"SHORT DOCUMENT: Only {len(full_text)} characters of text were extracted; "
                f"criteria coverage may be incomplete."
            )
        if rrid_count == 0:
            warnings_list.append(
                "NO VALID RRIDs: No Research Resource Identifiers were detected, which caps the "
                "achievable C2 Methodological Rigor score."
            )

        cursor.execute(
            """INSERT OR REPLACE INTO papers_assessment (
                eval_hash, user_id, title, filename, scope, c1, c2, c3, c4, c5, c6, c7, c8, 
                logic_score, scope_alignment, subfields, fields, author_name, final_score, 
                timestamp, eth_book, piq_minted, tx_hash, zk_proof, did, zk_email_proof, 
                gaming_penalty, mdar_adherence_score, rrid_valid_count, credit_taxonomy_roles,
                reproducibility_score, doi, consensus_data, evidence_report, scilem_score,
                warnings_json, judge_metadata, integrity_report, reference_audit,
                authorship_signal, topology_detail, classification, criteria_breakdown,
                signal_vector, rubric_version, author_metrics, emission_record,
                author_openalex_id, scoring_epoch, unweighted_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                file_hash, user_id, title, filename, scope, *scores_dict.values(),
                logic_integrity, 0.0,
                json.dumps(classification.get("subfields", ["Unclassified"])),
                json.dumps(classification.get("fields", ["Unclassified"])),
                extracted_author, final_score,
                datetime.now().isoformat(), book_address, piq_minted,
                tx_hash, zk_proof, user_id, "None", 0.0,
                mdar_score, rrid_count, json.dumps(infer_credit_taxonomy_roles(full_text)), reproducibility_score,
                provided_doi, json.dumps(consensus_raw), evidence_report, scilem_score,
                json.dumps(warnings_list), json.dumps(judge_meta),
                json.dumps(integrity), json.dumps(reference_audit),
                json.dumps(authorship), json.dumps(topology_detail),
                json.dumps(classification), json.dumps(criteria_breakdown),
                json.dumps(signal_vector), RUBRIC_VERSION, json.dumps(author_metrics),
                json.dumps(emission), author_key, scoring_epoch, unweighted_score
            ),
        )

        cursor.execute("SELECT COUNT(*) FROM blockchain_por_weights")
        count_row = cursor.fetchone()
        block_count = count_row[0] if count_row else 1

        cursor.execute(
            """SELECT block_hash, w1, w2, w3, w4, w5, w6, w7, w8
               FROM blockchain_por_weights ORDER BY block_height DESC LIMIT 1"""
        )
        hash_row = cursor.fetchone()
        prev_hash = hash_row[0] if hash_row and hash_row[0] else "0" * 64
        prev_weights = list(hash_row[1:9]) if hash_row else None

        # Each block now records the criteria weighting this manuscript's
        # evidence profile implies, instead of a constant [1.0] * 8. Without
        # this the Pidyne forecast has a perfectly flat input series and
        # cannot produce a meaningful prediction.
        active_weights = derive_next_epoch_weights(scores_dict, prev_weights)

        new_height = block_count + 1
        ts = datetime.now().isoformat()
        f_hash = compute_rubric_fingerprint()
        val_node, b_hash, por_p = validate_block_por(
            new_height, active_weights, ts, prev_hash, file_hash, "Pidyne_Scilem_Ensemble", final_score, f_hash
        )

        cursor.execute(
            """INSERT INTO blockchain_por_weights 
               (w1, w2, w3, w4, w5, w6, w7, w8, timestamp, previous_hash, validator_node, block_hash, eval_hash, model_used, por_proof, formulas_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (*active_weights, ts, prev_hash, val_node, b_hash, file_hash, "Pidyne_Scilem_Ensemble", por_p, f_hash)
        )

        conn.commit()
    finally:
        conn.close()

    backup_state_to_web3()

    return (
        title, extracted_author, final_score, logic_integrity,
        classification, criteria_breakdown,
        classification.get("fields", ["Unclassified"]),
        classification.get("subfields", ["Unclassified"]),
        scores_dict, file_hash, piq_minted, tx_hash, zk_proof,
        active_weights, mdar_score, rrid_count, reproducibility_score, False, warnings_list,
        consensus_raw, evidence_report, scilem_score,
        integrity, reference_audit, authorship, topology_detail, author_metrics, emission
    )
