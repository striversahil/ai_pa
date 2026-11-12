// Extracted verbatim from NeoDoveCampaignSection.tsx by scripts/refactor/split-module.mjs.
// NeoDoveCampaignSection.tsx re-exports everything public here, so existing imports keep working.


export interface Props {
  /** The Controller is already manager-gated upstream; kept explicit for clarity. */
  canManage: boolean;
}
