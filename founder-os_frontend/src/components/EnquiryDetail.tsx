import { useState } from "react";
import type { ReactNode } from "react";
import ChatbaseCopilot from "./ChatbaseCopilot";
import { useIntake } from "../hooks/useIntake";
import ClientProfile from "./ClientProfile";
import SpecificationsSection from "./SpecificationsSection";
import { ConfirmDialog } from "./ui";
import { isOpenSpecFlag } from "@/enquiry/queue";
import { enquiryRateState } from "@/enquiry/rate-state";
import DetailHeader from "./enquiry-detail/DetailHeader";
import AddItemsModal from "./enquiry-detail/AddItemsModal";
import ItemThreads from "./enquiry-threads/ItemThreads";
import type { EnquiryDetailProps } from "./enquiry-detail/types";

const COPILOT_KEY = "enquiry-copilot-open";

function Banner({ tone, title, children, onDismiss }: { tone: "warning" | "danger"; title: string; children: ReactNode; onDismiss?: () => void }) {
  const c = tone === "danger" ? "var(--color-danger)" : "var(--color-warning)";
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${c} 30%, transparent)`, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>
      <span className="mt-0.5 text-sm" style={{ color: c }} aria-hidden>⚠</span>
      <div className="min-w-0 flex-1">
        <p className="text-label font-semibold" style={{ color: c }}>{title}</p>
        <div className="mt-1 space-y-1 text-caption leading-relaxed text-[var(--text-secondary)]">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="flex-shrink-0 cursor-pointer border-0 bg-transparent text-caption font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Dismiss</button>
      )}
    </div>
  );
}

// One enquiry, sales side: header (state + actions) · client / pipeline
// panel (left) · line items (right). Handlers and write paths unchanged —
// pieces live in enquiry-detail/ (DetailHeader, AddItemsModal).
export default function EnquiryDetail({
  selectedEnquiry, agents, currentAgent,
  onUpdateStatus, onUpdateAgent, onUpdateItems, onAddRequirement, onAcceptSuggestion,
  onReviseSent, onDeleteEnquiry, onOpenEdit, onBack, onOpenLightbox,
  redacted = false, ratesMode, saveError, onDismissSaveError,
}: EnquiryDetailProps) {
  const userInitial = String(currentAgent?.name || currentAgent?.id || "S").trim().charAt(0).toUpperCase() || "S";
  const [itemsOpen, setItemsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Revise: any team member may reopen a sent enquiry — new items still need
  // procurement + management before re-sent.
  const [confirmRevise, setConfirmRevise] = useState(false);
  const [reviseBusy, setReviseBusy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  // Sent is Zoho-driven: any non-draft Zoho status auto-means internal `sent`.
  const state = enquiryRateState(selectedEnquiry);
  const sentState = String(selectedEnquiry.rateStatus ?? "");
  // Copilot rail — closed by default for sales; opens on click, persisted per browser.
  const [copilotOpen, setCopilotOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(COPILOT_KEY) === "1"; } catch { return false; }
  });
  const toggleCopilot = (next: boolean) => {
    setCopilotOpen(next);
    try { localStorage.setItem(COPILOT_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };
  // Per-item AI intake (suggestions + missing slots, written by the runner).
  const intake = useIntake(selectedEnquiry.id, (selectedEnquiry as any).updatedAt);
  // Partial tag: management decided some (not all) loop items while still
  // open. Resolved flags rejoin the loop (audit trail only).
  const rateLoopItems = (selectedEnquiry.items ?? []).filter((it) => !isOpenSpecFlag(it) && !it.rateAvailable);
  const decidedRateItems = rateLoopItems.filter((it) => it.finalRate !== undefined && it.finalRate !== null).length;
  const showPartialTag = !state.sent && sentState !== "finalized" && decidedRateItems > 0;
  const canRevise = !redacted && !!onReviseSent && (sentState === "sent" || state.isZohoSent) && !state.revising;
  const ref = selectedEnquiry.estNumber || "This enquiry";

  return (
    <div className="space-y-5 animate-fade-in">
      <DetailHeader
        enquiry={selectedEnquiry}
        redacted={redacted}
        partial={showPartialTag ? { decided: decidedRateItems, total: rateLoopItems.length } : null}
        copilotOpen={copilotOpen}
        onBack={onBack}
        onAddItems={() => setItemsOpen(true)}
        onEdit={() => onOpenEdit(selectedEnquiry)}
        onRevise={canRevise ? () => { setReviseError(null); setConfirmRevise(true); } : undefined}
        onToggleCopilot={() => toggleCopilot(!copilotOpen)}
        onDelete={() => setConfirmDelete(true)}
      />

      {state.revising && !redacted && (
        <Banner tone="warning" title="Under revision — add items to re-quote">
          <p>Management reopened this sent enquiry. New items loop procurement → management → sent again.</p>
        </Banner>
      )}

      {state.zohoNameMismatch && (
        <Banner tone="warning" title="Client name mismatch — Zoho vs Enquiry">
          <p>
            Enquiry: <span className="font-semibold text-[var(--text-primary)]">&quot;{selectedEnquiry.clientCompany}&quot;</span>
            <span className="mx-1.5 text-[var(--text-tertiary)]">vs</span>
            Zoho: <span className="font-semibold text-[var(--text-primary)]">&quot;{state.zohoNameMismatch}&quot;</span>
          </p>
          <p className="text-[var(--text-tertiary)]">Loosely normalized (case/punctuation/Pvt Ltd stripped). Fix the Zoho customer or enquiry client name to clear.</p>
        </Banner>
      )}

      {/* Client panel LEFT (as before the redesign), items right. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="order-2 min-w-0 space-y-4">
          <SpecificationsSection
            selectedEnquiry={selectedEnquiry}
            onOpenLightbox={onOpenLightbox}
            redacted={redacted}
            ratesMode={ratesMode}
            onUpdateItems={onUpdateItems ? (itemsOrFn) => { void Promise.resolve(onUpdateItems(selectedEnquiry.id, itemsOrFn)).catch(() => { /* failure surfaces via the saveError banner */ }); } : undefined}
            intake={intake}
            onAcceptSuggestion={onAcceptSuggestion ? (idx) => void onAcceptSuggestion(selectedEnquiry.id, idx) : undefined}
          />

          {!redacted && <ItemThreads desk="sales" enquiryId={selectedEnquiry.id} items={selectedEnquiry.items ?? []} />}

          {saveError && (
            <Banner tone="danger" title="Save failed — the server did NOT keep your last change" onDismiss={onDismissSaveError}>
              <p className="break-words">{saveError}</p>
              <p className="text-[var(--text-tertiary)]">Nothing was lost on screen. Check connection, then retry the same action — do not re-add the item (that creates duplicates).</p>
            </Banner>
          )}

          {redacted && selectedEnquiry.redactedPending && (
            <p className="px-1 text-caption font-semibold text-[var(--color-warning)]">Securing the latest updates for this view…</p>
          )}
        </div>

        <aside className="order-1 min-w-0 lg:sticky lg:top-20">
          <ClientProfile
            selectedEnquiry={selectedEnquiry}
            agents={agents}
            redacted={redacted}
            onUpdateStatus={onUpdateStatus}
            onUpdateAgent={onUpdateAgent}
          />
        </aside>
      </div>

      {!redacted && (
        <ChatbaseCopilot
          enquiryId={selectedEnquiry.id}
          open={copilotOpen}
          onClose={() => toggleCopilot(false)}
          onOpen={() => toggleCopilot(true)}
          userInitial={userInitial}
        />
      )}

      <ConfirmDialog
        open={confirmRevise}
        danger={false}
        busy={reviseBusy}
        title="Reopen for revision?"
        confirmLabel="Reopen"
        message={<>
          <span className="font-mono font-semibold">{ref}</span>{selectedEnquiry.title ? ` — ${selectedEnquiry.title}` : ""} goes back to rates-ready so new items loop procurement → management → sent again. Nothing already decided is lost.
          {reviseError && <span className="mt-2 block font-semibold text-[var(--color-danger)]">{reviseError}</span>}
        </>}
        onCancel={() => setConfirmRevise(false)}
        onConfirm={() => {
          if (!onReviseSent) { setConfirmRevise(false); return; }
          setReviseBusy(true);
          void onReviseSent(selectedEnquiry.id)
            .then(() => setConfirmRevise(false))
            .catch((e: any) => setReviseError(e?.message || "Reopen failed"))
            .finally(() => setReviseBusy(false));
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete enquiry?"
        confirmLabel="Delete"
        message={<><span className="font-mono font-semibold">{ref}</span>{selectedEnquiry.title ? ` — ${selectedEnquiry.title}` : ""} and its comments will be permanently removed. This cannot be undone.</>}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); onDeleteEnquiry(selectedEnquiry.id); }}
      />

      {itemsOpen && (
        <AddItemsModal
          enquiry={selectedEnquiry}
          onUpdateItems={onUpdateItems}
          onAddRequirement={onAddRequirement}
          onClose={() => setItemsOpen(false)}
        />
      )}
    </div>
  );
}
