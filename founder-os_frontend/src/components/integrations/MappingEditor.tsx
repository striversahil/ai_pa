"use client";

// MappingEditor — the flexibility valve. A service's mapping is DATA (JSON:
// where each field lives in the payload), so a new portal shape never needs a
// deploy. Paste a real payload, preview, save; then Replay repairs old events.
import React, { useState } from "react";
import { Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { Badge, Button, ErrorState } from "@/components/ui";
import { previewMapping } from "@/integrations/api";
import type { MappingSpec } from "@/integrations/types";

const FIELD =
  "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]";
const LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]";

export function MappingEditor({
  sourceId,
  connectorKey,
  initial,
  sample,
  onSave,
  onSaved,
}: {
  sourceId: string;
  connectorKey: string;
  initial: MappingSpec;
  sample: string;
  onSave: (spec: MappingSpec | null) => Promise<void>;
  onSaved: () => void;
}) {
  const [text, setText] = useState(JSON.stringify(initial ?? { fields: {} }, null, 2));
  const [payload, setPayload] = useState(sample || "");
  const [preview, setPreview] = useState<{ events: any[]; warnings: string[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const spec = (): MappingSpec => {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Mapping must be a JSON object");
    return parsed as MappingSpec;
  };

  const runPreview = async () => {
    setError("");
    setNote("");
    try {
      const body = spec();
      if (!payload.trim()) throw new Error("Paste a sample payload first");
      setBusy("preview");
      const r = await previewMapping({ payload, mapping: body, connectorKey });
      setPreview({ events: r.events, warnings: r.warnings });
    } catch (e: any) {
      setError(e?.message ?? "Could not preview");
    } finally {
      setBusy(null);
    }
  };

  const save = async (value: MappingSpec | null) => {
    setError("");
    setNote("");
    try {
      if (value) spec();
      setBusy("save");
      await onSave(value);
      setNote(value ? "Mapping saved. Replay an event to repair it." : "Back to the service default.");
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className={LABEL}>Field mapping</p>
        <Badge tone="neutral">source {sourceId.slice(0, 8)}</Badge>
      </div>
      {error ? <ErrorState title="Mapping problem" message={error} /> : null}
      {note ? <p className="text-[10px] text-[var(--color-success)]">{note}</p> : null}

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} className={`${FIELD} font-mono text-[10px]`} />

      <div>
        <p className={LABEL}>Sample payload</p>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="Paste one real submission body from Deliveries below"
          className={`${FIELD} font-mono text-[10px]`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={busy === "preview" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} onClick={runPreview} disabled={!!busy}>
          Preview
        </Button>
        <Button size="sm" variant="primary" icon={busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} onClick={() => save(spec())} disabled={!!busy}>
          Save mapping
        </Button>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => save(null)} disabled={!!busy}>
          Use service default
        </Button>
      </div>

      {preview ? (
        <div className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-2">
          <p className="text-[10px] font-bold text-[var(--text-primary)]">
            {preview.events.length} event{preview.events.length === 1 ? "" : "s"} from that payload
          </p>
          <pre className="mt-1 max-h-40 overflow-auto text-[10px] leading-relaxed text-[var(--text-secondary)]">
            {JSON.stringify(preview.events.slice(0, 3), null, 2)}
          </pre>
          {preview.warnings.map((w, i) => (
            <p key={i} className="mt-1 text-[10px] text-[var(--color-warning)]">{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
