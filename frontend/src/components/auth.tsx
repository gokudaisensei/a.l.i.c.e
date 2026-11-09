"use client";
import { useEffect, useState, type ReactNode } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button, Checkbox, Field, Icon, Input, Loading, Notice, cn } from "@/ui";
import { ok, v1 } from "@/lib/api";
import { isLive, loadHome, startRealtime } from "@/lib/live";
import { setStepUp } from "@/lib/store";
import { stepUp } from "@/lib/auth";
import { finishRegistration, loadSession, passkeyMessage, passkeysSupported, register, signIn, signInWithRecoveryCode, signOut, useAuth, withStepUp } from "@/lib/auth";

// The store asks for a passkey check through this hook (set here to avoid an import cycle).
setStepUp(stepUp);

/** One screen of sign-in or set-up. A fresh `key` per title replays the entrance, so each step feels like a new page. */
function Card({ title, lead, icon, center, hideTitle, children }: { title: string; lead?: string; icon?: ReactNode; center?: boolean; hideTitle?: boolean; children: ReactNode }) {
  return (
    <main className="auth">
      <div className={cn("auth-card", center && "auth-card--center")} key={title}>
        <div className="brand">alice<i>.</i></div>
        {icon ? <div className="auth-ic">{icon}</div> : null}
        <h1 className={hideTitle ? "sr" : undefined}>{title}</h1>
        {lead ? <p className="muted auth-lead">{lead}</p> : null}
        {children}
      </div>
    </main>
  );
}

/** A plain-language problem, shown where the person is looking. */
const ErrNote = ({ err }: { err: string | null }) => (err ? <Notice tone="warn">{err}</Notice> : null);

/** Phones open the keyboard over half the screen, so only focus a field automatically where there is a real pointer. */
const fine = () => typeof matchMedia !== "undefined" && matchMedia("(pointer:fine)").matches;

