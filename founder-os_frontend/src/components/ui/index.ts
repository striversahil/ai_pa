export { Badge, StatusBadge, PriorityBadge, toneClasses, toneDot } from "./Badge";
export type { Tone } from "./Badge";
export { Card, CardHeader } from "./Card";
export { KpiCard } from "./KpiCard";
export { Skeleton, SkeletonCard } from "./Skeleton";
export { EmptyState, ErrorState } from "./States";
export { Table, thClass, tdClass, stickyCol } from "./Table";

export { TabBar } from "./TabBar";
export type { TabBarItem, TabBarVariant } from "./TabBar";
export { Button, buttonClass } from "./Button";
export { Pager, PageJumper, ChangesBanner } from "./Pager";
export type { ButtonVariant, ButtonSize } from "./Button";

// Overlays — use these instead of hand-rolling `fixed inset-0` panels.
// Modal: ESC + backdrop close, body scroll lock. (Implementation stays at
// components/Modal.tsx for existing default imports.)
export { default as Modal } from "../Modal";
export { default as ConfirmDialog } from "./ConfirmDialog";
export { default as Popover } from "./Popover";
export { Drawer } from "./Drawer";
// Searchable dropdowns (single + multi) — use these instead of chip walls for
// any audience/filter list that can grow past a handful of options.
export { SearchSelect, SearchMultiSelect } from "./SearchSelect";
export type { SearchOption } from "./SearchSelect";
// Date range (as-of snapshot vs comparison) — one home for every dashboard.
export { default as DateRangePicker } from "./DateRangePicker";
export type { DateRangeValue, DateRangePreset, DateRangePickerProps } from "./DateRangePicker";
