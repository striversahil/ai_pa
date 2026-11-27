"use client";

// EventDrawer — one activity in full: the normalized fields, the original
// payload that produced them, and Replay (re-runs the CURRENT mapping over the
// stored body — how a fixed mapping repairs an event without re-sending it).
import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge, Button, Drawer } from "@/components/ui";
import { fetchEvent, replayEvent, type EventDetail } from "@/integrations/api";
import { KIND_LABEL, fmtWhen, inr } from "@/integrations/format";

const ROW = "grid grid-cols-[110px_1fr] gap-2 border-b border-[var(--border-card)] py-1.5 text-[11px]";

export function EventDrawer({
  eventId,
  sourceName,
  onClose,
  onReplayed,
}: {
  eventId: string;
  sourceName: (id: string) => string;
  onClose: () => void;
  onReplayed: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    fetchEvent(eventId)
      .then((r) => alive && setEvent(r.event))
      .catch((e) => alive && setError(e?.message ?? "Could not load"));
    return () => {
      alive = false;
    };
  }, [eventId]);

  const replay = async () => {
    if (!event) return;
    setBusy(true);
    setNote("");
    try {
      const r = await replayEvent(event.sourceId, event.id);
      setEvent({ ...event, ...r.event, payloadObject: event.payloadObject, rawObject: event.rawObject });
      setNote("Replayed with the current mapping.");
      onReplayed();
    } catch (e: any) {
      setNote(e?.message ?? "Replay failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={event?.title || "Activity"}
      subtitle={event ? `${KIND_LABEL[event.kind] ?? event.kind} · ${sourceName(event.sourceId)} · ${fmtWhen(event.occurredAt)}` : "Loading…"}
      width="max-w-3xl"
      onClose={onClose}
      headerRight={
        event ? (
          <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} disabled={busy || !event.raw} onClick={replay}>
            {busy ? "Replaying…" : "Replay"}
          </Button>
        ) : null
      }
    >
      {error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}
      {!event ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : (
        <div className="space-y-4">
          {note ? <Badge tone="info">{note}</Badge> : null}

          <div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">Company</span>
              <span className="text-[var(--text-primary)]">{event.company || "—"}</span>
            </div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">Contact</span>
              <span className="text-[var(--text-primary)]">
                {event.contactName || "—"} {event.phone ? `· ${event.phone}` : ""} {event.email ? `· ${event.email}` : ""}
              </span>
            </div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">City</span>
              <span className="text-[var(--text-primary)]">{event.city || "—"}</span>
            </div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">Amount</span>
              <span className="text-[var(--text-primary)]">{inr(event.amount) || "—"}</span>
            </div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">External id</span>
              <span className="truncate text-[var(--text-primary)]">{event.externalId || "—"}</span>
            </div>
            <div className={ROW}>
              <span className="text-[var(--text-tertiary)]">Received</span>
              <span className="text-[var(--text-primary)]">{fmtWhen(event.createdAt)}</span>
            </div>
          </div>

          {event.summary ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Answers</p>
              <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-3 text-[11px] text-[var(--text-primary)]">
                {event.summary}
              </pre>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Original payload</p>
            <pre className="max-h-[40vh] overflow-auto rounded-lg bg-[var(--surface-sunken)] p-3 text-[10px] leading-relaxed text-[var(--text-secondary)]">
              {JSON.stringify(event.rawObject ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </Drawer>
  );
}
