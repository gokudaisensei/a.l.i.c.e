/**
 * Prints the two environment variables that keep the Home Assistant admin token away from the main server.
 * Put ADMIN_SEAL_PUBLIC_KEY in the main server's environment, and ADMIN_SEAL_PRIVATE_KEY (and nothing else secret-looking
 * from this output) in the config-worker's environment only. Also prints a SECRETS_KEY for the operational token.
 */
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { generateSealKeyPair, pemToEnv } from "../src/core/security/sealed";

const { publicKey, privateKey } = generateSealKeyPair();
console.log(`# Main server`);
console.log(`ADMIN_SEAL_PUBLIC_KEY=${pemToEnv(publicKey)}`);
console.log(`SECRETS_KEY=${randomBytes(32).toString("base64")}`);
console.log(`BACKUP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
const vapid = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
console.log(`\n# Config-worker only. Never give this to the main server.`);
console.log(`ADMIN_SEAL_PRIVATE_KEY=${pemToEnv(privateKey)}`);
