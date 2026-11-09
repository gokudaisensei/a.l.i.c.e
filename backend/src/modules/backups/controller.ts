import { Elysia, t } from "elysia";
import { AppError } from "../../core/errors/errors";
import { requirePermission, requireStepUp } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

const id = t.Object({ id: t.String({ minLength: 4, maxLength: 60 }) });

export const backupsController = ({ auth, households, backups }: Services) =>
  new Elysia({ name: "module.backups", prefix: "/backups", tags: ["backups"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const { membership } = requirePermission(ctx, "backup.manage");
      return { items: backups.list(membership.householdId), settings: backups.settings(membership.householdId), encryption: backups.encryptionEnabled };
    }, { detail: { summary: "Backups of Alice and of Home Assistant, newest first, with the schedule settings" } })
    .get("/settings", (ctx) => backups.settings(requirePermission(ctx, "backup.manage").membership.householdId), { detail: { summary: "The backup schedule, retention and destination" } })
    .put("/settings", (ctx) => {
      const { membership, session } = requirePermission(ctx, "backup.manage");
      requireStepUp(session);
      return backups.updateSettings(membership.householdId, session.userId, ctx.body);
    }, {
      body: t.Object({
        enabled: t.Optional(t.Boolean()), time: t.Optional(t.String({ maxLength: 5 })), keep: t.Optional(t.Integer({ minimum: 1, maximum: 90 })), includeHa: t.Optional(t.Boolean()),
        destination: t.Optional(t.Union([t.Literal("local"), t.Literal("nas"), t.Literal("upload")])), nasPath: t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()])),
      }),
      detail: { summary: "Change the backup schedule, how many to keep, and where Alice's own backups go. Needs a recent passkey confirmation" },
    })
    .post("/", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "backup.manage");
      const { membership: m } = { membership };
      const out: unknown[] = [];
      const what = ctx.body.what ?? "both";
      if (what !== "ha") out.push(await backups.createApp(m.householdId, { trigger: "manual", userId: session.userId }));
      if (what !== "app") {
        try { out.push(backups.createHa(m.householdId, { trigger: "manual", userId: session.userId })); } catch (e) { if (what === "ha" || !(e instanceof AppError)) throw e; }
      }
      return { items: out };
    }, {
      body: t.Object({ what: t.Optional(t.Union([t.Literal("app"), t.Literal("ha"), t.Literal("both")])) }),
      detail: { summary: "Make a backup now. The Home Assistant one is made by Home Assistant and finishes in the background" },
    })
    .get("/:id", (ctx) => backups.get(requirePermission(ctx, "backup.manage").membership.householdId, ctx.params.id), { params: id, detail: { summary: "One backup, including the result of its restore test" } })
    .post("/:id/verify", (ctx) => backups.verify(requirePermission(ctx, "backup.manage").membership.householdId, ctx.params.id), {
      params: id, detail: { summary: "Test-restore a backup without touching live data. Alice's backups are opened and checked; Home Assistant's are checked with Home Assistant" },
    })
    .post("/:id/restore", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "backup.manage");
      requireStepUp(session);
      if (ctx.body.confirm !== "RESTORE") throw new AppError(400, "confirmation_required", "Type RESTORE to confirm");
      const rec = backups.get(membership.householdId, ctx.params.id);
      return rec.kind === "ha" ? backups.restoreHa(membership.householdId, rec.id, session.userId) : backups.restoreApp(membership.householdId, rec.id, session.userId);
    }, {
      params: id, body: t.Object({ confirm: t.String({ maxLength: 20 }) }),
      detail: { summary: "Restore a backup. Alice's own is staged and applied at the next start; Home Assistant's is restored by Home Assistant. Needs a passkey confirmation and the word RESTORE" },
    })
    .delete("/:id", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "backup.manage");
      requireStepUp(session);
      return backups.remove(membership.householdId, ctx.params.id, session.userId);
    }, { params: id, detail: { summary: "Delete a backup (for Home Assistant's, from Home Assistant too). Needs a passkey confirmation" } })
    .get("/:id/download", async (ctx) => {
      const { membership, session } = requirePermission(ctx, "backup.manage");
      requireStepUp(session);
      const f = await backups.download(membership.householdId, ctx.params.id, session.userId);
      return new Response(new Uint8Array(f.bytes), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${f.name}"`, "cache-control": "no-store" } });
    }, { params: id, detail: { summary: "Download one of Alice's own backups. Needs a passkey confirmation; the file is encrypted when a backup key is set" } });
