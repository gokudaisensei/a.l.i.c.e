import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { householdMembers, households, householdSettings, invitations, type Role, users } from "@/core/database/schema";
import type { DbLike } from "@/core/database/types";
import { AppError, conflict, forbidden, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { invitationCode, normalizeCode, sha256 } from "@/core/security/tokens";

const HOUR = 3_600_000;

export interface Membership {
  memberId: string;
  householdId: string;
  userId: string;
  role: Role;
  expiresAt: number | null;
}

export class HouseholdService {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  // ---- households ----

  createHousehold(tx: DbLike, name: string, adminUserId: string) {
    const t = this.now();
    const id = newId("hh");
    tx.insert(households).values({ id, name, createdAt: t }).run();
    tx.insert(householdSettings).values({ householdId: id }).run();
    tx.insert(householdMembers).values({ id: newId("mem"), householdId: id, userId: adminUserId, role: "admin", joinedAt: t }).run();
    return id;
  }

  get(householdId: string) {
    const h = this.db.select().from(households).where(eq(households.id, householdId)).get();
    if (!h) throw notFound("Household");
    return h;
  }

  update(householdId: string, patch: { name?: string; timezone?: string }) {
    if (Object.keys(patch).length) this.db.update(households).set(patch).where(eq(households.id, householdId)).run();
    return this.get(householdId);
  }

  // ---- memberships ----

  /** The user's active membership. An expired guest has none. One household per user for now. */
  getMembership(userId: string, tx: DbLike = this.db): Membership | null {
    const row = tx.select().from(householdMembers).where(eq(householdMembers.userId, userId)).orderBy(asc(householdMembers.joinedAt)).get();
    if (!row || (row.expiresAt !== null && row.expiresAt <= this.now())) return null;
    return { memberId: row.id, householdId: row.householdId, userId: row.userId, role: row.role, expiresAt: row.expiresAt };
  }

  listMembers(householdId: string) {
    return this.db
      .select({ id: householdMembers.id, userId: householdMembers.userId, displayName: users.displayName, avatarColor: users.avatarColor, role: householdMembers.role, expiresAt: householdMembers.expiresAt, joinedAt: householdMembers.joinedAt })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId))
      .orderBy(asc(householdMembers.joinedAt))
      .all()
      .map((m) => ({ ...m, expired: m.expiresAt !== null && m.expiresAt <= this.now() }));
  }

  private adminCount(householdId: string) {
    return this.db.select().from(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, "admin"))).all().length;
  }

  private member(householdId: string, memberId: string) {
    const m = this.db.select().from(householdMembers).where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, householdId))).get();
    if (!m) throw notFound("Member");
    return m;
  }

  updateMember(householdId: string, memberId: string, patch: { role?: Role; expiresAt?: number | null }) {
    const m = this.member(householdId, memberId);
    if (patch.role && patch.role !== "admin" && m.role === "admin" && this.adminCount(householdId) <= 1) throw conflict("A household needs at least one admin");
    const next: Partial<typeof householdMembers.$inferInsert> = {};
    if (patch.role) next.role = patch.role;
    if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt;
    if (Object.keys(next).length) this.db.update(householdMembers).set(next).where(eq(householdMembers.id, memberId)).run();
    return this.member(householdId, memberId);
  }

  removeMember(householdId: string, memberId: string) {
    const m = this.member(householdId, memberId);
    if (m.role === "admin" && this.adminCount(householdId) <= 1) throw conflict("A household needs at least one admin");
    this.db.delete(householdMembers).where(eq(householdMembers.id, memberId)).run();
  }

  // ---- invitations ----

  /** Returns the plain code once; only its hash is stored. */
  createInvitation(householdId: string, createdBy: string, opts: { role: Role; expiresInHours?: number; guestAccessHours?: number }) {
    const t = this.now();
    const code = invitationCode();
    const row = {
      id: newId("inv"), householdId, codeHash: sha256(normalizeCode(code)), role: opts.role,
      guestAccessMs: opts.role === "guest" ? Math.round((opts.guestAccessHours ?? 72) * HOUR) : null,
      createdBy, createdAt: t, expiresAt: t + (opts.expiresInHours ?? 24) * HOUR,
    };
    this.db.insert(invitations).values(row).run();
    return { invitation: { id: row.id, role: row.role, expiresAt: row.expiresAt, guestAccessMs: row.guestAccessMs }, code };
  }

  listInvitations(householdId: string) {
    const t = this.now();
    return this.db.select().from(invitations).where(and(eq(invitations.householdId, householdId), isNull(invitations.usedAt), isNull(invitations.revokedAt))).all()
      .filter((i) => i.expiresAt > t)
      .map(({ codeHash: _h, ...i }) => i);
  }

  revokeInvitation(householdId: string, id: string) {
    const hit = this.db.update(invitations).set({ revokedAt: this.now() }).where(and(eq(invitations.id, id), eq(invitations.householdId, householdId), isNull(invitations.usedAt))).returning({ id: invitations.id }).all();
    if (!hit.length) throw notFound("Invitation");
  }

  /** Finds a usable invitation for a typed code, or explains why not. Uniform message avoids leaking which codes exist. */
  findValidInvitation(code: string, tx: DbLike = this.db) {
    const inv = tx.select().from(invitations).where(eq(invitations.codeHash, sha256(normalizeCode(code)))).get();
    if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= this.now()) throw new AppError(400, "invalid_invitation", "That invitation code is not valid");
    return inv;
  }

  /** Marks the invitation used and creates the membership. Call inside a transaction. */
  consumeInvitation(tx: DbLike, code: string, userId: string) {
    const inv = this.findValidInvitation(code, tx);
    const t = this.now();
    tx.update(invitations).set({ usedBy: userId, usedAt: t }).where(eq(invitations.id, inv.id)).run();
    const id = newId("mem");
    tx.insert(householdMembers).values({ id, householdId: inv.householdId, userId, role: inv.role, joinedAt: t, expiresAt: inv.guestAccessMs ? t + inv.guestAccessMs : null }).run();
    return { memberId: id, householdId: inv.householdId, role: inv.role };
  }

  requireAdmin(m: Membership | null): asserts m is Membership {
    if (!m || m.role !== "admin") throw forbidden("Admins only");
  }
}
