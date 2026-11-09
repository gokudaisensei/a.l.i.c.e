"use client";
/** Data and actions for the Admin tab: members, invitations, backups, health, updates. Everything here is real; support access is not built yet. */
import { ApiError, ok, v1 } from "./api";
import { stepUp, withStepUp } from "./auth";
import type { Role } from "./data";
import { clockOf, refreshPeople } from "./live";
import { S, bump, toast } from "./store";

export interface Member { id: string; userId: string; name: string; color: number; role: Role; expiresAt: number | null; me: boolean }
export interface Invitation { id: string; role: Role; expiresAt: number }
export interface BackupItem {
  id: string; kind: "app" | "ha"; destination: string; name: string; sizeBytes: number | null; encrypted: boolean; status: "running" | "ok" | "failed"; error: string | null;
  createdAt: number; verify: { status: "none" | "running" | "passed" | "failed"; at: number | null; note: string | null };
}
export interface BackupSettings { enabled: boolean; time: string; keep: number; includeHa: boolean; destination: "local" | "nas" | "upload"; nasPath: string | null }
export interface Check { name: string; status: "ok" | "warn" | "down"; detail: string }
export interface UpdateInfo {
  currentVersion: string; state: string; installable: boolean;
  available: { version: string; notes: string; publishedAt: number | null; signed: boolean } | null;
  settings: { autoUpdate: boolean; windowStart: string; windowEnd: string }; inWindow: boolean; nextWindowAt: number; checkError: string | null;
  active: { id: string; status: string; scheduledFor: number | null } | null;
}
interface Diagnostics { app: { version: string; startedAt: number }; counts: { members: number; devices: number; scenes: number; routines: number; automations: number }; database: { sizeBytes: number | null } }

export interface SupportInfo { id: string; scope: Record<string, boolean>; startsAt: number; endsAt: number; durationHours: number; active: boolean; endedBy: string | null }


export const ADM = {
  loaded: false,
  members: [] as Member[], invitations: [] as Invitation[], newCode: null as string | null, inv: { role: "Member" as "Member" | "Guest", hours: 24 },
  backups: [] as BackupItem[], bset: null as BackupSettings | null, encryption: false, testing: false, nasDraft: "",
  health: null as null | { status: "ok" | "warn" | "down"; checks: Check[]; uptimeSeconds: number; version: string }, diag: null as Diagnostics | null, checkedAt: 0, checking: false,
  audit: [] as { id: string; at: number; who: string; action: string; detail: Record<string, unknown> | null }[],
  people: [] as { userId: string; personEntityId: string | null }[], persons: [] as { entityId: string; name: string }[],
  auditMore: null as string | null, auditFilter: "",
  hist: [] as { id: string; fromVersion: string; version: string; status: string; trigger: string; reason: string | null; finishedAt: number | null; createdAt: number }[],
  support: null as null | { active: SupportInfo | null; history: SupportInfo[]; householdLog: { at: number; text: string }[]; operatorTrail: { at: number; operator: string; action: string; target: string | null }[] },
  sup: { hours: 1, scope: { health: true, devices: true, cameras: false, control: false } as Record<string, boolean> },
  upd: null as UpdateInfo | null, em: { open: false, reason: "", word: "" },
};

const fail = (e: unknown, fallback = "That didn't work") => toast(e instanceof ApiError ? e.message : fallback);

export async function loadPeople() {
  const [m, i] = await Promise.all([
    ok(v1.household.members.get()),
    ok(v1.household.invitations.get()).catch(() => ({ invitations: [] })),
  ]);
  const ppl = await ok(v1.household.people.get()).catch(() => null);
  ADM.people = ppl?.people ?? []; ADM.persons = ppl?.unlinkedPersons ?? [];
  ADM.members = m.members.map((x) => ({ id: x.id, userId: x.userId, name: x.displayName, color: x.avatarColor, role: x.role, expiresAt: x.expiresAt, me: x.me }));
  ADM.invitations = i.invitations;
}
export async function loadBackups() {
  const r = await ok(v1.backups.get());
  ADM.backups = r.items; ADM.bset = r.settings; ADM.encryption = r.encryption; ADM.nasDraft = r.settings.nasPath ?? ADM.nasDraft;
  if (r.items.some((b) => b.status === "running" || b.verify.status === "running")) setTimeout(() => { void loadBackups().then(bump); }, 2500);
}
export async function loadHealth() {
  ADM.checking = true; bump();
  try {
    const [h, d, a] = await Promise.all([
      ok(v1.admin.health.get()), ok(v1.admin.diagnostics.get()).catch(() => null),
      ok(v1.admin.audit.get({ query: { limit: 15, ...(ADM.auditFilter ? { action: ADM.auditFilter } : {}) } })).catch(() => null),
    ]);
    ADM.auditMore = a?.nextCursor ?? null;
    ADM.audit = a ? a.items.map((x) => ({ id: x.id, at: x.at, who: x.actor.name ?? (x.actor.type === "system" ? "Alice" : "Someone"), action: x.action, detail: x.detail })) : [];
    ADM.health = h; ADM.diag = d; ADM.checkedAt = Date.now();
  } finally { ADM.checking = false; }
}
export async function loadUpdates() {
  const [u, h] = await Promise.all([ok(v1.updates.get()), ok(v1.updates.history.get()).catch(() => ({ items: [] }))]);
  ADM.upd = u; ADM.hist = h.items;
}
export async function loadSupport() { ADM.support = await ok(v1.admin.support.get()); }

