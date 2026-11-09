"use client";
/** Browser push: asks permission, subscribes this browser through the service worker, and tells the backend. */
import { ApiError, ok, v1 } from "./api";

const KEY = "alice-push-id";
const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toB64Url = (buf: ArrayBuffer | null) => btoa(String.fromCharCode(...new Uint8Array(buf ?? new ArrayBuffer(0)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isPushOn = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };

/** Turns push on for this browser. Throws an error with a plain message when it cannot. */
export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser can't receive push notifications.");
  const info = await ok(v1.users.me["push-subscriptions"].get());
  if (!info.platforms.includes("webpush") || !info.vapidPublicKey) throw new Error("Push isn't set up on this Alice yet. An admin needs to add the server's push keys.");
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked for this site. Allow them in the browser's site settings.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.vapidPublicKey) }));
  const r = await ok(v1.users.me["push-subscriptions"].post({ platform: "webpush", token: sub.endpoint, keys: { p256dh: toB64Url(sub.getKey("p256dh")), auth: toB64Url(sub.getKey("auth")) }, label: label() }));
  try { localStorage.setItem(KEY, r.id); } catch { /* the preference still saves */ }
}

/** Turns push off for this browser and forgets it on the server. */
export async function disablePush() {
  const id = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  try {
    if (pushSupported()) { const reg = await navigator.serviceWorker.getRegistration("/sw.js"); await (await reg?.pushManager.getSubscription())?.unsubscribe(); }
    if (id) await ok(v1.users.me["push-subscriptions"]({ id }).delete()).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) throw e; });
  } finally { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}

function label() {
  const ua = navigator.userAgent;
  return `${/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : "Browser"} on ${/Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Linux"}`;
}
