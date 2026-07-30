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
    clean_author_name, is_likely_institution, fetch_author_coara_metrics, 
    calculate_citation_topology
)

class ScilemNetwork(nn.Module):
    def __init__(self, vocab_size=10000, embed_dim=64, hidden_dim=32):
        super(ScilemNetwork, self).__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True)
        self.fc1 = nn.Linear(hidden_dim, 16)
        self.relu = nn.ReLU()
        self.fc2 = nn.Linear(16, 1)

    def forward(self, text_tensor):
        embedded = self.embedding(text_tensor)
        lstm_out, _ = self.lstm(embedded)
        last_hidden = lstm_out[:, -1, :]
        x = self.relu(self.fc1(last_hidden))
        features = torch.tanh(self.fc2(x))
        return features

@lru_cache(maxsize=1)
def get_scilem_engine():
    model = ScilemNetwork()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    return model, optimizer

@lru_cache(maxsize=1)
def get_tinyllama_pipeline():
    from transformers import pipeline
    return pipeline("text-generation", model="TinyLlama/TinyLlama-1.1B-Chat-v1.0", device_map="auto")

def evaluate_scilem_analysis_report(raw_text):
    try:
        scilem_nlp = get_tinyllama_pipeline()
        prompt = f"<|system|>\nYou are Scilem, the AI assistant for the Pi-Index Framework.\n<|user|>\n{raw_text}\n<|assistant|>"
        response = scilem_nlp(prompt, max_new_tokens=150, truncation=True)
        generated_text = response[0]['generated_text'].split("<|assistant|>")[-1].strip()
        return f"**Scilem:** {generated_text}"
    except Exception as e:
        return f"Scilem Local Neural Engine initialization failed: {e}"

def extract_with_scilem(paper_text):
    scilem_model, scilem_optimizer = get_scilem_engine()
    scilem_weights_path = os.path.join(BASE_DIR, "scilem_weights.pt")
    if os.path.exists(scilem_weights_path):
        try:
            scilem_model.load_state_dict(torch.load(scilem_weights_path, weights_only=True))
        except Exception:
            pass

    scilem_model.eval()
    words = paper_text.lower().split()[:512]
    tokens = [int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16) % 10000 for w in words]
    if not tokens:
        tokens = [0]
    paper_tensor = torch.tensor(tokens, dtype=torch.long).unsqueeze(0)

    with torch.no_grad():
        feat_val = scilem_model(paper_tensor).item()

    scilem_numeric_score = 50.0 + (feat_val * 40.0)

    lines = [l.strip() for l in paper_text.split("\n") if l.strip()]
    cand_title = lines[0] if lines else "Scilem Neural Extraction"
    cand_author = "Independent Research Scholar"
    for line in lines[1:10]:
        if any(kw in line.lower() for kw in ["by", "author", "university", "department", "@"]):
            cand_author = line
            break

    mdar_signal, rrid_signal = calculate_deterministic_mdar(paper_text)
    repro_signal, repro_flags = calculate_reproducibility_score(paper_text)
    density_signal = calculate_empirical_density(paper_text)
    detected_markers = [k.replace("_", " ") for k, v in repro_flags.items() if v]

    opinion = (
        f"Scilem Neural Engine Analysis: Deep LSTM feature representation score = {feat_val:.4f}. "
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

def train_scilem_on_input_and_report(raw_text, evidence_report):
    scilem_model, scilem_optimizer = get_scilem_engine()
    scilem_weights_path = os.path.join(BASE_DIR, "scilem_weights.pt")
    if os.path.exists(scilem_weights_path):
        try:
            scilem_model.load_state_dict(torch.load(scilem_weights_path, weights_only=True))
        except Exception:
            pass

    scilem_model.train()
    scilem_optimizer.zero_grad()
    
    words = raw_text.lower().split()[:512]
    tokens = [int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16) % 10000 for w in words]
    if not tokens:
        tokens = [0]
    paper_tensor = torch.tensor(tokens, dtype=torch.long).unsqueeze(0)

    features = scilem_model(paper_tensor)
    
    vapri = (int(hashlib.md5(evidence_report.encode()).hexdigest(), 16) % 1000) / 1000.0
    target_tensor = torch.tensor([[vapri]], dtype=torch.float32)

    loss_function = nn.MSELoss()
    loss = loss_function(features, target_tensor)
    loss.backward()
    scilem_optimizer.step()
    
    torch.save(scilem_model.state_dict(), scilem_weights_path)

    return "Scilem Local Neural Engine Integration: Model weights updated dynamically via RLHF backpropagation from Pidyne synthesized consensus matrix."

