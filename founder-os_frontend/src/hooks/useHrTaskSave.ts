"use client";

// Shared optimistic writer for delegated-task cards.
//
// One implementation for both task boards:
//   * HR dashboard → /api/human-resources/tasks/:id
//   * /delegation   → /api/delegation/tasks/:id
//
// The card only builds the request body; this hook paints the change
// instantly through the shared `useOptimisticMutation` driver, then reconciles
// with server truth in the background. No component-level fetch/rollback copy.
import { useCallback } from "react";
import { jsonRequest, readError } from "@/hr/api";
import { patchTaskInBuckets, type TaskBuckets } from "@/hr/delegation";
import type { HrTask } from "@/hr/types";
import {
  patchRowInLists, useOptimisticMutation, type LiveQueryResult,
} from "./useLiveData";

type TaskPayload = { tasks: HrTask[] | TaskBuckets };

export function useHrTaskSave<T extends TaskPayload>(
  query: LiveQueryResult<T>,
  mode: "manager" | "self",
) {
  const { mutate } = useOptimisticMutation(query);

  return useCallback(
    (task: HrTask, body: Record<string, unknown>) => {
      // Optimistic row patch mirrors what the server writes: the status/remark
      // plus the derived flags the card renders from.
      const patch: Record<string, unknown> = {
        ...body,
        updatedAt: new Date().toISOString(),
        needsUpdate: false,
        ...(body.status === "done" ? { overdue: false } : {}),
      };
      return mutate(
        (prev) => {
          if (!prev) return prev;
          if (Array.isArray(prev.tasks)) {
            return patchRowInLists(prev as any, ["tasks"], "id", task.id, patch) as T | null;
          }
          return patchTaskInBuckets(prev as any, task.id, patch as Partial<HrTask>) as T | null;
        },
        async () => {
          const url = mode === "manager"
            ? `/api/human-resources/tasks/${task.id}`
            : `/api/delegation/tasks/${task.id}`;
          const res = await jsonRequest(url, "PATCH", body);
          if (!res.ok) throw new Error(await readError(res));
        },
        { key: task.id },
      );
    },
    [mutate, mode],
  );
}
