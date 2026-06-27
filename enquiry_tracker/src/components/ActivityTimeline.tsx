import React from "react";
import { Agent, Enquiry } from "../mockData";

interface ActivityTimelineProps {
  activities?: Enquiry["activities"];
  agents: Agent[];
}

export default function ActivityTimeline({ activities = [], agents }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center p-8 text-[var(--text-secondary)] text-xs">
        No update logs recorded for this enquiry yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {[...activities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .map(act => {
          const actAgent = agents.find(a => a.id === act.agentId);
          return (
            <div key={act.id} className="flex gap-3 pl-4 relative before:absolute before:left-0 before:top-2 before:bottom-0 before:w-0.5 before:bg-[var(--border-card)]">
              <div className="flex flex-col min-w-0">
                <span className="text-xs md:text-sm font-medium text-[var(--text-secondary)]">
                  {act.text}{" "}
                  {actAgent && <strong className="text-[var(--text-primary)]">({actAgent.name})</strong>}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  {new Date(act.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}
