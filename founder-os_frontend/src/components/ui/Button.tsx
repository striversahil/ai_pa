import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared action button — one visual contract for dashboard actions so pages
 * stop hand-rolling `px-3.5 py-2 rounded-xl …` strings. Theme-token driven
 * (light/dark via CSS custom properties).
 *
 *  primary   — the one main action on a surface (brand fill)
 *  secondary — neutral bordered action
 *  ghost     — low-emphasis inline action (no border)
 *  danger    — destructive action (soft red, fills on hover)
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-[var(--color-brand-indigo)] text-white shadow-[var(--shadow-soft)] hover:opacity-90",
  secondary:
    "border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--surface-soft)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]",
  danger:
    "border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-caption",
  md: "h-10 gap-2 px-4 text-label",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-indigo)]/40 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (inline SVG or glyph). */
  icon?: ReactNode;
}) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon && <span className="inline-flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </button>
  );
}

export default Button;
