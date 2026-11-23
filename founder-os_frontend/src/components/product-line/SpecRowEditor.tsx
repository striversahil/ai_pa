"use client";

// SpecRowEditor.tsx — the expanded panel of one spec row (label, type, choices,
// bounds, default). Split out of SpecsEditor.tsx (2026-11-23) to stay inside the
// 400-line budget; the parent owns the drag ordering and the save plumbing.
import React from "react";
import { field, label } from "../product-line-dashboard/helpers";
import type { GuideRow, SpecType } from "@/product-line/types";
import type { GuideWrite } from "@/product-line/api";

const TYPES: SpecType[] = ["string", "number", "integer", "boolean", "array"];

interface Props {
  guide: GuideRow;
  typed: SpecType;
  choices: string[];
  allChoices: string[];
  dflt: string;
  save: (body: GuideWrite) => void;
}

export function SpecRowEditor({ guide: g, typed, choices, allChoices, dflt, save }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-2 border-t border-[var(--border-card)]/60">
      <div className="col-span-2">
        <span className={label}>Question / label</span>
        <input
          className={field}
          defaultValue={g.question}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== g.question) save({ question: v });
          }}
        />
      </div>
      <div>
        <span className={label}>Type</span>
        <select className={field} value={typed} onChange={(e) => save({ type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <span className={label}>Required</span>
        <select
          className={field}
          value={g.isRequired ? "yes" : "no"}
          onChange={(e) => save({ isRequired: e.target.value === "yes" })}
        >
          <option value="no">optional</option>
          <option value="yes">required</option>
        </select>
      </div>
      {typed === "string" || typed === "array" ? (
        <div className="col-span-2">
          <span className={label}>Choices (comma separated — blank = free text)</span>
          <input
            className={field}
            defaultValue={allChoices.join(", ")}
            placeholder="GG, XXX, MF, N"
            onBlur={(e) => {
              const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              if (list.join("|") !== choices.join("|")) save({ enum: list });
            }}
          />
        </div>
      ) : null}
      {typed === "number" || typed === "integer" ? (
        <>
          <div>
            <span className={label}>Min</span>
            <input className={field} type="number" defaultValue={g.minNum ?? ""}
              onBlur={(e) => save({ min: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <span className={label}>Max</span>
            <input className={field} type="number" defaultValue={g.maxNum ?? ""}
              onBlur={(e) => save({ max: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </>
      ) : null}
      <div className="col-span-2">
        <span className={label}>Default (pre-filled on a new quote)</span>
        {allChoices.length ? (
          <select
            className={field}
            value={dflt}
            onChange={(e) => save({ default: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">— none —</option>
            {allChoices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : typed === "boolean" ? (
          <select
            className={field}
            value={dflt}
            onChange={(e) => save({ default: e.target.value === "" ? null : e.target.value === "true" })}
          >
            <option value="">— none —</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            className={field}
            defaultValue={dflt}
            placeholder={typed === "number" || typed === "integer" ? "e.g. 5" : "leave blank for none"}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === dflt) return;
              const num = typed === "number" || typed === "integer" ? Number(v) : v;
              save({ default: v === "" ? null : num });
            }}
          />
        )}
      </div>
    </div>
  );
}

export { TYPES };
