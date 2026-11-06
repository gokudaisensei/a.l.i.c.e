/**
 * Dev and test only: a software passkey for browsers with no authenticator (CI, the in-app browser).
 * Replaces navigator.credentials.create/get with an ES256 authenticator built on WebCrypto, the same idea as the backend's
 * VirtualAuthenticator. Keys live in sessionStorage so sign-in survives a reload. Load it before the app asks for a passkey.
 */
(() => {
  if (window.__virtualPasskey) return;
  window.__virtualPasskey = true;
  const enc = new TextEncoder();
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const head = (major, n) => n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255];
  const cbor = (v) => {
    if (typeof v === "number") return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
    if (typeof v === "string") { const b = enc.encode(v); return cat(Uint8Array.from(head(3, b.length)), b); }
    if (v instanceof Uint8Array) return cat(Uint8Array.from(head(2, v.length)), v);
    return cat(Uint8Array.from(head(5, v.length)), ...v.flatMap(([k, x]) => [cbor(k), cbor(x)]));
  };
  const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const store = () => JSON.parse(sessionStorage.getItem("vpk") || "{}");
  const save = (s) => sessionStorage.setItem("vpk", JSON.stringify(s));
  const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const clientData = (type, challenge) => enc.encode(JSON.stringify({ type, challenge: b64u(challenge), origin: location.origin, crossOrigin: false }));

  navigator.credentials.create = async ({ publicKey: o }) => {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const credId = crypto.getRandomValues(new Uint8Array(16));
    const s = store(); s[b64u(credId)] = { jwk, counter: 0, user: b64u(o.user.id) }; s.last = b64u(credId); save(s);
    const cose = cbor([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]);
    const idLen = Uint8Array.from([credId.length >> 8, credId.length & 255]);
    const rpHash = await sha(enc.encode(o.rp.id || location.hostname));
    const authData = cat(rpHash, Uint8Array.from([0x45]), new Uint8Array(4), new Uint8Array(16), idLen, credId, cose);
    const att = cbor([["fmt", "none"], ["attStmt", []], ["authData", authData]]);
    return {
      id: b64u(credId), rawId: ab(credId), type: "public-key", authenticatorAttachment: "platform",
      response: { clientDataJSON: ab(clientData("webauthn.create", new Uint8Array(o.challenge))), attestationObject: ab(att), getTransports: () => ["internal"] },
      getClientExtensionResults: () => ({}),
    };
  };

  navigator.credentials.get = async ({ publicKey: o }) => {
    const s = store();
    const allowed = (o.allowCredentials || []).map((c) => b64u(c.id));
    const id = allowed.find((a) => s[a]) || (allowed.length ? null : s.last);
    if (!id || !s[id]) throw new DOMException("No passkey on this device", "NotAllowedError");
    const c = s[id]; c.counter += 1; save(s);
    const key = await crypto.subtle.importKey("jwk", c.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const rpHash = await sha(enc.encode(o.rpId || location.hostname));
    const counter = Uint8Array.from([0, 0, (c.counter >> 8) & 255, c.counter & 255]);
    const authData = cat(rpHash, Uint8Array.from([0x05]), counter);
    const cd = clientData("webauthn.get", new Uint8Array(o.challenge));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, cat(authData, await sha(cd))));
    // WebCrypto gives r||s; WebAuthn wants DER.
    const der = (n) => { let i = 0; while (i < n.length - 1 && n[i] === 0) i++; let b = n.slice(i); if (b[0] & 0x80) b = cat(Uint8Array.from([0]), b); return cat(Uint8Array.from([2, b.length]), b); };
    const r = der(raw.slice(0, 32)), sv = der(raw.slice(32));
    const sig = cat(Uint8Array.from([0x30, r.length + sv.length]), r, sv);
    return {
      id, rawId: ab(unb64u(id)), type: "public-key", authenticatorAttachment: "platform",
      response: { clientDataJSON: ab(cd), authenticatorData: ab(authData), signature: ab(sig), userHandle: ab(unb64u(c.user)) },
      getClientExtensionResults: () => ({}),
    };
  };
})();
