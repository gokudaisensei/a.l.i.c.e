// Local fake services (runbook §5.4): signed-manifest server, push sink, LLM provider, latency proxy.
// No real push/Firebase/LLM calls ever leave this machine. Implemented incrementally across M5/M7;
// the manifest/push/LLM endpoints are usable from M1 for wiring.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PORTS } from "./constants.ts";

export interface FakeServiceHandles {
  manifest: { stop(): void };
  push: { stop(): void; requests: unknown[] };
  llm: { stop(): void; requests: unknown[] };
  latency?: { stop(): void };
}

export interface FakeServiceOptions {
  runDir: string;
  /** Point the latency proxy at this HA port (default HA-B 18124). */
  latencyTargetPort?: number;
  latencyDelayMs?: number;
}

function dirFor(runDir: string): string {
  const d = join(runDir, "fake");
  mkdirSync(d, { recursive: true });
  return d;
}

export function startFakeServices(opts: FakeServiceOptions): FakeServiceHandles {
  const fakeDir = dirFor(opts.runDir);
  const pushLog = join(fakeDir, "push.jsonl");
  appendFileSync(pushLog, "");

  const defaultManifest = {
    version: "0.0.1",
    notes: "parity harness default manifest (unsigned)",
    publishedAt: new Date().toISOString(),
    artifactSha256: "0".repeat(64),
    signature: null,
  };

  const manifest = Bun.serve({
    port: PORTS.fakeManifest,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/manifest.json" || url.pathname === "/") {
        const file = join(fakeDir, "manifest.json");
        const body = existsSync(file) ? readFileSync(file, "utf8") : JSON.stringify(defaultManifest);
        return new Response(body, { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const pushRequests: unknown[] = [];
  const push = Bun.serve({
    port: PORTS.fakePush,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = await req.text();
      const entry = {
        at: new Date().toISOString(),
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      };
      pushRequests.push(entry);
      appendFileSync(pushLog, JSON.stringify(entry) + "\n");
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });

  const llmRequests: unknown[] = [];
  const llm = Bun.serve({
    port: PORTS.fakeLlm,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = await req.text();
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body);
      } catch {}
      const entry = { at: new Date().toISOString(), url: req.url, headers: Object.fromEntries(req.headers.entries()), body: parsed };
      llmRequests.push(entry);
      appendFileSync(join(fakeDir, "llm.jsonl"), JSON.stringify(entry) + "\n");
      // Anthropic Messages shape with a forced tool call, overridable by fake/llm-response.json.
      const override = join(fakeDir, "llm-response.json");
      if (existsSync(override)) {
        return new Response(readFileSync(override, "utf8"), { headers: { "content-type": "application/json" } });
      }
      const response = {
        id: "msg_fake",
        type: "message",
        role: "assistant",
        model: "fake",
        content: [
          {
            type: "tool_use",
            id: "toolu_fake",
            name: "propose_actions",
            input: { proposals: [] },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    },
  });

  let latency: { stop(): void } | undefined;
  if (opts.latencyTargetPort && opts.latencyDelayMs) {
    latency = startLatencyProxy(PORTS.fakeLatency, opts.latencyTargetPort, opts.latencyDelayMs);
  }

  return {
    manifest: { stop: () => manifest.stop(true) },
    push: { stop: () => push.stop(true), requests: pushRequests },
    llm: { stop: () => llm.stop(true), requests: llmRequests },
    latency,
  };
}

/** A TCP proxy that delays every chunk by `delayMs` (chaos: a slow Home Assistant). */
export function startLatencyProxy(port: number, targetPort: number, delayMs: number): { stop(): void } {
  const targets = new Map<unknown, any>();
  const pending = new Map<unknown, Uint8Array[]>();
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port,
    socket: {
      async open(socket) {
        pending.set(socket, []);
        const upstream = await Bun.connect({
          hostname: "127.0.0.1",
          port: targetPort,
          socket: {
            data(_up, data) {
              setTimeout(() => socket.write(data), delayMs);
            },
            close() {
              socket.end();
            },
            error() {
              socket.end();
            },
          },
        });
        targets.set(socket, upstream);
        // The client's first bytes (a WebSocket handshake, usually) can arrive while the upstream
        // connection is still opening; replay them once it is ready.
        for (const chunk of pending.get(socket) ?? []) upstream.write(chunk);
        pending.delete(socket);
      },
      data(socket, data) {
        const up = targets.get(socket);
        if (up) setTimeout(() => up.write(data), delayMs);
        else pending.get(socket)?.push(data);
      },
      close(socket) {
        targets.get(socket)?.end();
        targets.delete(socket);
        pending.delete(socket);
      },
      error(socket) {
        targets.get(socket)?.end();
        targets.delete(socket);
        pending.delete(socket);
      },
    },
  });
  return { stop: () => server.stop(true) };
}

if (import.meta.main) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("usage: bun env/fake-services.ts [--run-dir <path>]\n\nStarts the local fake manifest (:3190), push (:3191) and LLM (:3192) services and blocks.");
    process.exit(0);
  }
  const runDirArg = process.argv.indexOf("--run-dir");
  const runDir = runDirArg >= 0 ? process.argv[runDirArg + 1]! : join(import.meta.dir, "..", ".runs", "fake");
  const handles = startFakeServices({ runDir });
  console.log(`fake services up: manifest :${PORTS.fakeManifest}, push :${PORTS.fakePush}, llm :${PORTS.fakeLlm}`);
  const shutdown = () => {
    handles.manifest.stop();
    handles.push.stop();
    handles.llm.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}
