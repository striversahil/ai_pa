// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


export interface SummaryOutput {
  chatName: string;
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  sentiment: string;
  action_items: Array<{
    task: string;
    owner: string;
    deadline: string | null;
  }>;
  requires_founder: boolean;
  suggested_reply: string | null;
  pending_from_founder?: Array<{
    description: string;
    due_date: string | null;
  }>;
}
