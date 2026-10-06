"use client";

// ProductCopilot — product-line department copilots (thin configs over CopilotChat).
//
// One pill, same AI interface as sales. Once the popup is open, mode tabs
// switch between:
//   · Knowledge — read-only Q&A over catalogue/vendors/quotes.
//   · Add Rates — intake: paste an unstructured vendor quote, the AI resolves
//     product + vendor, pulls only that product's required checklist, drafts
//     the rate (flagging gaps), and Confirm creates vendor/product/rate.
// Backend mirror: founder-os_backend/src/automations/product-line/copilot.ts
// (knowledge) + intake.ts (rates) + bulk-import/chat.ts (bulk).
import React, { useState } from "react";
import CopilotChat, { type CopilotConfig } from "./CopilotChat";
import BulkChatContext from "./BulkChatContext";
import { useAuth } from "@/auth/AuthContext";

const KNOWLEDGE: CopilotConfig = {
  title: "AI Agent",
  subtitle: "Product knowledge",
  emptyText: "How can I help with the catalogue?",
  suggestions: [
    "Compare vendor quotes for a product",
    "Which vendors supply granite?",
    "What specs do we capture for tiles?",
  ],
  toolIcons: {
    search_products: "🔍",
    get_product_detail: "📦",
    compare_quotes: "⚖️",
    vendor_lookup: "🏭",
    web_search: "🌐",
    fetch_page: "📄",
    calculate: "🧮",
  },
  streamUrl: "/api/copilot/product-line/chat/stream",
  chatUrl: "/api/copilot/product-line/chat",
  clearUrl: "/api/copilot/product-line/chat/clear",
  resetKey: "product-line",
};

const INTAKE: CopilotConfig = {
  title: "AI Agent",
  subtitle: "Add vendor rates",
  emptyText: "Paste the vendor's quote message and I'll draft the rate.",
  suggestions: [
    "Paste a vendor quote to add a rate",
    "Start over",
  ],
  toolIcons: {
    get_draft: "📝",
    update_draft: "✍️",
    find_product: "🔍",
    required_specs: "📋",
    ask_specs: "🗒️",
    find_vendor: "🏭",
    propose_vendor: "🏪",
    propose_product: "📦",
    propose_rate: "💰",
    clear_draft: "🗑️",
    web_search: "🌐",
    fetch_page: "📄",
    calculate: "🧮",
  },
  streamUrl: "/api/copilot/product-line-intake/chat/stream",
  chatUrl: "/api/copilot/product-line-intake/chat",
  executeUrl: "/api/copilot/product-line-intake/chat/execute",
  clearUrl: "/api/copilot/product-line-intake/chat/clear",
  resetKey: "product-line-intake",
};

const MODES = [
  { id: "knowledge", label: "Knowledge" },
  { id: "intake", label: "Add Rates" },
  { id: "bulk", label: "Bulk" },
];

export default function ProductCopilot() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("knowledge");
  const [bulkBatchId, setBulkBatchId] = useState("");
  // Dashboard "Open in AI chat" bridge: jump straight into the Bulk tab.
  React.useEffect(() => {
    const onBridge = (e: Event) => {
      const id = String((e as CustomEvent).detail?.batchId ?? "");
      if (!id) return;
      setBulkBatchId(id);
      setMode("bulk");
      setOpen(true);
    };
    window.addEventListener("open-bulk-chat", onBridge);
    return () => window.removeEventListener("open-bulk-chat", onBridge);
  }, []);
  const { me } = useAuth();
  const initial = String((me as any)?.user?.email ?? (me as any)?.email ?? "S").trim().charAt(0).toUpperCase() || "S";
  const BULK: CopilotConfig = {
    title: "AI Agent",
    subtitle: "Bulk price lists",
    emptyText: "Pick a batch above, then command it — “set all units to mtr”, “is this ready to commit?”",
    suggestions: [
      "Summarize this batch",
      "Is this batch ready to commit?",
      "Set all missing units to mtr",
    ],
    toolIcons: {
      bulk_status: "📊",
      bulk_change: "✍️",
      bulk_link: "🔗",
      bulk_verify: "✅",
      bulk_propose_block: "📦",
      web_search: "🌐",
      fetch_page: "📄",
      calculate: "🧮",
    },
    streamUrl: "/api/copilot/product-line-bulk/chat/stream",
    chatUrl: "/api/copilot/product-line-bulk/chat",
    executeUrl: "/api/copilot/product-line-bulk/chat/execute",
    clearUrl: "/api/copilot/product-line-bulk/chat/clear",
    resetKey: `product-line-bulk:${bulkBatchId}`,
    context: bulkBatchId ? { batchId: bulkBatchId } : {},
  };
  const config = mode === "intake" ? INTAKE : mode === "bulk" ? BULK : KNOWLEDGE;
  return (
    <CopilotChat
      config={{ ...config, userInitial: initial }}
      open={open}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      modes={MODES}
      mode={mode}
      onModeChange={setMode}
      headerExtra={mode === "bulk" ? <BulkChatContext openBatchId={bulkBatchId} onOpenBatch={setBulkBatchId} /> : undefined}
    />
  );
}
