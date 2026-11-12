// Workspaces = dashboards a signed-in viewer opens (/session). See
// founder-os_backend/src/modules/workspaces/catalog.ts for the vocabulary.
export * from "./aliases";
export * from "./api";
export { WorkspaceHostProvider, useWorkspaceHost, type WorkspaceHostValue } from "./WorkspaceHost";
export { WorkspaceRenderer, RENDERED_SLUGS } from "./registry";
export { default as WorkspaceFrame } from "./WorkspaceFrame";
export { usePinnedWorkspaces } from "./usePinned";
export { useWorkspaces } from "./useWorkspaces";