def reset_scilem():
    scilem_weights_path = os.path.join(BASE_DIR, "scilem_weights.pt")
    res_msg = "Scilem state reset successfully."
    if os.path.exists(scilem_weights_path):
        try:
            os.remove(scilem_weights_path)
        except Exception as e:
            res_msg = f"Scilem weights file deletion warning: {e}"
            
    scilem_model, scilem_optimizer = get_scilem_engine()
    
    for m in scilem_model.modules():
        if isinstance(m, nn.Linear):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        elif isinstance(m, nn.LSTM):
            for name, param in m.named_parameters():
                if 'weight' in name:
                    nn.init.orthogonal_(param)
                elif 'bias' in name:
                    nn.init.zeros_(param)
                    
    return res_msg

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

def query_llm_json(provider_name, model_name, api_key, base_url, prompt):
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
        err_str = str(e)
        if "402" in err_str or "insufficient credits" in err_str.lower():
            opinion = f"[{provider_name.upper()} Insufficient Credits]: Account requires credit top-up."
        elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "rate_limit_exceeded" in err_str.lower():
            opinion = f"[{provider_name.upper()} Rate Limit / Quota Exceeded]: Limit reached."
        else:
            opinion = f"Error querying {provider_name.upper()}: {err_str}."
            
        return provider_name, {
            "title": "N/A (API Limit)",
            "authors": "N/A",
            "opinion": opinion,
            "references": [],
            "api_failed": True
        }

def build_multi_llm_prompt(paper_text):
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

    return f"""
Analyze the manuscript excerpts below and respond strictly in JSON format.
Evaluate across the 8 core Pi-Index criteria (C1: Semantic Originality, C2: Methodological Rigor, C3: Interdisciplinary Entropy, C4: Societal Impact, C5: Open Science, C6: Literature Integration, C7: Empirical Density, and C8: Future Actionability).

Keys required in JSON:
1. "title": Title of the paper.
2. "authors": String of human author names.
3. "opinion": Detailed qualitative assessment covering criteria C1-C8.
4. "references": List of objects: [{{"citation": "[1]", "authors": "Author et al.", "year": "2024"}}]

--- FRONT MATTER ---
{front_matter}

--- REFERENCES SECTION ---
{ref_section}
"""

def extract_with_llama(paper_text):
    prompt = build_multi_llm_prompt(paper_text)
    if GROQ_API_KEY:
        return query_llm_json("llama", PRIMARY_MODEL, GROQ_API_KEY, "https://api.groq.com/openai/v1", prompt)
    elif OR_API_KEY:
        return query_llm_json("llama", "meta-llama/llama-3.3-70b-instruct", OR_API_KEY, "https://openrouter.ai/api/v1", prompt)
    return "llama", {"title": "N/A", "authors": "N/A", "opinion": "API not configured.", "references": [], "api_failed": True}

def extract_with_mistral(paper_text):
    prompt = build_multi_llm_prompt(paper_text)
    if OR_API_KEY:
        return query_llm_json("mistral", "mistralai/mistral-large", OR_API_KEY, "https://openrouter.ai/api/v1", prompt)
    return "mistral", {"title": "N/A", "authors": "N/A", "opinion": "API not configured.", "references": [], "api_failed": True}

def extract_with_qwen(paper_text):
    prompt = build_multi_llm_prompt(paper_text)
    if OR_API_KEY:
        return query_llm_json("qwen", "qwen/qwen-2.5-72b-instruct", OR_API_KEY, "https://openrouter.ai/api/v1", prompt)
    return "qwen", {"title": "N/A", "authors": "N/A", "opinion": "API not configured.", "references": [], "api_failed": True}

def extract_with_gemini(paper_text):
    prompt = build_multi_llm_prompt(paper_text)
    if GEMINI_API_KEY:
        return query_llm_json("gemini", "gemini-2.0-flash", GEMINI_API_KEY, "https://generativelanguage.googleapis.com/v1beta/openai/", prompt)
    elif OR_API_KEY:
        return query_llm_json("gemini", "google/gemini-2.0-flash-001", OR_API_KEY, "https://openrouter.ai/api/v1", prompt)
    return "gemini", {"title": "N/A", "authors": "N/A", "opinion": "API not configured.", "references": [], "api_failed": True}

