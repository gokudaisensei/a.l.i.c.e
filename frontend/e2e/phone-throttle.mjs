/** Slows the page on the phone's Chrome (debug port) so every request takes extra time, as on a slow connection or a route the dev server has not compiled yet. Stays connected for SECONDS. */
import { chromium } from "@playwright/test";
const ms = Number(process.env.LATENCY ?? 900), seconds = Number(process.env.SECONDS ?? 30);
const b = await chromium.connectOverCDP("http://localhost:9333");
const page = b.contexts()[0].pages().find((p) => p.url().startsWith("http://localhost:3001"));
if (!page) { console.log("no localhost:3001 tab"); process.exit(1); }
const cdp = await b.contexts()[0].newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: ms, downloadThroughput: -1, uploadThroughput: -1 });
console.log("throttled", ms, "ms on", page.url());
await new Promise((r) => setTimeout(r, seconds * 1000));
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
console.log("released");
await b.close();
