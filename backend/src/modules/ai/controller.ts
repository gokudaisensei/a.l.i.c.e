import { Elysia, t } from "elysia";
import { requireMember } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const aiController = ({ auth, households, assistant }: Services) =>
  new Elysia({ name: "module.ai", prefix: "/ai", tags: ["ai"] })
    .use(sessionPlugin(auth, households))
    .post("/interpret", async (ctx) => {
      const { session, membership } = requireMember(ctx);
      const c = { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
      return { items: await assistant.interpret(c, ctx.body.text) };
    }, {
      body: t.Object({ text: t.String({ maxLength: 200 }) }),
      detail: { summary: "Read a sentence such as \"turn off the kitchen lights\" and offer what Alice could do, with a plain description of each. Nothing is run" },
    });
