"use client";

// SpecForm — stepped questionnaire for the intake copilot's `spec_form` proposal.
//
// One question at a time (options as chips + free text, or text/number/date
// inputs), Back/Skip/Next through the sequence, Submit posts the answers as a
// chat message the intake files via update_draft.
// Backend mirror: founder-os_backend/src/automations/product-line/intake.ts (ask_specs).
import React, { useState } from "react";

export interface SpecQuestion {
  key: string;
  label: string;
  type: "options" | "text" | "number" | "date";
  options?: string[];
  hint?: string;
  required: boolean;
  section: "spec" | "commercial";
}

export default function SpecForm({ title, questions, onSubmit }: {
  title: string;
  questions: SpecQuestion[];
  onSubmit: (text: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const q = questions[step];
  if (!q) return null;

  const set = (v: string) => setAnswers((p) => ({ ...p, [q.key]: v }));
  const answered = questions.filter((x) => (answers[x.key] ?? "").trim()).length;

  const finish = () => {
    const lines = questions
      .map((x) => ({ x, v: (answers[x.key] ?? "").trim() }))
      .filter(({ v }) => v)
      .map(({ x, v }) => `- ${x.label}: ${v}`);
    if (!lines.length || submitted) return;
    setSubmitted(true);
    onSubmit(`My answers for ${title}:\n${lines.join("\n")}`);
  };

  const next = () => {
    if (step + 1 >= questions.length) finish();
    else setStep(step + 1);
  };

  return (
    <div className="rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] to-indigo-500/[0.08] backdrop-blur-sm px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="font-bold text-[13px] text-violet-200">{title}</p>
        <p className="text-[11px] font-bold text-[var(--text-tertiary)]">Q {step + 1} of {questions.length}</p>
      </div>
      <div className="mt-2 h-1 rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
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
                className={`px-3 py-1.5 text-[13px] font-semibold rounded-full border cursor-pointer transition-all duration-200 disabled:cursor-default ${active
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent shadow-[0_2px_10px_rgba(124,58,237,0.4)]"
                  : "bg-white/[0.04] text-[var(--text-secondary)] border-white/[0.09] hover:border-violet-500/40 hover:text-[var(--text-primary)]"}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {(q.type !== "options" || (answers[q.key] ?? "") === "" || !(q.options ?? []).includes(answers[q.key] ?? "")) && (
        <input
          type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
          value={answers[q.key] ?? ""}
          disabled={submitted}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
          placeholder={q.type === "options" ? "Or type your own…" : "Type your answer…"}
          className="mt-2.5 w-full bg-white/[0.04] border border-white/[0.09] rounded-xl px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-violet-500/50 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] transition-all"
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
            onClick={() => setStep(step - 1)}
            className="px-4 py-2 text-[13px] font-bold rounded-full bg-white/[0.05] text-[var(--text-secondary)] hover:bg-white/[0.09] hover:text-[var(--text-primary)] cursor-pointer border-0 transition-all"
          >
            ← Back
          </button>
        )}
        <button
          type="button"
          disabled={submitted}
          onClick={() => next()}
          className="px-4 py-2 text-[13px] font-bold rounded-full bg-white/[0.05] text-[var(--text-secondary)] hover:bg-white/[0.09] hover:text-[var(--text-primary)] cursor-pointer border-0 transition-all"
        >
          Skip →
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-[var(--text-tertiary)] font-medium">{answered} answered</span>
        <button
          type="button"
          disabled={submitted}
          onClick={() => next()}
          className="px-5 py-2 text-[13px] font-bold rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 hover:shadow-[0_4px_12px_rgba(124,58,237,0.4)] hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer border-0 transition-all duration-300"
        >
          {step + 1 >= questions.length ? (submitted ? "✓ Sent" : "Submit ✓") : "Next →"}
        </button>
      </div>
    </div>
  );
}
