"use client";
import React, { createContext, useContext } from "react";
import { useEnquiryThreads, useThreadActions } from "@/enquiry-threads/useThreads";
import type { EnquiryThread, ThreadDesk } from "@/enquiry-threads/types";

// One thread fetch per open enquiry, shared by every item card below it
// (ItemQueries). The server serves only what `desk` may see — Sales never
// receives Management <-> Procurement threads.
interface Ctx {
  desk: ThreadDesk;
  enquiryId: string;
  threads: EnquiryThread[];
  act: ReturnType<typeof useThreadActions>;
}

const EnquiryThreadsCtx = createContext<Ctx | null>(null);

export function useItemThreadsCtx(): Ctx | null {
  return useContext(EnquiryThreadsCtx);
}

export default function EnquiryThreadsProvider({ desk, enquiryId, children }: { desk: ThreadDesk; enquiryId: string; children: React.ReactNode }) {
  const { threads, refresh, patch } = useEnquiryThreads(desk, enquiryId);
  const act = useThreadActions(desk, refresh, patch);
  return <EnquiryThreadsCtx.Provider value={{ desk, enquiryId, threads, act }}>{children}</EnquiryThreadsCtx.Provider>;
}