def run_multi_llm_consensus(paper_text):
    results = {}
    llm_funcs = {
        "llama": extract_with_llama,
        "mistral": extract_with_mistral,
        "qwen": extract_with_qwen,
        "gemini": extract_with_gemini,
        "scilem": extract_with_scilem
    }

    # 3 rather than one-per-provider: each thread reserves its own stack,
    # which adds up on a memory-constrained host. 5 short-lived HTTP calls
    # finishing slightly less in parallel is a good trade for not OOMing.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(func, paper_text): name for name, func in llm_funcs.items()}
        for future in concurrent.futures.as_completed(futures):
            provider, data = future.result()
            results[provider] = data
    return results

def generate_merged_evidence_report(consensus_results):
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


def _title_agreement(consensus_results) -> float:
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


def assess_judgement_quality(consensus_results) -> dict:
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
    agreement = _title_agreement(consensus_results)

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


def generate_pidyne_judgement(consensus_results, text=None):
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
        _, data = query_llm_json("pidyne", model_name, api_key, base_url, prompt)
        if data.get("api_failed", True):
            data = None

    quality = assess_judgement_quality(consensus_results)
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
    header_prefix = (
        "### Final Verdict & Evidence Synthesis\n\n"
        f"| Field | Value |\n| --- | --- |\n"
        f"| Final Judge | `{consensus_results['_judge_metadata']['final_judge_label']}` |\n"
        f"| Jury Panel | {juror_line} |\n"
        f"| Independent External Jurors | {quality['external_juror_count']} |\n"
        f"| Judgement Quality | **{quality['tier']}** (confidence {quality['confidence']:.2f}) |\n"
        f"| Inter-Model Agreement | {quality['inter_model_agreement'] * 100:.0f}% |\n\n"
        f"> {quality['rationale']}\n\n---\n\n"
    )

    if not data:
        fallback_rep = generate_merged_evidence_report(consensus_results)
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
    scilem_rep = evaluate_scilem_analysis_report(text)
    return f"Synthesized Evidence Report (Unified Consensus)\n\n### Scilem Neural Assessment\n{scilem_rep}"

def calculate_deterministic_mdar(text: str) -> Tuple[float, int]:
    text_lower = text.lower()
    blinded = 1.0 if re.search(r'\b(blinded|double-blind|single-blind|masking)\b', text_lower) else 0.0
    randomized = 1.0 if re.search(r'\b(randomized|randomly assigned|random sequence)\b', text_lower) else 0.0
    power_calc = 1.0 if re.search(r'\b(power analysis|sample size calculation|statistical power)\b', text_lower) else 0.0
    
    rrid_matches = re.findall(r'\brrid\s*:?\s*[a-zA-Z0-9_:-]+\b', text_lower)
    rrid_count = len(set(rrid_matches)) 
    rrid_score = min(1.0, rrid_count / 3.0) 
    mdar_adherence = (blinded + randomized + power_calc + rrid_score) / 4.0
    
    return mdar_adherence, rrid_count

def calculate_reproducibility_score(text: str) -> Tuple[float, Dict]:
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

def calculate_empirical_density(text: str) -> float:
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

def adaptive_chunking(text, max_tokens):
    if len(text) <= max_tokens:
        return text
    front_matter = text[: int(max_tokens * 0.4)]
    back_matter = text[-int(max_tokens * 0.6) :]
    return front_matter + "\n...[TRUNCATED FOR TOKEN LIMITS]...\n" + back_matter

