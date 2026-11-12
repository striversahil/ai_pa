// modules/workspaces/resolvers.ts — the real ScopeResolvers (everything except
// loadMe, which the Hono route binds to the request's viewer).
// Service modules stay lazily imported, exactly as the inline route did, so a
// workspace read doesn't pull every domain service into the request path.
import type { ScopeResolvers } from './scoping';
import { accessScopesFor } from '../automation/registry-worker';
import { resolveSelfTelecallerId } from '../telecalling/self-roster';
import { canViewMaster } from '../master-data/editors';
import { viewableDepartments } from '../reporting/access';

export function workspaceResolvers(loadMe: ScopeResolvers['loadMe']): ScopeResolvers {
  return {
    loadMe,
    resolveSelfTelecallerId,
    async resolveSelfAccountant(as, me) {
      const { resolveSelfAccountant } = await import('../../automations/accounts/service');
      return resolveSelfAccountant(as as any, me as any);
    },
    async resolveSelfDigitalMarketingManager(as, me) {
      const { resolveSelfDigitalMarketingManager } = await import('../../automations/digital-marketing/service');
      return resolveSelfDigitalMarketingManager(as as any, me as any);
    },
    async resolveSelfHumanResourcesMember(as, me) {
      const { resolveSelfHumanResourcesMember } = await import('../../automations/human-resources/service');
      return resolveSelfHumanResourcesMember(as as any, me as any);
    },
    accessScopesFor,
    canViewMaster,
    viewableDepartments,
  };
}
