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
// (knowledge) + intake.ts (rates).
import React, { useState } from "react";
import CopilotChat, { type CopilotConfig } from "./CopilotChat";
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
    find_vendor: "🏭",
    propose_vendor: "🏪",
    propose_product: "📦",
    propose_rate: "💰",
    clear_draft: "🗑️",
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
];

export default function ProductCopilot() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("knowledge");
  const { me } = useAuth();
  const initial = String((me as any)?.user?.email ?? (me as any)?.email ?? "S").trim().charAt(0).toUpperCase() || "S";
  const config = mode === "intake" ? INTAKE : KNOWLEDGE;
  return (
    <CopilotChat
      config={{ ...config, userInitial: initial }}
      open={open}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      modes={MODES}
      mode={mode}
      onModeChange={setMode}
    />
  );
}
