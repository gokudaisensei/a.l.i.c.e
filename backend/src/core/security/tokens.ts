import { createHash, randomBytes, randomInt } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** URL-safe random token (session tokens). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const b32 = (n: number) => Array.from({ length: n }, () => B32[randomInt(32)]).join("");

const WORDS_A = ["MAPLE", "CEDAR", "RIVER", "AMBER", "CORAL", "SOLAR", "LUNAR", "MINT", "OLIVE", "PEARL", "SANDY", "TIDAL", "WILLOW", "FROST", "EMBER", "BIRCH", "JADE", "OAK", "PINE", "ROSE", "SAGE", "SILK", "STONE", "SUNNY", "BREEZE", "CLOUD", "DAWN", "FERN", "GROVE", "HAZEL", "IVORY", "LILAC"];
const WORDS_B = ["KITE", "LAMP", "HARBOR", "BELL", "BRIDGE", "COMET", "DRUM", "FALCON", "GARDEN", "HAWK", "ISLAND", "JUNGLE", "KETTLE", "LANTERN", "MEADOW", "NEST", "ORBIT", "PEBBLE", "QUILL", "ROBIN", "SAILOR", "TULIP", "UMBRELLA", "VALLEY", "WAGON", "YARN", "ZEPHYR", "ANCHOR", "BARN", "CABIN", "DAISY", "FIELD"];
const pick = (xs: string[]) => xs[randomInt(xs.length)]!;

/** Human-friendly invitation code, about 50 bits: MAPLE-482913-KITE-7Q4X. */
export const invitationCode = () => `${pick(WORDS_A)}-${String(randomInt(1_000_000)).padStart(6, "0")}-${pick(WORDS_B)}-${b32(4)}`;

/** One-time account recovery code, 50 bits: ABCDE-23456. */
export const recoveryCode = () => `${b32(5)}-${b32(5)}`;

/** Codes are typed by people: ignore case, spaces and stray separators. */
export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");
