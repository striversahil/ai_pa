"use client";

// EditorsPanel — the sales-head appoints individual editors here.
//
// Appointments are DIRECT per-user scopes (never a role), so granting edit
// rights can not leak another dashboard or the admin panel. Sales-head / MIS /
// root are implicit and cannot be revoked from this panel.
import { useEffect, useMemo, useState } from "react";
import type { EditorEntry } from "@/master-data/types";
import { listEditors, setEditor } from "@/master-data/api";
import { formatDate, initials } from "@/master-data/normalize";
import { Badge } from "@/components/ui";
import { Modal, inputClass } from "./ui";

export default function EditorsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [editors, setEditors] = useState<EditorEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    listEditors()
      .then((list) => { if (alive) setEditors(list); })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load the user list"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return editors;
    return editors.filter((e) => `${e.name} ${e.email}`.toLowerCase().includes(needle));
  }, [editors, q]);

  const appointed = editors.filter((e) => e.canEdit && !e.implicit).length;

  const toggle = async (entry: EditorEntry) => {
    setBusy(entry.userId);
    setError(null);
    try {
      const updated = await setEditor(entry.userId, !entry.canEdit);
      setEditors((list) => list.map((e) => (e.userId === updated.userId ? { ...e, ...updated } : e)));
    } catch (e: any) {
      setError(e?.message || "Could not change this appointment");
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customer Master editors"
      subtitle="Appoint individuals — not roles. Only these people can change customer records."
      wide
    >
      <div className="space-y-3">
        <div className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2 text-caption text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">{appointed}</strong> appointed editor{appointed === 1 ? "" : "s"}.
          Sales-head, MIS and root always hold edit rights and are not counted. Region / sub-area / state
          reassignment stays with them regardless of appointment.
        </div>

        <input
          className={inputClass}
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {error && (
          <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{error}</p>
        )}

        {loading ? (
          <p className="animate-pulse py-6 text-center text-label text-[var(--text-secondary)]">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-label text-[var(--text-secondary)]">No users match this search.</p>
        ) : (
          <div className="divide-y divide-[var(--border-card)] rounded-[var(--radius-control)] border border-[var(--border-card)]">
            {filtered.map((e) => (
              <div key={e.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-soft)] text-[10px] font-extrabold text-[var(--text-secondary)]">
                  {initials(e.name || e.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-semibold text-[var(--text-primary)]">
                    {e.name || e.email}
                    {e.isRoot && <span className="ml-1.5 text-[10px] font-normal text-[var(--text-tertiary)]">(root)</span>}
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-secondary)]">{e.email}</p>
                  {e.appointedBy && e.appointedAt && (
                    <p className="truncate text-[10px] text-[var(--text-tertiary)]">Appointed by {e.appointedBy} · {formatDate(e.appointedAt.slice(0, 10))}</p>
                  )}
                </div>
                {e.implicit ? (
                  <Badge tone="info" dot>Always on</Badge>
                ) : e.canEdit ? (
                  <Badge tone="success" dot>Editor</Badge>
                ) : (
                  <Badge tone="neutral">Viewer</Badge>
                )}
                <button
                  type="button"
                  disabled={e.implicit || busy === e.userId}
                  onClick={() => void toggle(e)}
                  title={e.implicit ? "Held through the sales-head / MIS role" : undefined}
                  className={`rounded-[var(--radius-control)] px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    e.canEdit
                      ? "border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--color-danger)]"
                      : "bg-[var(--color-brand-indigo)] text-white hover:opacity-90"
                  }`}
                >
                  {busy === e.userId ? "Saving…" : e.canEdit ? "Revoke" : "Appoint"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