const LOADERS: Record<string, () => Promise<void>> = { people: loadPeople, backups: loadBackups, health: loadHealth, updates: loadUpdates, support: loadSupport };
/** Loads what the open Admin section shows. */
export async function loadAdminTab(tab: string) {
  try { await LOADERS[tab]?.(); ADM.loaded = true; void loadAdminSummary(); } catch (e) { fail(e, "Couldn't load this section"); }
  bump();
}

/* ---------- people ---------- */
export async function setRole(m: Member, role: Role) {
  const was = m.role; m.role = role; bump();
  try { await withStepUp(() => ok(v1.household.members({ id: m.id }).patch({ role }))); toast(`${m.name} is now ${role === "admin" ? "an admin" : "a " + role}`); }
  catch (e) { m.role = was; bump(); fail(e); }
}
const HOURS: Record<string, number> = { "1 hour": 1, "24 hours": 24, "7 days": 168 };
export const inviteHours = (label: string) => HOURS[label] ?? 24;
export async function createInvite() {
  try {
    const r = await withStepUp(() => ok(v1.household.invitations.post({ role: ADM.inv.role === "Guest" ? "guest" : "member", expiresInHours: ADM.inv.hours, ...(ADM.inv.role === "Guest" ? { guestAccessHours: 72 } : {}) })));
    ADM.newCode = r.code; await loadPeople(); toast("One-time code created");
  } catch (e) { fail(e); }
  bump();
}
export async function revokeInvite(id: string) {
  try { await ok(v1.household.invitations({ id }).delete()); ADM.newCode = null; await loadPeople(); toast("Invite revoked"); } catch (e) { fail(e); }
  bump();
}

/* ---------- backups ---------- */
export async function backUpNow() {
  try { await ok(v1.backups.post({ what: "both" })); toast("Backup started. It counts once it passes a restore test"); await loadBackups(); } catch (e) { fail(e); }
  bump();
}
export async function testLatest() {
  const b = ADM.backups.find((x) => x.kind === "app" && x.status === "ok");
  if (!b) { toast("There is no finished backup to test yet"); return; }
  ADM.testing = true; bump();
  try {
    const r = await ok(v1.backups({ id: b.id }).verify.post({}));
    await loadBackups();
    toast(r.verify.status === "failed" ? `The restore test failed: ${r.verify.note ?? "see the backup"}` : r.verify.status === "passed" ? "Restore test passed. The backup is verified" : "Checking with Home Assistant…");
  } catch (e) { fail(e); }
  ADM.testing = false; bump();
}
export async function saveBackupSettings(patchBody: Partial<BackupSettings>) {
  try { await withStepUp(() => ok(v1.backups.settings.put(patchBody))); await loadBackups(); toast("Backup settings saved"); } catch (e) { fail(e); }
  bump();
}

/* ---------- updates ---------- */
export async function updateAction(call: () => Promise<unknown>, doneMsg = "Done") {
  try { await withStepUp(call); await loadUpdates(); toast(doneMsg); } catch (e) { fail(e); }
  bump();
}
export const setAutoUpdate = async (on: boolean) => {
  try { await withStepUp(() => ok(v1.updates.settings.put({ autoUpdate: on }))); await loadUpdates(); toast(on ? "Updates will install by themselves in the window" : "Automatic updates are off"); } catch (e) { fail(e); }
  bump();
};
export async function emergencyDeploy() {
  await updateAction(() => ok(v1.updates.emergency.post({ reason: ADM.em.reason.trim(), confirmation: ADM.em.word })), "Emergency deploy started");
  if (ADM.upd?.state === "installing" || ADM.upd?.state === "preparing") ADM.em = { open: false, reason: "", word: "" };
  bump();
}

/* ---------- notifications (this person's own) ---------- */
export async function loadPreferences() {
  const p = await ok(v1.users.me.preferences.get()).catch(() => null);
  if (p) { S.push = p.pushEnabled; S.quiet = p.quietHours?.enabled ?? false; }
}
export async function savePreference(body: { pushEnabled?: boolean; quietHours?: { enabled: boolean; from?: string; to?: string } }) {
  try { await ok(v1.users.me.preferences.patch(body)); } catch (e) { fail(e); await loadPreferences(); bump(); }
}

