// ─────────────────────────────────────────────────────────────────────────────
// worker/workspace-data.ts — Hono adapter for modules/workspaces/service.
//
// One handler body for both
//   GET /api/session/workspaces/:slug/data   (routes/session.ts — canonical)
//   GET /api/automations/:slug/data          (routes/automations.ts — deprecated alias)
// so the two paths can never drift.
// ─────────────────────────────────────────────────────────────────────────────
import { deps, getEntryOrReload } from './context';
import { getViewerMe } from './viewer';
import { getWorkspaceData } from '../modules/workspaces/service';
import { workspaceResolvers } from '../modules/workspaces/resolvers';

export async function serveWorkspaceData(c: any, rawSlug: string): Promise<Response> {
  const { AutomationEngine } = deps();
  const result = await getWorkspaceData({
    rawSlug,
    query: { ...c.req.query() },
    engine: {
      isLoaded: (slug) => !!AutomationEngine.get(slug),
      reload: (slug) => getEntryOrReload(slug),
      getData: (slug, query) => AutomationEngine.getData(slug, query),
    },
    resolvers: workspaceResolvers(() => getViewerMe(c)),
  });
  return c.json(result.body as any, result.status as any);
}