/** Runs a passkey action with a busy flag and a plain error message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(passkeyMessage(e)); } finally { setBusy(false); }
  };
  return { busy, err, run };
}

const NoPasskeys = () => (!passkeysSupported() ? <Notice tone="warn">This browser can’t make passkeys. Use a recent Chrome, Edge, Safari or Firefox, opened at localhost or an https address.</Notice> : null);

function Setup() {
  const [name, setName] = useState("");
  const [setup, setSetup] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const { busy, err, run } = useAction();
  const codeRequired = useAuth((s) => s.state.status === "setup" && s.state.codeRequired);
  if (codes) return <RecoveryCodes codes={codes} />;
  return (
    <Card title="Set up your home" lead="You'll be the admin. Alice uses a passkey instead of a password: your phone or computer will ask for your fingerprint, face or PIN.">
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => setCodes(await register(name.trim(), undefined, setup.trim()))); }}>
        <Field label="Your name"><Input autoFocus={fine()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gokul" maxLength={60} required autoComplete="name" autoCapitalize="words" enterKeyHint="go" /></Field>
        {codeRequired && <Field label="Setup code"><Input value={setup} onChange={(e) => setSetup(e.target.value)} autoComplete="off" spellCheck={false} enterKeyHint="go" required aria-describedby="setup-hint" /><p id="setup-hint" className="small">Find it in the server log, or in the SETUP_CODE setting.</p></Field>}
        <NoPasskeys />
        <ErrNote err={err} />
        <Button variant="primary" size="lg" loading={busy} type="submit" disabled={busy || !name.trim() || (codeRequired && !setup.trim()) || !passkeysSupported()}>{busy ? "Waiting for your passkey…" : "Create passkey and continue"}</Button>
      </form>
    </Card>
  );
}

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(codes.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <Card title="Save your recovery codes" lead="If you lose this device, one of these gets you back in. Each works once. Alice shows them only now.">
      <ul className="codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="auth-row">
        <Button onClick={copy}><Icon n={copied ? "check" : "copy"} c="sm" />{copied ? "Copied" : "Copy all"}</Button>
        <Checkbox checked={saved} onChange={setSaved}>I’ve saved them somewhere safe</Checkbox>
      </div>
      <Button variant="primary" size="lg" disabled={!saved} onClick={finishRegistration}>Continue</Button>
    </Card>
  );
}

function SignIn() {
  const { busy, err, run } = useAction();
  const [mode, setMode] = useState<"passkey" | "code" | "join">("passkey");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} />;
  if (mode === "code") return (
    <Card title="Use a recovery code" lead="This only lets you add a new passkey to your account.">
      <form onSubmit={(e) => { e.preventDefault(); void run(() => signInWithRecoveryCode(code.trim())); }}>
        <Field label="Code"><Input autoFocus={fine()} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="characters" enterKeyHint="go" /></Field>
        <ErrNote err={err} />
        <Button variant="primary" size="lg" loading={busy} type="submit" disabled={busy || !code.trim()}>Continue</Button>
        <button type="button" className="link small" onClick={() => setMode("passkey")}>Back to passkey</button>
      </form>
    </Card>
  );
  if (mode === "join") return (
    <Card title="Join a home" lead="Enter the invitation code you were given, and your name.">
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => setCodes(await register(name.trim(), code.trim()))); }}>
        <Field label="Invitation"><Input autoFocus={fine()} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} placeholder="MAPLE-4829-KITE" autoCapitalize="characters" enterKeyHint="next" /></Field>
        <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" autoCapitalize="words" enterKeyHint="go" /></Field>
        <NoPasskeys />
        <ErrNote err={err} />
        <Button variant="primary" size="lg" loading={busy} type="submit" disabled={busy || !code.trim() || !name.trim() || !passkeysSupported()}>{busy ? "Waiting for your passkey…" : "Create passkey and join"}</Button>
        <button type="button" className="link small" onClick={() => setMode("passkey")}>Back to sign in</button>
      </form>
    </Card>
  );
  return (
    <Card title="Welcome back" lead="Sign in with the passkey on this device." center icon={<span className={cn("pk-ic", busy && "go")}><Icon n="finger" /></span>}>
      <NoPasskeys />
      <ErrNote err={err} />
      <Button variant="primary" size="lg" loading={busy} disabled={busy || !passkeysSupported()} onClick={() => void run(signIn)}><Icon n="shieldcheck" /> {busy ? "Waiting for your passkey…" : "Sign in with passkey"}</Button>
      <div className="auth-row">
        <button type="button" className="link small" onClick={() => setMode("code")}>Use a recovery code</button>
        <button type="button" className="link small" onClick={() => setMode("join")}>I have an invitation</button>
      </div>
    </Card>
  );
}

/** After a recovery code the session may only add a passkey. */
function AddPasskey() {
  const { busy, err, run } = useAction();
  return (
    <Card title="Add a new passkey" lead="You signed in with a recovery code. Add a passkey on this device to finish getting back in.">
      <ErrNote err={err} />
      <Button variant="primary" size="lg" loading={busy} disabled={busy} onClick={() => void run(async () => {
        const o = await ok(v1.auth.passkeys.options.post({}));
        const response = await startRegistration({ optionsJSON: o.options });
        await ok(v1.auth.passkeys.verify.post({ challengeId: o.challengeId, response }));
        await loadSession();
      })}>{busy ? "Waiting for your passkey…" : "Add passkey"}</Button>
      <button type="button" className="link small" onClick={() => void signOut()}>Cancel</button>
    </Card>
  );
}

/** First run for an admin: tell Alice where Home Assistant is. Tested first; nothing is saved if it fails. */
export function ConnectHa({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [url, setUrl] = useState("http://homeassistant.local:8123");
  const [token, setToken] = useState("");
  const [tested, setTested] = useState<string | null>(null);
  const [admin, setAdmin] = useState(true);
  const { busy, err, run } = useAction();
  return (
    <Card title="Connect Home Assistant" lead="Alice talks to your Home Assistant. Create a long-lived access token in Home Assistant (your profile, then Security) and paste it here. It is stored encrypted and never shown again.">
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const t = await ok(v1.ha.connection.test.post({ baseUrl: url.trim(), token: token.trim() })); setTested(`Found Home Assistant ${t.version}${t.locationName ? ` (${t.locationName})` : ""}.`); await withStepUp(() => ok(v1.ha.connection.put({ baseUrl: url.trim(), token: token.trim() }))); if (admin) await withStepUp(() => ok(v1.ha.connection["admin-token"].put({ token: token.trim() }))); onDone(); }); }}>
        <Field label="Address"><Input value={url} onChange={(e) => { setUrl(e.target.value); setTested(null); }} inputMode="url" autoComplete="off" spellCheck={false} /></Field>
        <Field label="Access token"><Input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" spellCheck={false} /></Field>
        <Checkbox checked={admin} onChange={setAdmin}>This is an administrator’s token: also let Alice add scenes and automations to Home Assistant</Checkbox>
        {tested ? <Notice tone="ok">{tested}</Notice> : null}
        <ErrNote err={err} />
        <Button variant="primary" size="lg" loading={busy} type="submit" disabled={busy || !url.trim() || token.trim().length < 10}>{busy ? "Connecting…" : "Connect"}</Button>
        <button type="button" className="link small" onClick={onSkip}>Do this later</button>
      </form>
    </Card>
  );
}

