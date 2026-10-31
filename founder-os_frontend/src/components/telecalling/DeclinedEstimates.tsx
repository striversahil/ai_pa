"use client";

// DeclinedEstimates — the declined rows behind a region's `Declined` stat.
//
// Thin wrapper over EstimateDrawer (same table as the Won drawer), so the two
// figures on a region row are explained by exactly the same component.

import React from "react";
import { EstimateDrawer, type EstimateDrawerProps } from "./EstimateDrawer";

export type DeclinedEstimatesProps = Omit<EstimateDrawerProps, "variant">;

export function DeclinedEstimates(props: DeclinedEstimatesProps) {
  return <EstimateDrawer {...props} variant="declined" />;
}

export default DeclinedEstimates;
