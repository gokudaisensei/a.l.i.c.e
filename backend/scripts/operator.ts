/**
 * Support staff accounts. Run on the server, where the database is.
 *   bun scripts/operator.ts create ops-114 [days]   prints the token once (lasts 90 days unless told)
 *   bun scripts/operator.ts revoke ops-114
 */
import { env } from "../src/core/config/env";
import { createDb, runMigrations } from "../src/core/database/client";
import { createServices } from "../src/services";

const [cmd, label, days] = process.argv.slice(2);
if (!cmd || !label) { console.error("usage: bun scripts/operator.ts create|revoke <label>"); process.exit(1); }
const db = createDb(env.databaseUrl);
runMigrations(db);
const { operators } = createServices(db);
if (cmd === "create") { const r = operators.create(label, days ? Number(days) : 90); console.log(`Operator ${r.operator.label} created, valid until ${new Date(r.expiresAt).toISOString().slice(0, 10)}. Token (shown once):\n${r.token}`); }
else if (cmd === "revoke") { operators.revoke(label); console.log(`Operator ${label} revoked.`); }
else { console.error("unknown command"); process.exit(1); }
process.exit(0);
