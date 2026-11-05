const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/** ULID: 48-bit time + 80 bits of randomness. Lexicographically sortable by creation time. */
export function ulid(now = Date.now()): string {
  let t = "";
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) t = ALPHABET[n % 32] + t;
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += ALPHABET[rand[i]! % 32];
  return t + r;
}

export const newId = (prefix: string) => `${prefix}_${ulid()}`;