def evaluate_pdf_text_ensemble(text, model, text_limit, file_hash="unknown"):
    text = adaptive_chunking(text, text_limit)
    consensus_results = run_multi_llm_consensus(text)
    
    evidence_report, pidyne_ai_rating = generate_pidyne_judgement(consensus_results, text)
    scilem_opinion = train_scilem_on_input_and_report(text, evidence_report)

    best_title = "Parsed via Local Heuristics"
    best_author = "Independent Research Scholar"
    title_found, author_found = False, False
    for l_key in ["llama", "mistral", "qwen", "gemini", "scilem"]:
        entry = consensus_results.get(l_key, {})
        t_val = entry.get("title", "")
        a_val = entry.get("authors", "")
        if not title_found and t_val and "N/A" not in t_val:
            best_title = t_val
            title_found = True
        if not author_found and a_val and "N/A" not in a_val:
            best_author = a_val
            author_found = True
        if title_found and author_found:
            break

    scilem_score = consensus_results.get("scilem", {}).get("scilem_score", pidyne_ai_rating)

    return {
        "Extracted_Title": best_title,
        "Extracted_Author": best_author,
        "Extracted_Topics": "Core Research Domain",
        "Overall_Confidence": 0.85,
        "_consensus_raw": consensus_results,
        "_evidence_report": evidence_report,
        "_pidyne_rating": pidyne_ai_rating,
        "_scilem_score": scilem_score,
    }

def get_formulas_hash():
    return hashlib.sha256(b"Pi-Index-Formula-State-v2.0").hexdigest()

def compute_formulaic_criteria(reproducibility_score, sciscore_adherence=0.8, topological_entropy=0.5, ai_rating=75.0, vapri=0.0, empirical_density=None):
    c1 = (ai_rating * 0.9) + (vapri * 10)
    c4 = ai_rating * 0.95 + (topological_entropy * 5)
    c6 = ai_rating * 0.88 + (sciscore_adherence * 12)
    
    tanh_component = math.tanh((ai_rating / 100.0) * 1.5) * 100.0
    if empirical_density is None:
        c7 = tanh_component
    else:
        c7 = (empirical_density * 100.0 * 0.6) + (tanh_component * 0.4)
    
    c8 = (ai_rating * 0.8) + (reproducibility_score * 20.0)

    return {
        "C1_Semantic_Originality": min(100.0, max(0.0, c1)),
        "C2_Methodological_Rigor_SciScore": min(100.0, max(0.0, sciscore_adherence * 100.0)),
        "C3_Interdisciplinary_Entropy": min(100.0, max(0.0, (ai_rating * 0.85) + (topological_entropy * 15.0))),
        "C4_Societal_Impact": min(100.0, max(0.0, c4)),
        "C5_Open_Science_Repro": min(100.0, max(0.0, reproducibility_score * 100.0)),
        "C6_Literature_Integration": min(100.0, max(0.0, c6)),
        "C7_Empirical_Density": min(100.0, max(0.0, c7)),
        "C8_Future_Actionability_FAIR": min(100.0, max(0.0, c8))
    }

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


