import { env } from "../config/env";
import { createDb, runMigrations } from "./client";

runMigrations(createDb(env.databaseUrl));
console.log("Migrations applied");
