// Extracted verbatim from WhatsAppDashboard.tsx by scripts/refactor/split-module.mjs.
// WhatsAppDashboard.tsx re-exports everything public here, so existing imports keep working.


export interface Digest {
  id: string;
  chatId: string;
  chatName: string;
  summary: string;
  priority: "low" | "medium" | "high" | "urgent";
  category: string;
  sentiment: string;
  requiresFounder: boolean;
  suggestedReply?: string;
  createdAt: string;
}

export interface Contact {
  uid: string;
  name: string;
  phone_number: string;
  email?: string;
  isGroup?: boolean;
  picture?: string | null;
}

export interface RawMessage {
  id: string;
  chatId: string;
  sender: string;
  body: string;
  timestamp: string;
  processed: boolean;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedSender?: string | null;
  mediaUrl?: string | null;
}

export interface PendingItem {
  id: string;
  chatId: string;
  chatName: string;
  description: string;
  status: string;
  dueDate: string | null;
  sourceMessageId: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PendingChat {
  chatId: string;
  chatName: string;
  openCount: number;
  items: PendingItem[];
}
