import { and, eq } from "drizzle-orm";
import type { Db } from "../../core/database/client";
import { personLinks } from "../../core/database/schema";
import { AppError } from "../../core/errors/errors";
import type { AppEvent } from "../../core/events/app-events";
import type { EventBus, Unsubscribe } from "../../core/events/event-bus";
import { writeAudit } from "../../core/security/audit";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { HouseholdService } from "./household.service";

export interface PersonInfo {
  connectionId: string;
  entityId: string;
  name: string;
  home: boolean;
}

export interface PersonView {
  userId: string;
  displayName: string;
  role: string;
  /** The Home Assistant person linked to this member, if any. */
  personEntityId: string | null;
  /** Null when the member is not linked to a person, so nobody knows. */
  home: boolean | null;
  /** An unlinked person whose name matches this member's, offered to the admin. */
  suggestedPersonEntityId: string | null;
}

/**
 * Who is home, about Alice's people. Home Assistant knows `person` entities; an admin links each to a household member.
 * Until anything is linked, every person counts (so a fresh install still works).
 */
export class PresenceService {
  private unsub: Unsubscribe | null = null;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus<AppEvent>,
    private readonly things: ThingsService,
    private readonly households: HouseholdService,
    private readonly now: () => number = Date.now,
  ) {}

  /** Announces arrivals and departures of people. */
  start() {
    this.unsub = this.bus.subscribe("entity.state_changed", (e) => {
      if (!e.entityId.startsWith("person.")) return;
      const link = this.db.select().from(personLinks).where(and(eq(personLinks.householdId, e.householdId), eq(personLinks.connectionId, e.connectionId), eq(personLinks.personEntityId, e.entityId))).get();
      if ((e.previousState === "home") === (e.currentState === "home")) return; // not an arrival or a departure
      this.bus.publish({ type: "presence.changed", householdId: e.householdId, userId: link?.userId ?? null, personEntityId: e.entityId, home: e.currentState === "home", timestamp: e.timestamp });
    });
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  /** Every Home Assistant person of the household. */
  persons(householdId: string): PersonInfo[] {
    const out: PersonInfo[] = [];
    for (const ct of this.things.forHousehold(householdId)) {
      for (const e of ct.conn.inventory?.entities ?? []) {
        if (e.domain === "person") out.push({ connectionId: ct.conn.config.id, entityId: e.entityId, name: e.sourceName, home: ct.conn.cache.get(e.entityId)?.state === "home" });
      }
    }
    return out;
  }

  private links(householdId: string) {
    return this.db.select().from(personLinks).where(eq(personLinks.householdId, householdId)).all();
  }

  /** Members (not guests, not expired) with who is home. */
  people(householdId: string): { people: PersonView[]; unlinkedPersons: PersonInfo[] } {
    const persons = this.persons(householdId);
    const links = this.links(householdId);
    const linkedIds = new Set(links.map((l) => l.personEntityId));
    const byEntity = new Map(persons.map((p) => [p.entityId, p]));
    const unlinkedPersons = persons.filter((p) => !linkedIds.has(p.entityId));
    const people = this.households.listMembers(householdId).filter((m) => !m.expired).map((m): PersonView => {
      const link = links.find((l) => l.userId === m.userId);
      const person = link ? byEntity.get(link.personEntityId) : undefined;
      const guess = link ? undefined : unlinkedPersons.find((p) => p.name.trim().toLowerCase() === m.displayName.trim().toLowerCase());
      return { userId: m.userId, displayName: m.displayName, role: m.role, personEntityId: link?.personEntityId ?? null, home: person ? person.home : null, suggestedPersonEntityId: guess?.entityId ?? null };
    });
    return { people, unlinkedPersons };
  }

  /**
   * The people that count for "everyone has left" and "someone is home": the linked persons of members who are not guests,
   * or every person if nothing is linked yet.
   */
  relevant(householdId: string): PersonInfo[] {
    const links = this.links(householdId);
    const persons = this.persons(householdId);
    if (!links.length) return persons;
    const eligible = new Set(this.households.listMembers(householdId).filter((m) => !m.expired && m.role !== "guest").map((m) => m.userId));
    const allowed = new Set(links.filter((l) => eligible.has(l.userId)).map((l) => l.personEntityId));
    return persons.filter((p) => allowed.has(p.entityId));
  }

  counts(householdId: string): { total: number; home: number } {
    const r = this.relevant(householdId);
    return { total: r.length, home: r.filter((p) => p.home).length };
  }

  /** The Home Assistant person for this member, if linked. */
  personOf(householdId: string, userId: string): string | null {
    return this.db.select().from(personLinks).where(and(eq(personLinks.householdId, householdId), eq(personLinks.userId, userId))).get()?.personEntityId ?? null;
  }

  isHome(householdId: string, userId: string): boolean | null {
    const id = this.personOf(householdId, userId);
    return id ? (this.persons(householdId).find((p) => p.entityId === id)?.home ?? null) : null;
  }

  /** Links a member to a person, or unlinks with null. Admins only (checked by the route). */
  link(householdId: string, actorId: string, userId: string, personEntityId: string | null) {
    if (!this.households.listMembers(householdId).some((m) => m.userId === userId)) throw new AppError(404, "not_found", "Member not found");
    if (personEntityId === null) {
      this.db.delete(personLinks).where(and(eq(personLinks.householdId, householdId), eq(personLinks.userId, userId))).run();
    } else {
      const person = this.persons(householdId).find((p) => p.entityId === personEntityId);
      if (!person) throw new AppError(404, "unknown_entity", "That person is not in Home Assistant");
      const taken = this.db.select().from(personLinks).where(and(eq(personLinks.householdId, householdId), eq(personLinks.personEntityId, personEntityId))).get();
      if (taken && taken.userId !== userId) throw new AppError(409, "conflict", "That person is already linked to someone else");
      this.db.insert(personLinks).values({ householdId, userId, connectionId: person.connectionId, personEntityId, createdAt: this.now() })
        .onConflictDoUpdate({ target: [personLinks.householdId, personLinks.userId], set: { connectionId: person.connectionId, personEntityId, createdAt: this.now() } }).run();
    }
    writeAudit(this.db, { householdId, actorId, action: "household.person_linked", resource: userId, detail: { personEntityId } }, this.now());
    this.bus.publish({ type: "presence.links_changed", householdId, timestamp: new Date(this.now()).toISOString() });
  }
}
