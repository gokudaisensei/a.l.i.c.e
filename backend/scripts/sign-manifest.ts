/**
 * Publisher tool: signs an update manifest.
 *   UPDATE_SIGNING_PRIVATE_KEY=... bun scripts/sign-manifest.ts manifest.json > signed.json
 * The manifest holds { version, notes, publishedAt, artifactSha256 }; the signature covers all of them.
 */
import { readFileSync } from "node:fs";
import { pemFromEnv } from "../src/core/security/sealed";
import { signManifest } from "../src/modules/updates/sources";

const key = process.env.UPDATE_SIGNING_PRIVATE_KEY;
const file = process.argv[2];
if (!key || !file) { console.error("usage: UPDATE_SIGNING_PRIVATE_KEY=... bun scripts/sign-manifest.ts manifest.json"); process.exit(1); }
const { signature: _old, ...m } = JSON.parse(readFileSync(file, "utf8"));
console.log(JSON.stringify(signManifest(m, pemFromEnv(key)), null, 2));
