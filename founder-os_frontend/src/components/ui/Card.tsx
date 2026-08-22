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
      className={`rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--shadow-card)] ${
        interactive ? "transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5" : ""
      } ${padded ? "p-5" : ""} ${className}`}
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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="block font-heading text-base font-extrabold tracking-tight text-[var(--text-primary)] md:text-lg">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
