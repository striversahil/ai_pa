"use client";

// OrgPersonDrawer — the single person editor (position, sales fields, access).
//
// Reuses the chart OrgPositionPicker (never a second picker). Sales-only
// fields appear by position: Region for Telecaller/Field Staff (+WhatsApp,
// office phone, NeoDove mapping); Team Lead adds the second region + TL level.
// Access chips are the position's suggested dashboards pre-checked, editable;
// the server delta-keeps anything beyond the viewer's power.
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import OrgPositionPicker from "@/components/human-resources/OrgPositionPicker";
import { fetchUnmappedNeodoveUsers, saveOrgPerson, type OrgPerson } from "@/org/api";
import { isSalesRosterTitle, regionRulesFor } from "@/org/access";
import { REGIONS } from "@/telecalling/regions";
import { isOrgTitle } from "@/hr/organization";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

const TL_LEVELS = ["", "TL1", "TL2"];

export default function OrgPersonDrawer({ person, onClose, onSaved }: {
  person: OrgPerson;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(person.employee.designation ?? "");
  const [region, setRegion] = useState(person.roster?.region ?? "");
  const [region2, setRegion2] = useState(person.roster?.region2 ?? "");
  const [tlLevel, setTlLevel] = useState(person.roster?.tlLevel ?? "");
  const [whatsapp, setWhatsapp] = useState(person.roster?.whatsapp ?? "");
  const [officePhone, setOfficePhone] = useState(person.roster?.phone ?? person.employee.phone ?? "");
  const neoKeyOf = (userId: unknown, userName: unknown) => `${String(userId ?? "").trim()}‖${String(userName ?? "").trim()}`;
  const [neoLink, setNeoLink] = useState(
    person.roster?.neodoveUserName ? neoKeyOf(person.roster.neodoveUserId, person.roster.neodoveUserName) : "",
  );
  const [neoUsers, setNeoUsers] = useState<Array<{ userId: string; userName: string }>>([]);
  const [scopes, setScopes] = useState<string[]>(() => [
    ...new Set([...(person.suggestedScopes ?? []), ...(person.login?.scopes ?? [])]),
  ]);
  const [active, setActive] = useState(person.employee.active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rules = regionRulesFor(title);
  const showSales = isSalesRosterTitle(title);

  useEffect(() => {
    if (!showSales) return;
    let alive = true;
    fetchUnmappedNeodoveUsers()
      .then((rows) => { if (alive) setNeoUsers(rows); })
      .catch(() => { /* picker stays manual-entry-free; link can wait */ });
    return () => { alive = false; };
  }, [showSales]);

  const toggleScope = (s: string) => setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = async () => {
    setErr(null);
    if (!isOrgTitle(title)) { setErr("Pick the organization position from the chart"); return; }
    if (rules.region && !region) { setErr("Region required for sales staff (R1–R4)"); return; }
    if (title === "Team Lead" && tlLevel === "TL1" && region && region2 && region === region2) {
      setErr("A TL1 needs two DIFFERENT regions");
      return;
    }
    setBusy(true);
    try {
      const neoParts = neoLink ? String(neoLink).split("‖") : [];
      await saveOrgPerson(person.employee.id, {
        position: title,
        region: rules.region ? region : undefined,
        region2: rules.region2 ? region2 : undefined,
        tlLevel: showSales ? tlLevel : undefined,
        whatsapp: rules.whatsapp ? (whatsapp.trim() || null) : undefined,
        officePhone: showSales ? (officePhone.trim() || null) : undefined,
        neodoveUserId: rules.neodove ? (neoParts.length === 2 && (neoParts[0] || neoParts[1]) ? neoParts[0] : null) : undefined,
        neodoveUserName: rules.neodove ? (neoParts.length === 2 && (neoParts[0] || neoParts[1]) ? neoParts[1] : null) : undefined,
        scopes,
        active,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const scopeOptions = useMemo(
    () => [...new Set([...(person.suggestedScopes ?? []), ...(person.login?.scopes ?? [])])],
    [person],
  );

  return (
    <Modal title={`Edit · ${person.employee.name}`} subtitle={person.employee.designation ?? ""} onClose={onClose} wide>
      <div className="space-y-3">
        <section className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">Organization position</h3>
          <OrgPositionPicker
            designation={title}
            department={person.employee.department ?? ""}
            onChange={(next) => setTitle(next.title)}
          />
        </section>

        {showSales && (
          <section className="space-y-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.03] p-3">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-500">Sales fields</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>Region *</label>
                <select value={region} onChange={(e) => setRegion(e.target.value)} className={field}>
                  <option value="">Pick region…</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                </select>
              </div>
              {rules.region2 && (
                <div>
                  <label className={label}>Second region (Team Lead covers two)</label>
                  <select value={region2} onChange={(e) => setRegion2(e.target.value)} className={field}>
                    <option value="">Pick second region…</option>
                    {REGIONS.filter((r) => r.id !== region).map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>Hierarchy</label>
                <select value={tlLevel} onChange={(e) => setTlLevel(e.target.value)} className={field}>
                  {TL_LEVELS.map((t) => <option key={t} value={t}>{t === "" ? "—" : t}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>WhatsApp</label>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={field} placeholder="WhatsApp number" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>Office phone — must match NeoDove call report</label>
                <input value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} className={field} placeholder="Office phone" />
              </div>
              <div>
                <label className={label}>NeoDove user (the office-phone mapping)</label>
                <select value={neoLink} onChange={(e) => setNeoLink(e.target.value)} className={field}>
                  <option value="">No link</option>
                  {person.roster?.neodoveUserName && !neoUsers.some((u) => neoKeyOf(u.userId, u.userName) === neoKeyOf(person.roster!.neodoveUserId, person.roster!.neodoveUserName)) && (
                    <option value={neoKeyOf(person.roster.neodoveUserId, person.roster.neodoveUserName)}>
                      ✓ {person.roster.neodoveUserName} (currently linked)
                    </option>
                  )}
                  {neoUsers.map((u) => (
                    <option key={neoKeyOf(u.userId, u.userName)} value={neoKeyOf(u.userId, u.userName)}>
                      {u.userName || "(no name)"}{u.userId ? ` · ${String(u.userId).slice(0, 8)}…` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">
              Compare the office phone with the NeoDove User Call Report&apos;s Mobile Number column before linking — a wrong link misattributes calls.
            </p>
          </section>
        )}

        <section className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">Dashboard access</h3>
          {!person.login ? (
            <p className="text-[11px] text-zinc-500">
              No platform login linked — link one via loginEmail in the employee master, then set access here.
            </p>
          ) : scopeOptions.length === 0 ? (
            <p className="text-[11px] text-zinc-500">This position suggests no dashboards.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {scopeOptions.map((s) => {
                const on = scopes.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleScope(s)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                      on ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {on ? "✓ " : ""}{s}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active employee {active ? "" : "· hides from seats and the leaderboard"}
        </label>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Saving…" : "Save person"}</button>
        </div>
      </div>
    </Modal>
  );
}