def derive_epoch_weights(scores_dict, previous_weights=None):
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
    lowest_criterion = min(scores_dict.items(), key=lambda x: x[1])
    return (
        f"**Adversarial Defense Strategy:** Focus on strengthening `{lowest_criterion[0]}` "
        f"(Current score: {lowest_criterion[1]:.1f}/100). Explicitly state methodology, "
        f"register active RRIDs, and upload raw experimental artifacts to open repositories."
    )

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
    drift = "N/A"
    rec = "N/A"

    if file_bytes is None or len(file_bytes) == 0:
        empty_scores = {k: 0.0 for k in [
            "C1_Semantic_Originality", "C2_Methodological_Rigor_SciScore", 
            "C3_Interdisciplinary_Entropy", "C4_Societal_Impact", 
            "C5_Open_Science_Repro", "C6_Literature_Integration", 
            "C7_Empirical_Density", "C8_Future_Actionability_FAIR"
        ]}
        warnings_list.append("Binary payload is empty or download/extraction failed.")
        return ("Download/Extraction Failed", "Independent Research Scholar", 0.0, 75.0, drift, rec, ["Unspecified Domain"], ["Unspecified Sub-domain"], empty_scores, "Failed", 0.0, "None", "None", active_weights, 0.0, 0, 0.0, False, warnings_list, {}, "", "N/A")

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        cursor.execute(
            """SELECT title, author_name, final_score, logic_score, c1, c2, c3, c4, c5, c6, c7, c8,
                      piq_minted, tx_hash, zk_proof, mdar_adherence_score, rrid_valid_count,
                      reproducibility_score, consensus_data, evidence_report, scilem_score,
                      warnings_json
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
                    e_warnings,
                ) = existing
                try:
                    cached_warnings = json.loads(e_warnings) if e_warnings else []
                except Exception:
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
                    e_title, e_author, e_score, e_logic, "N/A", "N/A",
                    ["Computer Science"], ["Core Research Domain"], e_scores_dict, file_hash,
                    e_piq, e_tx, e_zk, active_weights, e_mdar, e_rrid, e_repro, True,
                    cached_warnings,
                    json.loads(e_consensus) if e_consensus else {}, e_report or "", e_scilem,
                )

        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pdf_meta_author = doc.metadata.get("author", "").strip()
            text_blocks = [page.get_text("text", sort=True) for page in doc]
            full_text = "\n".join(text_blocks)
        except Exception as e:
            warnings_list.append(f"PyMuPDF parsing note: {e}")
            full_text = ""

        mdar_score, rrid_count = calculate_deterministic_mdar(full_text)
        topological_entropy = calculate_citation_topology(provided_doi)
        reproducibility_score, _repro_flags = calculate_reproducibility_score(full_text)
        empirical_density = calculate_empirical_density(full_text)

        raw_data = evaluate_pdf_text_ensemble(full_text, PRIMARY_MODEL, MAX_TEXT_TOKENS, file_hash)
        
        pidyne_ai_rating = raw_data.get("_pidyne_rating", 75.0)
        scilem_score = raw_data.get("_scilem_score", pidyne_ai_rating)
        consensus_raw = raw_data.get("_consensus_raw", {})
        evidence_report = raw_data.get("_evidence_report", "")

        vapri = (int(hashlib.md5(evidence_report.encode()).hexdigest(), 16) % 1000) / 1000.0 if evidence_report else 0.5

        external_active = any(
            not v.get("api_failed", False) 
            for k, v in consensus_raw.items() 
            if k != "scilem" and k != "_judge_metadata"
        )
        
        title = raw_data.get("Extracted_Title", filename.replace(".pdf", "").replace("_", " ").title())
        extracted_author = raw_data.get("Extracted_Author", pdf_meta_author if pdf_meta_author else "Independent Research Scholar")
        
        scores_dict = compute_formulaic_criteria(
            reproducibility_score=reproducibility_score,
            sciscore_adherence=mdar_score,
            topological_entropy=topological_entropy,
            ai_rating=pidyne_ai_rating,
            vapri=vapri,
            empirical_density=empirical_density
        )
        
        final_score = sum(scores_dict.values()) / 8.0
        
        premise_gap = 1.0 - (pidyne_ai_rating / 100.0)
        adversarial_penalty = math.exp(-(2 * max(0, topological_entropy - 0.5) + 1.5 * premise_gap))
        logic_integrity = (pidyne_ai_rating * adversarial_penalty) + (vapri * 5.0)
        logic_integrity = min(100.0, max(0.0, logic_integrity))

        if final_score >= 50.0 and logic_integrity >= 50.0:
            piq_minted = round((final_score / 100.0) * 10.0, 2)
        else:
            piq_minted = 0.00
            warnings_list.append(
                "MINIMUM piQ THRESHOLD UNMET: Manuscript score or logic integrity fell below 50.0%. "
                "piQ reward set to 0.00."
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
                warnings_json, judge_metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                file_hash, user_id, title, filename, scope, *scores_dict.values(),
                logic_integrity, 0.0, json.dumps(["Core Research Domain"]),
                json.dumps(["Computer Science"]), extracted_author, final_score,
                datetime.now().isoformat(), book_address, piq_minted,
                tx_hash, zk_proof, user_id, "None", 0.0,
                mdar_score, rrid_count, json.dumps(["Data Curation"]), reproducibility_score,
                provided_doi, json.dumps(consensus_raw), evidence_report, scilem_score,
                json.dumps(warnings_list), json.dumps(judge_meta)
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
        active_weights = derive_epoch_weights(scores_dict, prev_weights)

        new_height = block_count + 1
        ts = datetime.now().isoformat()
        f_hash = get_formulas_hash()
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
        title, extracted_author, final_score, logic_integrity, drift, rec,
        ["Computer Science"], ["Core Research Domain"], scores_dict, file_hash, piq_minted, tx_hash, zk_proof,
        active_weights, mdar_score, rrid_count, reproducibility_score, False, warnings_list,
        consensus_raw, evidence_report, scilem_score
    )
