// Extracted verbatim from ManualCallsPanel.tsx by scripts/refactor/split-module.mjs.
// ManualCallsPanel.tsx re-exports everything public here, so existing imports keep working.


export interface Agent {
  id: string;
  name: string;
  region: string;
}

export interface Entry {
  id: string;
  telecallerId: string;
  day: string;
  connectedCalls: number;
  note: string;
  hasScreenshot: boolean;
  screenshotName: string;
  updatedAt?: string | null;
}

export interface Payload {
  mode: "manual" | "neodove" | "device";
  day: string;
  from: string;
  to: string;
  agents: Agent[];
  entries: Entry[];
}
