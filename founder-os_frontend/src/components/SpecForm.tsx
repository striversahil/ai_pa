"use client";

// SpecForm — stepped questionnaire for `spec_form` proposals (intake specs,
// sales ask_specs, and the generic ask_question cards on both copilots).
//
// One question at a time: MCQ (options = single-pick chips + free text),
// MSQ (multiselect = multi-pick chips + optional typed extra), or
// text/number/date inputs. Back/Skip/Next through the sequence, Submit posts
// the answers as a chat message the next turn files or reads.
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

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="font-bold text-[13px] text-[var(--text-primary)]">{title}</p>
        <p className="text-[11px] font-bold text-[var(--text-tertiary)]">Q {step + 1} of {questions.length}</p>
      </div>
      <div className="mt-2 h-1 rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-300"
          style={{ width: `${Math.round(((step + 1) / questions.length) * 100)}%` }}
        />
      </div>

      <p className="mt-3 text-[14px] font-semibold text-[var(--text-primary)] leading-snug">{q.label}</p>
      {q.hint ? <p className="mt-1 text-[12px] text-[var(--text-tertiary)] leading-snug">{q.hint}</p> : null}

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
                className={`px-3 py-1.5 text-[13px] font-semibold rounded-full border cursor-pointer transition-colors duration-200 disabled:cursor-default ${active
                  ? "bg-violet-600 text-white border-transparent"
                  : "bg-white/[0.04] text-[var(--text-secondary)] border-white/[0.09] hover:border-violet-500/40 hover:text-[var(--text-primary)]"}`}
              >
                {opt}
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
                className={`px-3 py-1.5 text-[13px] font-semibold rounded-full border cursor-pointer transition-colors duration-200 disabled:cursor-default ${active
                  ? "bg-violet-600 text-white border-transparent"
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
          placeholder="Or type an extra pick…"
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
          placeholder={q.type === "options" ? "Or type your own…" : "Type your answer…"}
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
        <span className="text-[11px] text-[var(--text-tertiary)] font-medium">{answered} answered</span>
        <button
          type="button"
          disabled={submitted}
          onClick={() => next()}
          className="px-5 py-2 text-[13px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200"
        >
          {step + 1 >= questions.length ? (submitted ? "✓ Sent" : "Submit ✓") : "Next →"}
        </button>
      </div>
    </div>
  );
}
