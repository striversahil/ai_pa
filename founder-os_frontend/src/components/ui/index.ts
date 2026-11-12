export { Badge, StatusBadge, PriorityBadge, toneClasses, toneDot } from "./Badge";
export type { Tone } from "./Badge";
export { Card, CardHeader } from "./Card";
export { KpiCard } from "./KpiCard";
export { Skeleton, SkeletonCard } from "./Skeleton";
export { EmptyState, ErrorState } from "./States";
export { Table, thClass, tdClass, stickyCol } from "./Table";

export { TabBar } from "./TabBar";
export type { TabBarItem } from "./TabBar";

// Overlays — use these instead of hand-rolling `fixed inset-0` panels.
// Modal: ESC + backdrop close, body scroll lock. (Implementation stays at
// components/Modal.tsx for existing default imports.)
export { default as Modal } from "../Modal";
export { default as ConfirmDialog } from "./ConfirmDialog";
export { default as Popover } from "./Popover";
