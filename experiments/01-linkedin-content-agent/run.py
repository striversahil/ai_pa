#!/usr/bin/env python3
"""End-to-end LinkedIn Content Agent runner on Agnes AI. See README.md."""
import argparse, datetime, json, os
from agnes_client import chat, RESEARCH_SYS, WRITING_SYS, EDITING_SYS, TEXT_MODEL, IMAGE_MODEL
HERE = os.path.dirname(os.path.abspath(__file__))
VISUAL_BRIEF_T = ("Visual brief for a BUI LinkedIn post about: {t}. Suggest ONE specific real factory visual a founder can shoot on a phone. Pick the best of: (a) 30-60s vertical video idea with shot list and first-3-seconds hook, (b) single real photo idea with subject, light, scale cue, and caption, (c) carousel outline of 6-10 slides with one idea per slide and max 30 words per slide. Rules: real photos/video only, never stock, never AI machines or customer sites without permission, workers with safety gear, brand colours TBD [FILL IN], logo small in corner for carousels. Also suggest posting slot (Tue/Thu/Sat 8-10 AM IST) and one engagement action. Topic context: {scene}")

VIS = {
 "yield": dict(scene="Pillar B yield troubleshooting at a customer-style mill (no customer shown without permission): worn roller close-up, sieve check, moisture meter, feed-rate view."),
 "power": dict(scene="Pillar A power-cost walkthrough: motor nameplates, meter readings, per-tonne math on a whiteboard in the factory."),
 "shopfloor": dict(scene="Pillar C shop-floor: fabrication to dispatch, welding sparks, assembly, pre-dispatch testing, loading."),
 "founder": dict(scene="Pillar E founder story: founder speaking to camera in the factory, machine running behind."),
 "default": dict(scene="BUI factory floor: real machine, good daylight, one clear subject with a person nearby for scale."),
}
def vkey(slug):
    s = slug.lower()
    if "yield" in s or "check" in s or "moisture" in s: return "yield"
    if "power" in s or "cost" in s or "payback" in s or "tph" in s: return "power"
    if "steel" in s or "dispatch" in s or "test" in s or "factory" in s: return "shopfloor"
    if "started" in s or "mistake" in s or "founder" in s: return "founder"
    return "default"
def run_topic(topic_file, skip_image=False):
    slug = topic_file.replace(".md", "")
    idea = open(os.path.join(HERE, "content", "ideas", topic_file)).read().strip()
    title = idea.splitlines()[0].lstrip("# ").strip()
    out = os.path.join(HERE, "output", slug)
    os.makedirs(out, exist_ok=True)
    log = {"topic": topic_file, "title": title, "text_model": TEXT_MODEL, "image_model": IMAGE_MODEL,
           "started": datetime.datetime.utcnow().isoformat() + "Z"}
    brief, u1 = chat([{"role": "system", "content": RESEARCH_SYS},
        {"role": "user", "content": "Topic: %s. Pillar per idea file (A-F, BUI_BRIEF.md Section 5). Note: %s. Produce the research_brief with verified facts or [NEED DATA], audience angles, real-visual idea, and risks." % (title, idea)}], max_tokens=900, temperature=0.5)
    log["research_usage"] = u1
    open(os.path.join(out, "research_brief.md"), "w").write(brief + "\n")
    draft, u2 = chat([{"role": "system", "content": WRITING_SYS},
        {"role": "user", "content": "Research brief:\n%s\n\nWrite the LinkedIn post_draft for: %s." % (brief, title)}], max_tokens=1000, temperature=0.7)
    log["writing_usage"] = u2
    open(os.path.join(out, "post_draft.md"), "w").write(draft + "\n")
    final, u3 = chat([{"role": "system", "content": EDITING_SYS},
        {"role": "user", "content": "Edit this draft:\n\n" + draft}], max_tokens=1000, temperature=0.3)
    log["editing_usage"] = u3
    open(os.path.join(out, "post_final.md"), "w").write(final + "\n")
    v = VIS[vkey(slug)]
    vbrief_prompt = VISUAL_BRIEF_T.format(t=title, scene=v["scene"])
    vbrief, u4 = chat([{"role": "system", "content": "You are the visual director for BUI founder LinkedIn posts. Real factory photos/video only, never stock, never AI machines. Output a concrete shootable brief."},
        {"role": "user", "content": vbrief_prompt}], max_tokens=600, temperature=0.5)
    log["visual_usage"] = u4
    open(os.path.join(out, "visual_brief.txt"), "w").write(vbrief + "\n")
    # BUI uses real-photo visual briefs only (brief Section 10); no AI image prompts generated.
    log["finished"] = datetime.datetime.utcnow().isoformat() + "Z"
    json.dump(log, open(os.path.join(out, "run_log.json"), "w"), indent=2)
    print("[OK] %s: final=%dw visual_brief=real-photo -> %s" % (slug, len(final.split()), out))
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="003-five-reasons-yield-dropping.md")
    ap.add_argument("--all-new", action="store_true")
    ap.add_argument("--skip-image", action="store_true", help="(deprecated: BUI uses real-photo visual briefs, no AI image generation)")
    a = ap.parse_args()
    topics = (["001-what-it-costs-to-setup-x-tph-mill.md", "002-power-cost-per-tonne.md", "003-five-reasons-yield-dropping.md", "004-daily-10-minute-machine-check.md", "005-from-steel-plate-to-machine.md", "006-what-we-test-before-dispatch.md", "007-why-i-started-bui.md", "008-biggest-mistake-first-year.md", "009-subsidy-loan-basics.md", "010-small-mill-vs-large-mill.md"] if a.all_new else [a.topic])
    for t in topics:
        run_topic(t, skip_image=a.skip_image)
