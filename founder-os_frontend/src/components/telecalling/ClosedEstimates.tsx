"use client";

// ClosedEstimates — the accepted rows behind a region's `Won` stat.
//
// Thin wrapper over EstimateDrawer (single table implementation shared with
// DeclinedEstimates, so the two drawers can never drift apart).

import React from "react";
import { EstimateDrawer, type EstimateDrawerProps } from "./EstimateDrawer";

export type ClosedEstimatesProps = Omit<EstimateDrawerProps, "variant">;

export function ClosedEstimates(props: ClosedEstimatesProps) {
  return <EstimateDrawer {...props} variant="won" />;
}

export default ClosedEstimates;
