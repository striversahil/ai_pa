// useDebouncedValue — delay a fast-changing value (e.g. a search box) until
// it settles, so server-backed hooks don't refetch per keystroke.
//
// Both dispatch surfaces (CrmDashboard + SalesDispatchPanel) search
// server-side through useCrmOrders — without this, typing "SO-11" fires 5
// full floor scans. 300ms matches the ManagementReview server-search delay.
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}
