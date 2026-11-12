// Software passkey authenticator (ES256, `none` attestation, resident key, UV flag, counter).
// Runbook T1.2 / ENV-06. Uses node:crypto so the ECDSA signature is ASN.1 DER as WebAuthn requires.
import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  randomBytes,
} from "node:crypto";

function sha256(data: Uint8Array | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function u16(n: number): Uint8Array {
  return Uint8Array.of((n >> 8) & 0xff, n & 0xff);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- minimal CBOR encoder (integers, byte strings, text, arrays, maps) --------------------------
function cborHead(major: number, len: number): Uint8Array {
  if (len < 24) return Uint8Array.of((major << 5) | len);
  if (len < 0x100) return Uint8Array.of((major << 5) | 24, len);
  if (len < 0x10000) return Uint8Array.of((major << 5) | 25, (len >> 8) & 0xff, len & 0xff);
  const out = new Uint8Array(5);
  out[0] = (major << 5) | 26;
  new DataView(out.buffer).setUint32(1, len);
  return out;
}

function cborInt(n: number): Uint8Array {
  return n >= 0 ? cborHead(0, n) : cborHead(1, -1 - n);
}

function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat(cborHead(2, bytes.length), bytes);
}

function cborText(text: string): Uint8Array {
  const b = new Uint8Array(Buffer.from(text, "utf8"));
  return concat(cborHead(3, b.length), b);
}

function cborMap(entries: [string | number, Uint8Array][]): Uint8Array {
  return concat(
    cborHead(5, entries.length),
    ...entries.flatMap(([k, v]) => [typeof k === "number" ? cborInt(k) : cborText(k), v]),
  );
}

function b64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64url");
}

export interface PasskeyOptions {
  origin?: string;
  rpId?: string;
  /** User verification flag; defaults to true. */
  uv?: boolean;
  /** Override the signature counter (for counter-regression negative tests). */
  counter?: number;
  /** Answer even when the credential is not in `allowCredentials` (a "wrong user's passkey" probe). */
  ignoreAllowCredentials?: boolean;
}

export interface RegisterOptions {
  challenge: string;
  rp?: { id?: string; name?: string };
  user?: { id?: string; name?: string; displayName?: string };
  [key: string]: unknown;
}

export interface AssertOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: { id: string; type?: string }[];
  [key: string]: unknown;
}

export class SoftwareAuthenticator {
  readonly credentialId: Uint8Array;
  readonly credentialIdB64: string;
  private readonly privateKeyPem: string;
  private readonly coseKey: Uint8Array;
  userHandle?: string;
  signCount = 0;
  rpId = "localhost";
  origin = "http://localhost:3001";

  constructor(credentialId?: Uint8Array, privateKeyPem?: string) {
    const privateKey = privateKeyPem
      ? createPrivateKey(privateKeyPem)
      : generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const publicKey = createPublicKey(privateKey);
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const x = new Uint8Array(Buffer.from(jwk.x, "base64url"));
    const y = new Uint8Array(Buffer.from(jwk.y, "base64url"));
    this.privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    this.coseKey = cborMap([
      [1, cborInt(2)], // kty: EC2
      [3, cborInt(-7)], // alg: ES256
      [-1, cborInt(1)], // crv: P-256
      [-2, cborBytes(x)],
      [-3, cborBytes(y)],
    ]);
    this.credentialId = credentialId ?? new Uint8Array(randomBytes(32));
    this.credentialIdB64 = b64url(this.credentialId);
  }

  /** Produce a registration (attestation) response for the server's options. */
  register(options: RegisterOptions, opts: PasskeyOptions = {}): Record<string, unknown> {
    const origin = opts.origin ?? this.origin;
    const rpId = options.rp?.id ?? opts.rpId ?? this.rpId;
    this.origin = origin;
    this.rpId = rpId;
    this.userHandle = options.user?.id ?? this.userHandle;

    const counter = opts.counter ?? 0;
    const clientData = JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false });
    const clientDataBuf = Buffer.from(clientData, "utf8");
    const rpIdHash = sha256(Buffer.from(rpId, "utf8"));
    const flags = 0x01 | (opts.uv === false ? 0 : 0x04) | 0x40; // UP | UV | AT
    const authData = concat(
      rpIdHash,
      Uint8Array.of(flags),
      u32(counter),
      new Uint8Array(16), // AAGUID (zero for none attestation)
      u16(this.credentialId.length),
      this.credentialId,
      this.coseKey,
    );
    const attestationObject = cborMap([
      ["fmt", cborText("none")],
      ["attStmt", cborMap([])],
      ["authData", cborBytes(authData)],
    ]);

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataBuf),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** Produce an assertion response for the server's options. */
  assert(options: AssertOptions, opts: PasskeyOptions = {}): Record<string, unknown> {
    const origin = opts.origin ?? this.origin;
    const rpId = opts.rpId ?? options.rpId ?? this.rpId;
    if (!opts.ignoreAllowCredentials && options.allowCredentials?.length) {
      const allowed = options.allowCredentials.map((c) => c.id);
      if (!allowed.includes(this.credentialIdB64)) {
        throw new Error("software authenticator: credential is not in allowCredentials");
      }
    }
    // The server stores the last counter it saw and rejects an assertion whose counter does not
    // increase (replay/clone detection). A plain `++signCount` can collide when an earlier run
    // wrote the counter to the server but not to this state file, so use wall-clock seconds as a
    // monotonic floor; the value still fits WebAuthn's 32-bit counter until 2106.
    const counter = opts.counter ?? Math.max(++this.signCount, Math.floor(Date.now() / 1000));
    this.signCount = counter;
    const clientData = JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false });
    const clientDataBuf = Buffer.from(clientData, "utf8");
    const clientDataHash = sha256(clientDataBuf);
    const rpIdHash = sha256(Buffer.from(rpId, "utf8"));
    const flags = 0x01 | (opts.uv === false ? 0 : 0x04); // UP | UV
    const authData = concat(rpIdHash, Uint8Array.of(flags), u32(counter));
    const signature = cryptoSign("sha256", Buffer.concat([authData, clientDataHash]), {
      key: this.privateKeyPem,
      dsaEncoding: "der",
    });

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataBuf),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle ?? null,
      },
      clientExtensionResults: {},
    };
  }

  /** Persist so a later request (or a re-run) can log in with the same passkey. */
  toJSON(): PasskeyState {
    return {
      credentialIdB64: this.credentialIdB64,
      privateKeyPem: this.privateKeyPem,
      signCount: this.signCount,
      rpId: this.rpId,
      origin: this.origin,
      userHandle: this.userHandle,
    };
  }

  static fromJSON(state: PasskeyState): SoftwareAuthenticator {
    const auth = new SoftwareAuthenticator(
      new Uint8Array(Buffer.from(state.credentialIdB64, "base64url")),
      state.privateKeyPem,
    );
    auth.signCount = state.signCount;
    auth.rpId = state.rpId;
    auth.origin = state.origin;
    auth.userHandle = state.userHandle;
    return auth;
  }
}

export interface PasskeyState {
  credentialIdB64: string;
  privateKeyPem: string;
  signCount: number;
  rpId: string;
  origin: string;
  userHandle?: string;
}
