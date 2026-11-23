"use client";

// NotificationConsole — the authoring surface (root/admin), mounted as a tab
// inside Settings. Three views over one payload:
//   Rules       → author / test / run / pause the escalations
//   Deliveries  → the newest 200 dispatches across everyone (audit)
//   Levels      → the 5-colour palette + flood caps
//
// Live: refetches on the `notifications` event the engine broadcasts, so the
// "Last run" column updates the moment a sweep dispatches.
import React, { useState } from "react";
import { ErrorState, TabBar } from "@/components/ui";
import { useLiveQuery } from "@/hooks/useLiveData";
import { fetchNotificationConsole, saveNotificationRule, saveNotificationSettings } from "@/notifications/api";
import { emptyRule } from "@/notifications/helpers";
import type { NotificationConsolePayload, NotificationRule } from "@/notifications/types";
import { RulesTab } from "./RulesTab";
import { DeliveriesTab } from "./DeliveriesTab";
import { LevelsTab } from "./LevelsTab";
import { RuleDrawer } from "./RuleDrawer";

type Tab = "rules" | "deliveries" | "levels";

export function NotificationConsole() {
  const dash = useLiveQuery<NotificationConsolePayload>(fetchNotificationConsole, { events: ["notifications"] });
  const [tab, setTab] = useState<Tab>("rules");
  const [editing, setEditing] = useState<{ rule: NotificationRule; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const payload = dash.data;
  const levels = payload?.levels ?? [];
  const options = payload?.options;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--text-primary)]">Notifications</h2>
        <p className="text-[11px] text-[var(--text-secondary)]">
          Position-wise escalations: one SQL query decides who is in trouble and how badly, the cron dispatches it as an instant toast plus an
          inbox row (newest 200 kept in the bell).
        </p>
      </div>

      {dash.error && !payload ? (
        <ErrorState title="Could not load the notification console" message={String((dash.error as any)?.message ?? "")} onRetry={dash.refresh} />
      ) : null}

      {!payload || !options ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : (
        <>
          <TabBar
            variant="segmented"
            active={tab}
            onChange={(k: string) => setTab(k as Tab)}
            items={[
              { key: "rules", label: `Rules ${payload.rules.length}` },
              { key: "deliveries", label: `Deliveries ${payload.deliveries.length}` },
              { key: "levels", label: "Levels & caps" },
            ]}
          />

          {tab === "rules" ? (
            <RulesTab
              rules={payload.rules}
              levels={levels}
              busy={busy}
              onCreate={() => setEditing({ rule: emptyRule(), isNew: true })}
              onEdit={(rule) => setEditing({ rule, isNew: false })}
              onToggle={async (rule) => {
                setBusy(rule.key);
                try {
                  await saveNotificationRule(rule.key, { ...rule, enabled: !rule.enabled });
                  dash.refresh();
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : null}

          {tab === "deliveries" ? <DeliveriesTab deliveries={payload.deliveries} levels={levels} /> : null}

          {tab === "levels" ? (
            <LevelsTab
              levels={levels}
              settings={payload.settings}
              busy={busy === "settings"}
              error={settingsError}
              onSave={async (nextLevels, nextSettings) => {
                setBusy("settings");
                setSettingsError(null);
                try {
                  await saveNotificationSettings({ levels: nextLevels, settings: nextSettings });
                  dash.refresh();
                } catch (e: any) {
                  setSettingsError(e?.message ?? "Save failed");
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : null}

          {editing ? (
            <RuleDrawer
              // Remount when switching rules so the form state can never leak.
              key={editing.isNew ? "new" : editing.rule.key}
              rule={editing.rule}
              isNew={editing.isNew}
              options={options}
              levels={levels}
              onClose={() => setEditing(null)}
              onSaved={(saved) => {
                dash.refresh();
                if (saved) setEditing({ rule: saved, isNew: false });
                else setEditing(null);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
