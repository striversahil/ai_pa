"use client";

import React, { useCallback, useEffect, useState } from "react";
import Modal from "../Modal";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { HrMember } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";

function MemberRow({ member, onSaved, onRemove }: {
  member: HrMember;
  onSaved: () => void;
  onRemove: (m: HrMember) => void;
}) {
  const [name, setName] = useState(member.name);
  const [designation, setDesignation] = useState(member.designation ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = name !== member.name || designation !== (member.designation ?? "") || email !== (member.email ?? "") || phone !== (member.phone ?? "");

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/members/${member.id}`, "PATCH", {
        name: name.trim(),
        designation: designation.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const field = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={field} />
        <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Designation" className={field} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={field} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={field} />
      </div>
      {err && <div className="text-[11px] text-rose-500">{err}</div>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => onRemove(member)} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50">Remove</button>
        <button onClick={save} disabled={busy || !dirty || !name.trim()} className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-white dark:text-zinc-900 disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

export default function TeamManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [members, setMembers] = useState<HrMember[] | null>(null);
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HrMember | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const res = await fetch("/api/human-resources/members?deleted=0", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setMembers(Array.isArray(body.members) ? body.members : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      setMembers([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await jsonRequest("/api/human-resources/members", "POST", {
        name: name.trim(),
        designation: designation.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        order: members?.length ?? 0,
      });
      if (!res.ok) throw new Error(await readError(res));
      setName(""); setDesignation(""); setEmail(""); setPhone("");
      await load();
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/members/${removing.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setRemoving(null);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";

  return (
    <>
      <Modal title="Manage HR team" subtitle="People tasks can be delegated to. Removing keeps their historical tasks." onClose={onClose}>
        <form onSubmit={add} className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={field} />
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Designation" className={field} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className={field} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={field} />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{busy ? "Adding…" : "Add member"}</button>
          </div>
        </form>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        {members === null && <div className="py-6 text-center text-xs text-zinc-500 animate-pulse">Loading team…</div>}
        {members?.length === 0 && <div className="py-6 text-center text-xs text-zinc-500">No HR team members yet. Add the first one above.</div>}
        <div className="space-y-2">
          {members?.map((m) => (
            <MemberRow key={m.id} member={m} onSaved={() => { void load(); onChanged(); }} onRemove={setRemoving} />
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title="Remove team member?"
        message={<>Remove <b>{removing?.name}</b> from the HR roster? Existing tasks and expenses stay intact.</>}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
