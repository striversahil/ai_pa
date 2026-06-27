import React from "react";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trendText?: string;
  trendPositive?: boolean;
}

export default function KpiCard({ title, value, icon, trendText, trendPositive }: KpiCardProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 hover:bg-[var(--bg-input)]/25 transition-all duration-150">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-[var(--text-tertiary)] tracking-wider uppercase">{title}</span>
        <div className="w-8 h-8 rounded-lg bg-[var(--bg-input)] flex items-center justify-center text-[var(--text-secondary)]">
          {icon}
        </div>
      </div>
      <span className="text-2xl md:text-3xl font-extrabold font-heading tracking-tight text-[var(--text-primary)]">
        {value}
      </span>
      {trendText && (
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] mt-3">
          {trendPositive !== undefined && (
            <span className={`font-bold ${trendPositive ? "text-brand-emerald" : "text-brand-rose"}`}>
              {trendPositive ? "+" : ""}{trendText.split(" ")[0]}
            </span>
          )}
          <span>{trendPositive !== undefined ? trendText.substring(trendText.indexOf(" ") + 1) : trendText}</span>
        </div>
      )}
    </div>
  );
}
