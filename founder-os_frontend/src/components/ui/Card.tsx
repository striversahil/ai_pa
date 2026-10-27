import React from "react";
import type { ReactNode, HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
  interactive?: boolean;
  className?: string;
}

export function Card({ children, padded = true, interactive = false, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--shadow-soft)] ${
        interactive
          ? "transition-shadow duration-200 hover:shadow-[var(--shadow-raised)]"
          : ""
      } ${padded ? "p-5 md:p-6" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="block font-heading text-card-title font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-caption text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
