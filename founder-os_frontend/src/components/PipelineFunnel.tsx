import React from "react";

interface PipelineFunnelProps {
  statusCounts: Record<string, number>;
}

export default function PipelineFunnel({ statusCounts }: PipelineFunnelProps) {
  const maxVal = Math.max(...Object.values(statusCounts), 1);

  return (
    <div className="space-y-3.5 flex-1 flex flex-col justify-center">
      {Object.entries(statusCounts).map(([status, count]) => {
        const widthPercent = (count / maxVal) * 100;
        const stageColor = "from-brand-indigo to-brand-indigo/60";
        const badgeStyle = "bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-card)]";

        return (
          <div className="space-y-1.5" key={status}>
            <div className="flex justify-between items-center text-xs">
              <span className="capitalize font-bold text-[var(--text-secondary)]">{status}</span>
              <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold ${badgeStyle}`}>{count}</span>
            </div>
            <div className="h-2 w-full bg-[var(--bg-input)] rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full bg-gradient-to-r ${stageColor} transition-all duration-500`} 
                style={{ width: `${widthPercent}%` }}
              ></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
