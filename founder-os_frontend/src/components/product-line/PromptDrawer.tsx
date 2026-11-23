"use client";

// PromptDrawer.tsx — the "Copy prompt" panel next to the KYP JSON button.
//
// The prompt turns a chat agent into a rate importer: download the KYP JSON,
// attach it with any vendor sheet, paste this prompt (which already lists the
// active vendors and their city), and the answer goes back into
// "Paste AI rates". The prompt is editable here and saved server-side, so an
// improvement is shared with the whole team and survives reloads.
import React, { useEffect, useState } from "react";
import { ClipboardCheck, Copy, FileJson, RotateCcw, Save } from "lucide-react";
import { Drawer } from "@/components/ui";
import { field, ghostBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import { usePrompt } from "@/product-line/hooks";

const errMsg = (e: unknown) => String((e as any)?.message ?? "request failed");

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older/blocked clipboard: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface Props {
  canEdit: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function PromptDrawer({ canEdit, onClose, onExport, onImport }: Props) {
  const { data, loading, refresh } = usePrompt();
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (data) setTemplate(data.template);
  }, [data]);

  const dirty = !!data && template !== data.template;

  /** Copy the SAVED prompt with the vendor block filled in. */
  const copy = async () => {
    setErr(null);
    setNote(null);
    if (dirty) {
      setErr("save your edit first — copying uses the saved prompt");
      return;
    }
    const ok = await copyText(data?.rendered ?? "");
    if (ok) setNote("Prompt copied — paste it into the chat with the KYP JSON attached");
    else setErr("clipboard blocked by the browser");
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await productLineApi.savePrompt(template);
      await refresh();
      setNote("Prompt saved for everyone");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await productLineApi.resetPrompt();
      await refresh();
      setNote("Back to the shipped prompt");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Rate-intake prompt"
      subtitle={
        data
          ? `${data.vendorCount} active vendor${data.vendorCount === 1 ? "" : "s"} injected${data.isDefault ? " · shipped prompt" : " · customised"}`
          : "loading…"
      }
      onClose={onClose}
      width="max-w-4xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primaryBtn} disabled={loading || busy} onClick={() => void copy()}>
            <Copy size={13} /> Copy prompt
          </button>
          <button type="button" className={ghostBtn} onClick={onExport}>
            <FileJson size={13} /> Download KYP JSON
          </button>
          <button type="button" className={ghostBtn} onClick={onImport}>
            <ClipboardCheck size={13} /> Paste AI rates
          </button>
          <span className="ml-auto flex items-center gap-2">
            {canEdit ? (
              <>
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => void reset()}>
                  <RotateCcw size={13} /> Reset
                </button>
                <button type="button" className={primaryBtn} disabled={busy || !dirty} onClick={() => void save()}>
                  <Save size={13} /> {dirty ? "Save prompt" : "Saved"}
                </button>
              </>
            ) : null}
          </span>
        </div>

        {err ? <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div> : null}
        {note ? <div className="text-xs font-semibold text-emerald-600 bg-[var(--bg-input)] rounded-xl px-3 py-2">{note}</div> : null}

        <div>
          <span className={label}>
            Prompt template — <span className="font-mono">{"{{ACTIVE_VENDORS}}"}</span> is replaced by the live vendor list (name — city)
          </span>
          <textarea
            className={`${field} min-h-[420px] font-mono text-[11px] leading-5`}
            value={template}
            spellCheck={false}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={loading || !canEdit}
          />
        </div>

        <div className="rounded-xl bg-[var(--bg-input)] px-3 py-2 text-[10.5px] leading-5 text-[var(--text-tertiary)]">
          <b className="text-[var(--text-secondary)]">How it flows:</b> copy this prompt → attach the KYP JSON and the
          vendor sheet in any chat model → it answers with a <span className="font-mono">{"{ rates: [ … ] }"}</span> block
          → paste that block into <b className="text-[var(--text-secondary)]">Paste AI rates</b> → every row is
          typechecked against this catalogue before it lands.
        </div>
      </div>
    </Drawer>
  );
}
