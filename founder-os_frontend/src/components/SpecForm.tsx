"use client";

// SpecForm — stepped questionnaire for `spec_form` proposals (intake specs,
// sales ask_specs, and the generic ask_question cards on both copilots).
//
// Quest-card presentation: a mascot with moods (idle / happy / party),
// drifting clouds, tappable progress dots and praise lines — one question at
// a time so it feels like a mini-game, not a form. Logic unchanged: MCQ
// (options = single-pick chips + free text), MSQ (multiselect = multi-pick
// chips + optional typed extra), or text/number/date inputs. Back/Skip/Next
// through the sequence, Submit posts the answers as a chat message the next
// turn files or reads.
// Backend mirrors: founder-os_backend/src/modules/enquiries/chat.ts
// (ask_specs/ask_question) + automations/product-line/copilot.ts.
import React, { useState } from "react";

export interface SpecQuestion {
  key: string;
  label: string;
  type: "options" | "multiselect" | "text" | "number" | "date";
  options?: string[];
  hint?: string;
  required: boolean;
  section: "spec" | "commercial";
}

const splitList = (v: string): string[] =>
  v.split(",").map((s) => s.trim()).filter(Boolean);

/** Quest mascot: flat violet bot. idle = blink, happy = grin, party = hat. */
function Mascot({ mood }: { mood: "idle" | "happy" | "party" }) {
  return (
    <svg viewBox="0 0 48 52" className="h-12 w-12 animate-mascot-bob flex-shrink-0" aria-hidden="true">
      {mood === "party" && (
        <g>
          <polygon points="24,0 15,12 33,12" fill="#f472b6" />
          <circle cx="24" cy="2.5" r="2.4" fill="#fbbf24" className="animate-twinkle" />
          <circle cx="6" cy="6" r="1.6" fill="#fbbf24" className="animate-twinkle" />
          <circle cx="42" cy="9" r="1.6" fill="#22d3ee" className="animate-twinkle" style={{ animationDelay: "0.8s" }} />
        </g>
      )}
      {/* antenna */}
      <line x1="24" y1="15" x2="24" y2="10" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="8.5" r="2.2" fill={mood === "idle" ? "#a78bfa" : "#4ade80"} className="animate-twinkle" />
      {/* ears */}
      <rect x="4" y="22" width="5" height="10" rx="2.5" fill="#6d28d9" />
      <rect x="39" y="22" width="5" height="10" rx="2.5" fill="#6d28d9" />
      {/* head */}
      <rect x="8" y="14" width="32" height="29" rx="10" fill="#7c3aed" />
      {/* visor */}
      <rect x="13" y="19" width="22" height="19" rx="7" fill="#1e1b4b" />
      {/* eyes */}
      <g className={mood === "idle" ? "animate-eye-blink" : undefined}>
        <circle cx="20" cy="26.5" r="3" fill="#fff" />
        <circle cx="28" cy="26.5" r="3" fill="#fff" />
        <circle cx="20.8" cy="27.2" r="1.4" fill="#1e1b4b" />
        <circle cx="28.8" cy="27.2" r="1.4" fill="#1e1b4b" />
      </g>
      {/* mouth: flat when idle, grin when happy/party */}
      {mood === "idle" ? (
        <line x1="20" y1="33.5" x2="28" y2="33.5" stroke="#c4b5fd" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M19 32.5 Q24 37.5 29 32.5" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      )}
      {/* cheeks */}
      <circle cx="15.5" cy="31" r="2" fill="#f472b6" opacity="0.55" />
      <circle cx="32.5" cy="31" r="2" fill="#f472b6" opacity="0.55" />
    </svg>
  );
}

/** Flat drifting cloud: overlapping white blobs, no gradients. */
function Cloud({ className, slow }: { className?: string; slow?: boolean }) {
  return (
    <div className={`absolute pointer-events-none ${slow ? "animate-cloud-drift-slow" : "animate-cloud-drift"} ${className ?? ""}`} aria-hidden="true">
      <div className="relative h-6 w-20 rounded-full bg-white/[0.09]">
        <div className="absolute -top-2.5 left-3 h-6 w-6 rounded-full bg-white/[0.09]" />
        <div className="absolute -top-1.5 left-9 h-5 w-5 rounded-full bg-white/[0.09]" />
      </div>
    </div>
  );
}

export default function SpecForm({ title, questions, onSubmit }: {
  title: string;
  questions: SpecQuestion[];
  onSubmit: (text: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const q = questions[step];
  if (!q) return null;
  const isMulti = q.type === "multiselect";

  const set = (v: string) => setAnswers((p) => ({ ...p, [q.key]: v }));
  const picked = isMulti ? splitList(answers[q.key] ?? "") : [];
  const toggleMulti = (opt: string) => {
    const has = picked.includes(opt);
    const next = has ? picked.filter((x) => x !== opt) : [...picked, opt];
    set(next.join(", "));
  };
  const go = (s: number) => { setStep(s); setDraft(""); };
  // Fold a typed extra into the MSQ picks before leaving the step.
  const commitDraft = (): Record<string, string> => {
    if (!isMulti) return answers;
    const d = draft.trim();
    if (!d || picked.includes(d)) return answers;
    const merged = { ...answers, [q.key]: [...picked, d].join(", ") };
    setAnswers(merged);
    return merged;
  };
  const valueOf = (qq: SpecQuestion, a: Record<string, string>): string =>
    qq.type === "multiselect" ? splitList(a[qq.key] ?? "").join(", ") : (a[qq.key] ?? "").trim();
  const answered = questions.filter((x) => valueOf(x, answers)).length;
  const currentAnswered = !!valueOf(q, answers) || !!draft.trim();

  const finish = (finalAnswers: Record<string, string>) => {
    const lines = questions
      .map((x) => ({ x, v: valueOf(x, finalAnswers) }))
      .filter(({ v }) => v)
      .map(({ x, v }) => `- ${x.label}: ${v}`);
    if (!lines.length || submitted) return;
    setSubmitted(true);
    onSubmit(`My answers for ${title}:\n${lines.join("\n")}`);
  };

  const next = () => {
    const a = commitDraft();
    setDraft("");
    if (step + 1 >= questions.length) finish(a);
    else setStep(step + 1);
  };

  const mood = submitted ? "party" : currentAnswered ? "happy" : "idle";
  const pct = Math.round((answered / questions.length) * 100);

  const chipBase = "px-3 py-1.5 text-[13px] font-semibold rounded-full border cursor-pointer disabled:cursor-default";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-500/25 bg-white/[0.03] px-4 py-3.5">
      {/* sky band with drifting clouds + twinkling stars */}
      <div className="absolute inset-x-0 top-0 h-24 bg-violet-500/[0.07] pointer-events-none" aria-hidden="true" />
      <Cloud className="top-2 left-6 opacity-80" />
      <Cloud className="top-6 right-8 opacity-60" slow />
      <span className="absolute top-3 right-16 text-[10px] text-amber-200/70 animate-twinkle pointer-events-none" aria-hidden="true">✦</span>
      <span className="absolute top-8 left-1/2 text-[9px] text-cyan-200/60 animate-twinkle pointer-events-none" style={{ animationDelay: "1.1s" }} aria-hidden="true">✦</span>

      {/* mascot + title + speech */}
      <div className="relative flex items-center gap-3">
        <Mascot mood={mood} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-bold text-[13px] text-[var(--text-primary)] truncate">🗺️ {title}</p>
            <p className="text-[11px] font-bold text-[var(--text-tertiary)] flex-shrink-0">Q {step + 1} of {questions.length}</p>
          </div>
        </div>
      </div>

      {/* tappable journey dots + thin trail */}
      <div className="relative mt-3 flex items-center gap-1.5">
        {questions.map((x, i) => {
          const doneQ = !!valueOf(x, answers);
          const current = i === step;
          return (
            <button
              key={x.key}
              type="button"
              disabled={submitted}
              onClick={() => go(i)}
              title={x.label}
              aria-label={`Go to question ${i + 1}: ${x.label}`}
              className={`h-2.5 rounded-full cursor-pointer border-0 transition-colors duration-200 disabled:cursor-default ${doneQ
                ? "bg-emerald-400 w-6"
                : current
                  ? "bg-violet-400 w-6 animate-twinkle"
                  : "bg-white/[0.12] w-2.5 hover:bg-white/[0.25]"}`}
            />
          );
        })}
        <span className="ml-auto text-[11px] font-bold text-[var(--text-tertiary)] flex-shrink-0">⭐ {answered}/{questions.length} · {pct}%</span>
      </div>

      <p className="mt-3 text-[14px] font-semibold text-[var(--text-primary)] leading-snug">{q.label}</p>
      {q.hint ? <p className="mt-1 text-[12px] text-[var(--text-tertiary)] leading-snug">💡 {q.hint}</p> : null}

      {q.type === "options" ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(q.options ?? []).map((opt) => {
            const active = (answers[q.key] ?? "") === opt;
            return (
              <button
                key={opt}
                type="button"
                disabled={submitted}
                onClick={() => set(active ? "" : opt)}
                className={`${chipBase} transition-colors duration-200 ${active
                  ? "bg-violet-600 text-white border-transparent animate-chip-pop"
                  : "bg-white/[0.04] text-[var(--text-secondary)] border-white/[0.09] hover:border-violet-500/40 hover:text-[var(--text-primary)]"}`}
              >
                {active ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {q.type === "multiselect" ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(q.options ?? []).map((opt) => {
            const active = picked.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                disabled={submitted}
                onClick={() => toggleMulti(opt)}
                className={`${chipBase} transition-colors duration-200 ${active
                  ? "bg-violet-600 text-white border-transparent animate-chip-pop"
                  : "bg-white/[0.04] text-[var(--text-secondary)] border-white/[0.09] hover:border-violet-500/40 hover:text-[var(--text-primary)]"}`}
              >
                {active ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {q.type === "multiselect" ? (
        <input
          value={draft}
          disabled={submitted}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
          placeholder="Or invent your own pick… ✍️"
          className="mt-2.5 w-full bg-white/[0.04] border border-white/[0.09] rounded-xl px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-violet-500/50 transition-colors"
        />
      ) : null}

      {(q.type !== "options" || (answers[q.key] ?? "") === "" || !(q.options ?? []).includes(answers[q.key] ?? "")) && q.type !== "multiselect" && (
        <input
          type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
          value={answers[q.key] ?? ""}
          disabled={submitted}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
          placeholder={q.type === "options" ? "Or write your own…" : q.type === "number" ? "Type the number… 🔢" : "Type your answer… ✍️"}
          className="mt-2.5 w-full bg-white/[0.04] border border-white/[0.09] rounded-xl px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-violet-500/50 transition-colors"
        />
      )}
      {q.type === "options" && (q.options ?? []).includes(answers[q.key] ?? "") && (
        <button
          type="button"
          disabled={submitted}
          onClick={() => set("")}
          className="mt-2 text-[12px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent p-0 transition-colors"
        >
          ✎ Type a different answer instead
        </button>
      )}

      {submitted && (
        <p className="mt-3 text-[13px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2 animate-fade-in">
          🎉 Quest complete! Your answers are on their way…
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        {step > 0 && (
        <button
          type="button"
          disabled={submitted}
          onClick={() => go(step - 1)}
          className="px-4 py-2 text-[13px] font-bold rounded-full bg-white/[0.05] text-[var(--text-secondary)] hover:bg-white/[0.09] hover:text-[var(--text-primary)] cursor-pointer border-0 transition-colors duration-200"
        >
          ← Back
        </button>
        )}
        <button
          type="button"
          disabled={submitted}
          onClick={() => next()}
          className="px-4 py-2 text-[13px] font-bold rounded-full bg-white/[0.05] text-[var(--text-secondary)] hover:bg-white/[0.09] hover:text-[var(--text-primary)] cursor-pointer border-0 transition-colors duration-200"
        >
          Skip →
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={submitted}
          onClick={() => next()}
          className="px-5 py-2 text-[13px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200"
        >
          {step + 1 >= questions.length ? (submitted ? "✓ Sent" : "Finish 🎁") : "Next →"}
        </button>
      </div>
    </div>
  );
}
