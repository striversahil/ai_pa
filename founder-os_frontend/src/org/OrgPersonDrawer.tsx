"use client";

// OrgPersonDrawer — the single person editor (position, sales fields, active).
//
// The sales profile lives ON the employee row (mig 0177): a person holds any
// number of regions (first picked = primary) and reports to a real Team Lead
// person picked from the chart — never a TL1/TL2 token and never a second
// roster row. Access lives ONLY in Users & Permissions; this drawer never
// touches scopes.
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import OrgPositionPicker from "@/components/human-resources/OrgPositionPicker";
import { saveOrgPerson, type OrgChartPosition, type OrgPerson, type OrgRegion } from "@/org/api";
import { rosterTypeFor, regionRulesFor } from "@/org/access";
import { REGIONS } from "@/telecalling/regions";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

export default function OrgPersonDrawer({ person, positions, people = [], regions = [], onClose, onSaved }: {
  person: OrgPerson;
  positions: OrgChartPosition[];
  /** Everyone the viewer can see — the team-lead picker lists the active ones. */
  people?: OrgPerson[];
  /** HR region catalog; the bundled taxonomy is the fallback. */
  regions?: OrgRegion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(person.employee.designation ?? "");
  const [picked, setPicked] = useState<string[]>(
    person.roster?.regions?.length ? person.roster.regions : person.roster?.region ? [person.roster.region] : [],
  );
  const [teamLeadId, setTeamLeadId] = useState(person.roster?.teamLeadId ?? "");
  const [assignFollowUps, setAssignFollowUps] = useState(person.roster?.assignEstimateFollowUps !== false);
  const [whatsapp, setWhatsapp] = useState(person.roster?.whatsapp ?? "");
  const [officePhone, setOfficePhone] = useState(person.roster?.phone ?? person.employee.phone ?? "");
  const neoKeyOf = (userId: unknown, userName: unknown) => `${String(userId ?? "").trim()}‖${String(userName ?? "").trim()}`;
  const [neoLink, setNeoLink] = useState(
    person.roster?.neodoveUserName ? neoKeyOf(person.roster.neodoveUserId, person.roster.neodoveUserName) : "",
  );
  const [neoUsers, setNeoUsers] = useState<Array<{ userId: string; userName: string }>>([]);
  const [active, setActive] = useState(person.employee.active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chartPosition = positions.find((p) => p.title === title.trim()) ?? null;
  const rosterType = rosterTypeFor(title, chartPosition?.loginPosition);
  const rules = regionRulesFor(title, chartPosition?.loginPosition);
  const showSales = rosterType !== null;
  /** Staff only: a Team Lead has no TL above them on the sales chart. */
  const canPickLead = rosterType === "telecaller" || rosterType === "field_staff";

  const leads = useMemo(
    () => people.filter((p) => p.employee.id !== person.employee.id && p.employee.active && p.roster?.type === "team_lead"),
    [people, person.employee.id],
  );

  // Region options come from the HR catalog (name + active). Any active region
  // may be picked on any seat — the chart is the one place regions are assigned.
  const catalog = regions.length
    ? regions
    : REGIONS.map((r) => ({ id: r.id, code: r.id, name: r.name, tlLevel: r.tl, states: r.states, order: 0, active: true }));
  // A region somebody still covers after the catalog retired it stays visible,
  // so the operator can take it away instead of saving an invisible value.
  const regionOptions = [
    ...catalog.filter((r) => r.active !== false),
    ...catalog.filter((r) => r.active === false && picked.includes(r.code)),
  ];

  useEffect(() => {
    if (!showSales) return;
    let alive = true;
    import("@/org/api").then((m) =>
      m.fetchUnmappedNeodoveUsers()
        .then((rows) => { if (alive) setNeoUsers(rows); })
        .catch(() => { /* picker keeps the current link; manual entry can wait */ }),
    );
    return () => { alive = false; };
  }, [showSales]);

  const toggleRegion = (code: string) => {
    setPicked((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };
  const makePrimary = (code: string) => {
    setPicked((prev) => [code, ...prev.filter((c) => c !== code)]);
  };

  const submit = async () => {
    setErr(null);
    if (!chartPosition) { setErr("Seating needs a chart title — free-text designations are edited in HR → Employees"); return; }
    setBusy(true);
    try {
      const neoParts = neoLink ? String(neoLink).split("‖") : [];
      await saveOrgPerson(person.employee.id, {
        position: title,
        regions: showSales ? picked : undefined,
        teamLeadId: canPickLead ? (teamLeadId || null) : undefined,
        assignEstimateFollowUps: canPickLead ? assignFollowUps : undefined,
        whatsapp: rules.whatsapp ? (whatsapp.trim() || null) : undefined,
        officePhone: showSales ? (officePhone.trim() || null) : undefined,
        neodoveUserId: rules.neodove ? (neoParts.length === 2 && (neoParts[0] || neoParts[1]) ? neoParts[0] : null) : undefined,
        neodoveUserName: rules.neodove ? (neoParts.length === 2 && (neoParts[0] || neoParts[1]) ? neoParts[1] : null) : undefined,
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

  return (
    <Modal title={`Edit · ${person.employee.displayName || person.employee.name}`} subtitle={person.employee.designation ?? ""} onClose={onClose} wide>
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
            <div>
              <label className={label}>Regions {rosterType === "team_lead" ? "this Team Lead covers" : "this person works"}</label>
              <div className="flex flex-wrap gap-1.5">
                {regionOptions.map((r) => {
                  const idx = picked.indexOf(r.code);
                  const on = idx >= 0;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => toggleRegion(r.code)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-indigo-500 bg-indigo-600 text-white" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
                    >
                      {on && idx === 0 ? "★ " : ""}{r.code} · {r.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">
                Pick as many as they actually cover — the first (★) is the primary region. No region = Unmapped on the leaderboard.
              </p>
              {picked.length > 1 && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                  Make primary:
                  {picked.slice(1).map((code) => (
                    <button key={code} type="button" onClick={() => makePrimary(code)} className="underline">{code}</button>
                  ))}
                </div>
              )}
            </div>

            {canPickLead && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className={label}>Reports to Team Lead</label>
                  <select value={teamLeadId} onChange={(e) => setTeamLeadId(e.target.value)} className={field}>
                    <option value="">Not linked to a Team Lead</option>
                    {teamLeadId && !leads.some((p) => p.employee.id === teamLeadId) && (
                      <option value={teamLeadId}>Currently linked team lead</option>
                    )}
                    {leads.map((p) => (
                      <option key={p.employee.id} value={p.employee.id}>
                        {p.employee.displayName || p.employee.name}{p.roster?.regions?.length ? ` · ${p.roster.regions.join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                  {!leads.length && <p className="mt-1 text-[11px] text-amber-600">No active Team Lead on the sales chart yet — seat one first.</p>}
                </div>
                <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  <input type="checkbox" checked={assignFollowUps} onChange={(e) => setAssignFollowUps(e.target.checked)} />
                  Assign estimate follow-ups
                </label>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>WhatsApp</label>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={field} placeholder="WhatsApp number" />
              </div>
              <div>
                <label className={label}>Office phone — must match NeoDove call report</label>
                <input value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} className={field} placeholder="Office phone" />
              </div>
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
              <p className="mt-1 text-[11px] text-zinc-500">
                Compare the office phone with the NeoDove User Call Report&apos;s Mobile Number column before linking — a wrong link misattributes calls.
              </p>
            </div>
          </section>
        )}

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
