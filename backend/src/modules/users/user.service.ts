import { eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { userPreferences, users } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";

export class UserService {
  constructor(private readonly db: Db) {}

  get(userId: string) {
    const u = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!u) throw notFound("User");
    return u;
  }

  update(userId: string, patch: { displayName?: string; avatarColor?: number; locale?: string }) {
    const next: typeof patch = {};
    if (patch.displayName !== undefined) {
      const n = patch.displayName.trim();
      if (n.length < 1 || n.length > 60) throw new AppError(400, "validation_error", "Name must be 1 to 60 characters");
      next.displayName = n;
    }
    if (patch.avatarColor !== undefined) next.avatarColor = patch.avatarColor;
    if (patch.locale !== undefined) next.locale = patch.locale;
    if (Object.keys(next).length) this.db.update(users).set(next).where(eq(users.id, userId)).run();
    return this.get(userId);
  }

  getPreferences(userId: string) {
    return this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get() ?? { userId, quietHours: null, pushEnabled: true, extra: null };
  }

  updatePreferences(userId: string, patch: { quietHours?: { enabled: boolean; from?: string; to?: string } | null; pushEnabled?: boolean; extra?: Record<string, unknown> | null }) {
    this.db.insert(userPreferences).values({ userId, ...patch }).onConflictDoUpdate({ target: userPreferences.userId, set: patch }).run();
    return this.getPreferences(userId);
  }
}
