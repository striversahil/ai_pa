"use client";

// Extracted verbatim from NeoDoveCampaignSection.tsx by scripts/refactor/split-module.mjs.
// NeoDoveCampaignSection.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";

/**
 * Per-agent campaign URL row. Paste a bare URL or a full curl command — the
 * server extracts and validates it (https NeoDove custom-integration only).
 * The URL itself is never displayed back: only configured/not + which value
 * wins (Controller-mapped vs Worker secret).
 */
export function AgentUrlRow({
  agentKey, name, configured, source, onSaved, onError,
}: {
  agentKey: string;
  name: string;
  configured: boolean;
  source: string;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (raw: string) => {
    setSaving(true);
    onError(null);
    try {
      const res = await fetch(
        `/api/neodove/campaign/agents/${encodeURIComponent(agentKey)}/url`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      setValue('');
      setOpen(false);
      onSaved();
    } catch (e: any) {
      onError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold truncate">{name}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide shrink-0 ${
            configured
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            {configured ? `mapped · ${source === 'db' ? 'controller' : 'secret'}` : 'no URL'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {configured && source === 'db' && (
            <button
              type="button"
              onClick={() => void save('')}
              disabled={saving}
              title="Clear the Controller mapping (Worker secret takes over)"
              className="text-[11px] font-semibold text-zinc-500 hover:text-rose-500 disabled:opacity-50"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {open ? 'Cancel' : configured ? 'Replace' : 'Map URL'}
          </button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the campaign URL or the full curl command here"
            rows={3}
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-[11px] font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save(value)}
              disabled={saving || !value.trim()}
              className="px-3 py-1 text-[11px] rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save URL'}
            </button>
            <span className="text-[10px] text-zinc-500">https NeoDove integration URL only — anything else is rejected.</span>
          </div>
        </div>
      )}
    </div>
  );
}
