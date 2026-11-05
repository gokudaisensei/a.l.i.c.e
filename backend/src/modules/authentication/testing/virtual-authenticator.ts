import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

/** Minimal CBOR encoder: unsigned/negative ints, byte strings, text strings, maps. Enough for attestation objects and COSE keys. */
type Cbor = number | Uint8Array | string | Map<number | string, Cbor>;
function cbor(v: Cbor): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v.entries()].flatMap(([k, val]) => [cbor(k), cbor(val)])]);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

/**
 * A software passkey for tests: creates ES256 credentials and signs challenges exactly as a browser authenticator would.
 * It exercises the real verification path of @simplewebauthn/server.
 */
export class VirtualAuthenticator {
  private creds = new Map<string, { privateKey: KeyObject; counter: number }>();

  constructor(private readonly rpId: string, private readonly origin: string) {}

  /** The most recently created credential id. */
  lastCredentialId = "";

  private rpHash = () => sha(this.rpId);

  create(options: { challenge: string }, opts: { origin?: string } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const credId = randomBytes(16);
    const id = b64(credId);
    this.creds.set(id, { privateKey, counter: 0 });
    this.lastCredentialId = id;

    const cose = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length);
    const authData = Buffer.concat([this.rpHash(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLen, credId, cose]);
    const attestationObject = cbor(new Map<string, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    return {
      id, rawId: id, type: "public-key" as const, clientExtensionResults: {}, authenticatorAttachment: "platform" as const,
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ["internal" as const] },
    };
  }

  get(options: { challenge: string }, opts: { credentialId?: string; origin?: string; userHandle?: string; userVerified?: boolean } = {}) {
    const id = opts.credentialId ?? this.lastCredentialId;
    const cred = this.creds.get(id);
    if (!cred) throw new Error("VirtualAuthenticator has no such credential");
    cred.counter += 1;
    const counter = Buffer.alloc(4); counter.writeUInt32BE(cred.counter);
    const authData = Buffer.concat([this.rpHash(), Buffer.from([opts.userVerified === false ? 0x01 : 0x05]), counter]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, sha(clientDataJSON)]), cred.privateKey);
    return {
      id, rawId: id, type: "public-key" as const, clientExtensionResults: {}, authenticatorAttachment: "platform" as const,
      response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(signature), userHandle: opts.userHandle },
    };
  }
}
