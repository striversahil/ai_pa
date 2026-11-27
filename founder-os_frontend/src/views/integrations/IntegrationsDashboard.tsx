"use client";

// views/integrations/IntegrationsDashboard.tsx — /integrations (root only).
// The panel itself lives in components/integrations (that is where the feature
// keeps its tabs/wizards); this is the routed surface, same shape as every
// other top-level view.
import React from "react";
import IntegrationsPanel from "@/components/integrations/IntegrationsDashboard";

export default function IntegrationsView() {
  return (
    <div className="px-3 py-3 sm:px-4">
      <IntegrationsPanel />
    </div>
  );
}