/** Scenes, routines and automations are written into Home Assistant by a separate, isolated process that needs an administrator's token. */
export function AdminToken({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [token, setToken] = useState("");
  const { busy, err, run } = useAction();
  return (
    <Card title="Let Alice add automations" lead="To put your scenes, routines and automations into Home Assistant, Alice needs a long-lived token from an administrator account. It is sealed so only a separate helper process can open it.">
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await withStepUp(() => ok(v1.ha.connection["admin-token"].put({ token: token.trim() }))); onDone(); }); }}>
        <Field label="Administrator token"><Input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" spellCheck={false} /></Field>
        <ErrNote err={err} />
        <Button variant="primary" size="lg" loading={busy} type="submit" disabled={busy || token.trim().length < 10}>{busy ? "Saving…" : "Save"}</Button>
        <button type="button" className="link small" onClick={onSkip}>Not now</button>
      </form>
    </Card>
  );
}

/** For an admin with no Home Assistant yet, shows the connect screen once; everyone else goes straight in. */
function HaGate({ children }: { children: ReactNode }) {
  const me = useAuth((s) => (s.state.status === "in" ? s.state.me : null));
  const isAdmin = me?.role === "admin";
  const [asked, setAsked] = useState<"connect" | "admin" | false | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    ok(v1.ha.connection.get()).then((c) => setAsked(!c.configured ? "connect" : !c.adminTokenSet && sessionStorage.getItem("alice-skip-admin-token") !== "1" ? "admin" : false), () => setAsked(false));
  }, [isAdmin]);
  const need = isAdmin ? asked : false;
  const done = () => setAsked(false);
  if (need === null) return <Card title="Alice" hideTitle center><Loading /></Card>;
  if (need === "connect") return <ConnectHa onDone={done} onSkip={done} />;
  if (need === "admin") return <AdminToken onDone={done} onSkip={() => { sessionStorage.setItem("alice-skip-admin-token", "1"); done(); }} />;
  return <>{children}</>;
}

/** Loads the household into the app and keeps it live, then shows the app. */
function LiveGate({ children }: { children: ReactNode }) {
  const me = useAuth((s) => (s.state.status === "in" ? s.state.me : null));
  const [ready, setReady] = useState(isLive());
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!me?.role) return;
    let off = false;
    loadHome(me.role, me.userId).then(() => { if (!off) { setReady(true); startRealtime(); } }, (e) => { if (!off) setErr((e as Error).message); });
    return () => { off = true; };
  }, [me?.role, me?.userId, n]);
  if (err) return <Card title="Couldn't load your home" lead={err}><Button onClick={() => { setErr(null); setN(n + 1); }}>Try again</Button></Card>;
  if (!ready) return <Card title="Alice" hideTitle center><Loading label="Loading your home…" /></Card>;
  return <>{children}</>;
}

/** Shows the app only to a signed-in person; otherwise the right sign-in or set-up screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useAuth((s) => s.state);
  useEffect(() => { void loadSession(); }, []);
  switch (state.status) {
    // The page is rendered here too, hidden, so the route has a real static shell (what Next's instant-navigation check
    // looks for) while the session is looked up; it shows nothing until there is data.
    case "loading": return <><Card title="Alice" hideTitle center><Loading /></Card><div hidden>{children}</div></>;
    case "offline": return <Card title="Can't reach Alice" lead={state.message}><Button onClick={() => void loadSession()}>Try again</Button></Card>;
    case "setup": return <Setup />;
    case "anon": return <SignIn />;
    case "in": return state.me.restricted ? <AddPasskey /> : <HaGate><LiveGate>{children}</LiveGate></HaGate>;
  }
}
