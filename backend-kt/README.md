# Alice backend (Kotlin/JVM)

The Kotlin rebuild of the Alice smart-home backend. It targets **wire parity**
with `backend/` (Bun + TypeScript + Elysia + Drizzle), so the existing web
frontend and the Compose/SwiftUI clients can talk to either implementation
unchanged, while fixing the gaps recorded in `backend/docs/LIMITATIONS.md`.

Status: **phase 0 — scaffold is green and running.** No domain features yet.
See [docs/PARITY.md](docs/PARITY.md) for the phase-by-phase plan and the
disposition of every known limitation, and [docs/SMART.md](docs/SMART.md) for
the interaction-level UX work that is deliberately being built alongside
parity.

## Why this stack

| Choice | Reason |
|---|---|
| Kotlin/JVM 21, Gradle 8.14.4 | Mature runtime, real concurrency, JCE/BouncyCastle for WebAuthn and encrypted secrets, `java.time`, `java.util.zip`, MockK/testApplication |
| GraalVM-ready, JIT first | Native images later; the code stays reflection-light so `native-image` is an option, not a rewrite |
| Ktor 3.6 (server, client, WebSockets) | One HTTP/WS stack for the server and the Home Assistant gateway |
| kotlinx-coroutines + kotlinx-serialization | Structured concurrency and a compile-time JSON contract; no runtime reflection on the wire |
| Koin 4.2 | Small DI container, easy per-test modules |
| SQLDelight 2.4 | Typed SQL with generated queries; SQLite file stays a plain database |
| Hoplite 3 | Typed config with environment overrides and usable defaults |

The point of Kotlin over a transliteration is the **shared client library**
(`alice-client`) that will own reconnect, optimistic commands, undo and the
offline queue for both mobile clients, plus a runtime that lets the backend
fix the concurrency-related limitations the Bun version accepted.

## Layout

```
backend-kt/
├── core/     foundation: config, ids, errors, events, database, DI
├── ha/       the only Home Assistant seam (REST + WebSocket behind one interface)
├── server/   Ktor application: HTTP routes, /ws hub, domain modules
├── worker/   config-worker: holds the admin-seal private key, applies HA changes
├── docs/     PARITY.md, SMART.md, LIMITATIONS.md
└── data/     runtime SQLite file (git-ignored)
```

Dependency rule (mirrors the TypeScript backend): `core ← ha ← server`, and
`core ← worker`. Nothing outside `ha/` may speak the Home Assistant protocol.

## Requirements

- JDK 21 on `PATH` (`java -version`; the project does not require `JAVA_HOME`)
- No local Gradle: the wrapper pins 8.14.4

## Commands

```bash
cd backend-kt

./gradlew build                 # compile + tests for all modules
./gradlew test                  # tests only
./gradlew :server:run           # http://127.0.0.1:3002
./gradlew :worker:run           # config-worker stub
curl -s localhost:3002/health   # {"status":"ok","uptime":1.23}
```

`run` executes with the repository root as its working directory, so the
server and worker open the same `backend-kt/data/alice.db` file. The packaged
distributions use the launch directory instead.

## Configuration

Every setting has a working default, so a fresh checkout boots with no
configuration. Environment variables override them (`SERVER_PORT`,
`DATABASE_PATH`, `APP_NAME`, `APP_VERSION`). A future `application.yaml` in the
working directory is picked up automatically by Hoplite.

| Variable | Default | Meaning |
|---|---|---|
| `SERVER_HOST` | `0.0.0.0` | bind address |
| `SERVER_PORT` | `3002` | HTTP port (same as the TS backend) |
| `DATABASE_PATH` | `data/alice.db` | SQLite file shared with the worker; `:memory:` in tests |

## Wire contract

Kept byte-for-byte where clients depend on it:

```json
GET /health  ->  200 {"status":"ok","uptime":0.85}
error        ->  {"error":{"code":"not_found","message":"Not found"}}
```

Rules that apply to every later phase:

- `/api/v1` prefix for domain routes; `/health` and `/auth/*` public.
- Error codes are `snake_case`; `details` is optional and never contains raw
  Home Assistant text.
- Timestamps are unix milliseconds; ids are type-prefixed ULIDs (`usr_…`).
- JSON omits `null` fields and includes defaults.

## Database

SQLDelight opens SQLite with `foreign_keys=ON`, `busy_timeout=5000` and WAL for
file databases. The schema starts from the TypeScript backend's `0013` state
(the current shape, not a replay of its migration history); migrations are
append-only from phase 1 onward. The Kotlin backend uses a **fresh database** —
there is no dual-write or data migration. The TypeScript backend remains the
reference implementation and the oracle for contract tests during the cutover.

## Current phase-0 surface

- `GET /health` (public, exact TS shape)
- uniform 404/500 error envelope
- SQLite foundation: `application_settings`, `audit_log`, `jobs`, `rate_limits`
- monotonic ULIDs, in-process event bus behind an interface
- worker process that opens the same database and idles
- tests: config defaults, database round-trip, health, 404 envelope

Everything else is planned in [docs/PARITY.md](docs/PARITY.md).
