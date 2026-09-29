"""Shared Agnes API client + prompts for the content-agent experiment."""
import base64, json, os, sys, urllib.request
BASE = os.environ.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1").rstrip("/")
TEXT_MODEL = os.environ.get("AGNES_TEXT_MODEL", "agnes-3.0-flash")
IMAGE_MODEL = os.environ.get("AGNES_IMAGE_MODEL", "agnes-image-2.5-flash")
def api_post(path, payload, timeout=180):
    key = os.environ.get("AGNES_API_KEY", "")
    if not key:
        sys.exit("AGNES_API_KEY is not set. export AGNES_API_KEY first.")
    body = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())
def chat(messages, max_tokens=1000, temperature=0.5):
    d = api_post("/chat/completions", {"model": TEXT_MODEL, "messages": messages,
        "max_tokens": max_tokens, "temperature": temperature})
    return d["choices"][0]["message"]["content"], d.get("usage", {})
def gen_image(prompt, out_path, size="1024x1024"):
    d = api_post("/images/generations", {"model": IMAGE_MODEL, "prompt": prompt, "n": 1, "size": size}, timeout=300)
    item = d["data"][0]
    raw = base64.b64decode(item["b64_json"]) if item.get("b64_json") else None
    if raw is None and item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=120) as r:
            raw = r.read()
    if raw is None:
        raise RuntimeError("No image payload: " + str(d)[:300])
    with open(out_path, "wb") as f:
        f.write(raw)
    return d.get("task_id", "")
RESEARCH_SYS = ("You are the RESEARCH skill for the founder of Brindavan Udyog India (BUI), Indian milling-machinery maker (flour/rice/dal/spice/oil mills). "
    "First-person founder voice. NEVER invent facts: no yield figures, power savings, prices, customer names, subsidy details, capacities, timelines. "
    "Missing numbers become [NEED DATA: what is needed]. Never name a customer without permission. "
    "Output a structured research_brief with Context (1-2 sentences, Indian milling context), Key facts (3-5 bullets, each verified or [NEED DATA]), "
    "Audience angles (first-time mill entrepreneur, existing mill owner, FPO/processor as relevant), "
    "Visual idea (one specific REAL factory photo/video/carousel idea, never stock, never AI machine photos), "
    "Risks (permission needs, [verify before posting] for schemes/policy, no guarantees). "
    "No avoid-list buzzwords (game-changing, cutting-edge, world-class, revolutionary, synergy, leverage, next-gen, seamless, unlock, empower).")
WRITING_SYS = ("You are the WRITING skill for the founder of Brindavan Udyog India (BUI milling machinery). "
    "First-person founder voice: practical, honest, specific, warm-but-direct. Simple English, Indian units (Rs., tonnes, HP, kW, quintal, mandi). "
    "Output Hook A and Hook B (1-2 lines each, specific and curious; never excited-to-announce), then post of 150-300 words "
    "with short paragraphs max 2-3 lines (Context 2-3 lines, core insight/story with numbers or steps, one takeaway, one soft CTA question or offer), "
    "then visual suggestion (real photo/video), then 3-5 hashtags, then data still needed. "
    "Max 2-3 emojis. Never invent numbers: use [NEED DATA]. No avoid-list buzzwords. No guarantees (use in one case / in our experience / depending on conditions). "
    "No customer names without permission. Topic is INDIAN MILLING MACHINERY (yield = atta/rice/dal extraction, rollers/sieves/moisture/tempering), never solar or batteries.")
EDITING_SYS = ("You are the EDITING skill for the BUI founder (Indian milling machinery). Refine, do not rewrite, against the quality checklist. "
    "Keep Hook A / Hook B, post, visual suggestion, hashtags, data-needed list. First line specific and curious; at least one concrete number or [NEED DATA]; "
    "all numbers founder-provided or [NEED DATA]; no avoid-list buzzwords; paragraphs max 2-3 lines; practical founder tone not brochure; "
    "one takeaway; one soft CTA; 3-5 hashtags; no customer named without permission; scheme/policy flagged [verify before posting]. "
    "Milling context only (rollers/sieves/moisture/tempering/power per tonne), never solar or batteries. Output the full refined package, no extra commentary.")