/** What Home and the nav badge need to know about the admin side: backup safety, a waiting update, and whether health is fine. */
export async function loadAdminSummary() {
  const [b, u, h] = await Promise.all([
    ok(v1.backups.get()).catch(() => null),
    ok(v1.updates.get()).catch(() => null),
    ok(v1.admin.health.get()).catch(() => null),
  ]);
  if (!b) return;
  const latest = b.items.find((x) => x.kind === "app" && x.status === "ok");
  S.adm = {
    backupOk: latest?.verify.status === "passed", backupNone: !latest, lastVerified: latest?.verify.at ? clockOf(latest.verify.at) : "never",
    nextBackup: b.settings.enabled ? `tonight at ${b.settings.time}` : "(scheduled backups are off)", updateReady: u?.state === "ready", healthWarn: !!h && h.status !== "ok",
  };
  bump();
}

/* ---------- people: removal and Home Assistant person links ---------- */
export async function removeMember(m: Member) {
  try { await withStepUp(() => ok(v1.household.members({ id: m.id }).delete())); await loadPeople(); toast(`${m.name} was removed`); } catch (e) { fail(e); }
  bump();
}
export async function linkPerson(userId: string, personEntityId: string | null) {
  try { await withStepUp(() => ok(v1.household.people({ userId }).put({ personEntityId }))); await loadPeople(); await refreshPeople(); toast(personEntityId ? "Linked. Arrivals and departures now follow that person" : "Unlinked"); } catch (e) { fail(e); }
  bump();
}

/* ---------- audit ---------- */
export async function setAuditFilter(prefix: string) { ADM.auditFilter = prefix; await loadHealth(); bump(); }
export async function moreAudit() {
  if (!ADM.auditMore) return;
  try {
    const r = await ok(v1.admin.audit.get({ query: { limit: 15, before: ADM.auditMore, ...(ADM.auditFilter ? { action: ADM.auditFilter } : {}) } }));
    ADM.audit = [...ADM.audit, ...r.items.map((x) => ({ id: x.id, at: x.at, who: x.actor.name ?? (x.actor.type === "system" ? "Alice" : "Someone"), action: x.action, detail: x.detail }))];
    ADM.auditMore = r.nextCursor;
  } catch (e) { fail(e); }
  bump();
}

/* ---------- backups: one at a time ---------- */
export async function verifyBackup(id: string) {
  try { const r = await ok(v1.backups({ id }).verify.post({})); await loadBackups(); toast(r.verify.status === "failed" ? `The test failed: ${r.verify.note ?? ""}` : r.verify.status === "passed" ? "Restore test passed" : "Checking with Home Assistant…"); } catch (e) { fail(e); }
  bump();
}
export async function deleteBackup(id: string) {
  try { await withStepUp(() => ok(v1.backups({ id }).delete())); await loadBackups(); toast("Backup deleted"); } catch (e) { fail(e); }
  bump();
}
export async function restoreBackup(b: BackupItem) {
  try {
    const r = await withStepUp(() => ok(v1.backups({ id: b.id }).restore.post({ confirm: "RESTORE" })));
    toast(r.note ?? "Restore started");
  } catch (e) { fail(e); }
}
/** Downloads one of Alice's own backups. A passkey check first; the file is encrypted when a backup key is set. */
export async function downloadBackup(b: BackupItem) {
  const fetchIt = () => fetch(`/api/v1/backups/${b.id}/download`, { credentials: "same-origin" });
  try {
    let res = await fetchIt();
    if (res.status === 403) { await stepUp(); res = await fetchIt(); }
    if (!res.ok) { toast("The download was refused"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = b.name; a.click(); URL.revokeObjectURL(url);
  } catch (e) { fail(e, "The download didn't work"); }
}

/* ---------- updates: history and rollback ---------- */
export async function rollbackUpdate(id: string, restoreData: boolean) {
  await updateAction(() => ok(v1.updates({ id }).rollback.post({ restoreData })), restoreData ? "Rolling back. Restart Alice to finish restoring the data" : "Rolling back to the previous version");
}

/* ---------- support ---------- */
export async function grantSupport() {
  try { await withStepUp(() => ok(v1.admin.support.post({ hours: ADM.sup.hours, scope: ADM.sup.scope }))); await loadSupport(); toast("Support can now see what you allowed"); } catch (e) { fail(e); }
  bump();
}
export async function extendSupport(id: string) {
  try { await withStepUp(() => ok(v1.admin.support({ id }).extend.post({}))); await loadSupport(); } catch (e) { fail(e); }
  bump();
}
export async function endSupport(id: string) {
  try { await ok(v1.admin.support({ id }).end.post({})); await loadSupport(); toast("Support access ended"); } catch (e) { fail(e); }
  bump();
}
