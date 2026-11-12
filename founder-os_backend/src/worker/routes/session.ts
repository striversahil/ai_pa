// ─────────────────────────────────────────────────────────────────────────────
// routes/session.ts — the viewer-facing API (the human side), Worker-only.
//
//   GET /api/session                         who am I + the workspaces I can open
//   GET /api/session/workspaces              the workspaces I can open
//   GET /api/session/workspaces/:slug/data   a workspace's data, scoped to me
//
// Read-only and never touches the automation registry (enable/pause/config
// live in routes/automations.ts). Viewer scoping: modules/workspaces/scoping.ts.
// The two founder-approved publicData workspaces are AUTH_EXEMPT on the data
// path (context.ts, derived from the catalog); everything else needs a session.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, type Bindings } from '../context';
import { getViewer } from '../viewer';
import { serveWorkspaceData } from '../workspace-data';
import { listWorkspaces, type WorkspaceRow } from '../../modules/workspaces/service';
import { AUTOMATION_SCOPES, accessScopesFor } from '../../modules/automation/registry-worker';

function scopeFor(slug: string): { scope: string; scopes: string[] } {
  const scope = AUTOMATION_SCOPES[slug] ?? slug;
  return { scope, scopes: accessScopesFor(slug, scope) };
}

async function workspacesFor(viewer: Awaited<ReturnType<typeof getViewer>>): Promise<WorkspaceRow[]> {
  const { prisma } = deps();
  const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
  return listWorkspaces(rows.map((r: any) => ({ slug: r.slug, name: r.name })), viewer, scopeFor);
}

export function registerSessionRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/session', async (c) => {
    const viewer = await getViewer(c);
    if (!viewer.me) return c.json({ error: 'Authentication required' }, 401);
    const { user, scopes, roles, isAdmin, isRoot } = viewer.me;
    return c.json({ user, scopes, roles, isAdmin, isRoot, workspaces: await workspacesFor(viewer) });
  });

  app.get('/api/session/workspaces', async (c) => {
    const viewer = await getViewer(c);
    if (!viewer.me) return c.json({ error: 'Authentication required' }, 401);
    return c.json(await workspacesFor(viewer));
  });

  app.get('/api/session/workspaces/:slug/data', (c) => serveWorkspaceData(c, c.req.param('slug')));
}
