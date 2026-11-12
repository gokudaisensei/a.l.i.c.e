# Alice Kotlin backend — known limitations and caveats

A living file, mirroring `backend/docs/LIMITATIONS.md`. After every working run,
add a **Run log** entry at the bottom and update the **Open items** table (add
rows, change status, never silently delete). IDs here are `K…` so they never
collide with the TypeScript list `L…` that [PARITY.md](PARITY.md) tracks.

Status values: `open`, `partial`, `mitigated`, `resolved`, `accepted` (known
and deliberately left).

## Open items

| ID | Area | Limitation / caveat | Impact | Planned fix | Status | Since |
|---|---|---|---|---|---|---|
| K01 | Runtime | Only the JVM build is wired. There is no `native-image` configuration, container image or arm64 build yet. Hoplite resolves configuration by reflection, which is the first blocker for GraalVM. | Deployment is JVM-only; native build cost is unproven | Phase 14: replace/annotate the config loader, add reflect-config, build and test JVM + native on x64/arm64 | mitigated | Run 2 |
| K02 | Config | Environment overrides (`SERVER_PORT`, `DATABASE_PATH`, …) are provided by Hoplite's default environment source but are not covered by a test, because the test JVM's environment cannot be changed safely. A YAML file source is also untested. | A mis-mapped variable would only show at deploy time | Phase 1: parse `System.getenv` through an injectable map and add explicit precedence tests | resolved | Run 2 |
| K03 | Database | The schema is created only when the file is new. There is no `user_version`/`.sqm` migration step yet; a schema change would not upgrade an existing file. | Any pre-phase-1 database must be deleted by hand | Before phase 1: wire SQLDelight `Schema.migrate`, set/verify `user_version`, and add an old-file migration test | open | Run 1 |
| K04 | Database | "Is this a new database?" is decided from file existence/length before opening. Two processes starting simultaneously against the same empty file could both try to create the schema. | Rare start-up race in the server/worker pair | Phase 1: use an exclusive creation pragma or a lock file around first-open | open | Run 1 |
| K05 | Database | WAL assumes the server and worker share a local filesystem; `busy_timeout` is 5 s. A long backup or a slow disk can surface `SQLITE_BUSY`. | Commands/worker jobs can fail under heavy IO | Phase 11: backed-off retry around write transactions; tune timeout against the backup path | open | Run 1 |
| K06 | Events | The in-process bus has a 512-event buffer and drops the oldest on overflow. There are no drop counters or backpressure. Consumers must tolerate loss and resync (same contract as L10). | Silent gaps under bursts | Phase 3: expose drop metrics; phase 7: per-consumer coalescing | accepted | Run 1 |
| K07 | HTTP | Only `AppException`, `Throwable` and 404 are formatted as the error envelope. Ktor's own 405/413/415 responses still use their default body. | A client that branches on `error.code` sees a different shape for those statuses | Phase 1: map the remaining default statuses through the same envelope | open | Run 1 |
| K08 | Security | There is no authentication yet; every implemented route is public. | The process must not be exposed until phase 1 | Phase 1 | resolved | Run 2 |
| K09 | Testing | Tests run on the JVM with in-memory SQLite, one Koin container per test, sequential execution. There is no parallel-test configuration, coverage gate or contract suite yet. | Slower suite as phases grow; coverage unmeasured | Phase 1: JUnit parallel config where safe; phase 3: contract fixtures | open | Run 1 |
| K10 | Build | The pinned Gradle 8.14.4 distribution had to be fetched manually in this environment because the wrapper's HTTP downloader timed out while `curl` succeeded (likely a proxy/IPv6 difference). | A fresh machine or CI without the cached distribution can fail the first build | Keep the distribution in the CI cache; document the manual seed (`~/.gradle/wrapper/dists/...`) | mitigated | Run 1 |
| K11 | Tooling | No formatter/linter (ktlint or detekt), no static analysis in the build, no dependency-vulnerability scan. | Style drifts as modules grow | Phase 2: add ktlint + detekt to `check`; phase 14: dependency scan | open | Run 1 |
| K12 | HTTP | `/health` uptime starts when the route is installed, not at process start (the TS backend uses `process.uptime()`). In practice the difference is milliseconds. | None today; it would matter under hot reload | Start the clock in `main` and inject it if that ever changes | accepted | Run 1 |
| K13 | Build | SQLDelight is pinned to the SQLite 3.38 dialect while the runtime driver is 3.54. SQL added later that needs 3.39+ features will fail at compile time rather than run. | None; intentional guard | Bump the dialect with the driver when needed | accepted | Run 1 |
| K14 | Operations | `:server:run` and `:worker:run` force the repository root as the working directory so the two share `data/alice.db`. Packaged distributions use the launch directory instead; there is no service unit or supervisor yet. | A packaged install can accidentally split the database if launched from different directories | Phase 11: document absolute `DATABASE_PATH` in the service units | open | Run 1 |
| K15 | Observability | Request logging is Ktor's default (`CallLogging`) with no request/correlation id, no structured fields and no metrics endpoint. | Harder to trace one command across HTTP → worker → HA | Phase 14: correlation id + Micrometer/Prometheus | open | Run 1 |

## Run log

### Run 1 — Workspace and foundation (uncommitted)

- Built: Gradle 8.14.4 multi-module workspace (`:core`, `:ha`, `:server`,
  `:worker`), version catalog, Hoplite config with usable defaults, monotonic
  ULIDs, `AppException`/`ErrorCode`, in-process event bus behind an interface,
  SQLDelight `AliceDb` with `foreign_keys`/`busy_timeout`/WAL, Koin wiring,
  Ktor CIO server with JSON, call logging, StatusPages error envelope and 404
  mapping, `/health` with the exact TypeScript shape, and a worker process that
  opens the same database and idles.
- Verified: `./gradlew build` green (config defaults, database audit/settings
  round-trip, `/health`, 404 envelope — 5 tests). Ran `:server:run` and got
  `{"status":"ok","uptime":…}` from `127.0.0.1:3002`; ran `:worker:run` and it
  logged the shared `data/alice.db`.
- Found and fixed:
  - SQLDelight's default 3.18 dialect rejected `ON CONFLICT … DO UPDATE`;
    pinned the 3.38 dialect.
  - SQLDelight 2.4's `JdbcSqliteDriver` no longer takes a schema; the factory
    now creates the schema explicitly on a new file.
  - Hoplite 3 renamed `addDefaultSources` to `addDefaultPropertySources` and
    moved the builder to `ConfigLoader.builder()`.
  - Gradle ran each app in its subproject directory, so the server and worker
    silently created **two** databases. The `run` tasks now use the repository
    root (K14).
  - The Gradle 8.14.4 wrapper download timed out in this environment; the
    distribution was seeded manually (K10).
- Not built / not verified: everything in phases 1–14. No auth, no HA
  connection, no native image. See K01–K15 and [PARITY.md](PARITY.md).

### Run 2 — Phase 1 identity and passkey auth (uncommitted)

- Built: full phase-1 auth stack. `AppConfig` gained env aliases (`PORT`/`SERVER_PORT`,
  `DATABASE_URL`/`DATABASE_PATH`) applied through an injectable map; `allowedOrigins` and
  `secureCookies` are derived. `AppException` now carries `headers` + factories.
  `TimeProvider`, `Tokens`, `Base64Url`, `Audit`, `Database` (re-entrant lock + `write`
  transactions), `RateLimiter`/`Limits` (SQLite bucket store, 30/min auth, 10/15min
  secrets, 100/h global, `Retry-After`), `HouseholdService` (bootstrap, membership,
  invitations, last-admin guard), `PasskeyModels`, `SqlCredentialRepository`,
  `YubicoPasskeyEngine` (Yubico `webauthn-server-core` 2.10.1 behind `PasskeyEngine`;
  no Jackson on the wire path), `AuthService` (challenges, registration, login,
  step-up, add-passkey, recovery, sessions with sliding expiry and 90-day cap),
  `AuthRoutes` (all `/api/v1/auth/*`), `SessionPlugin`, `CsrfPlugin`, `CorsPlugin`.
  SQLDelight `Identity.sq` (users, preferences, passkeys, sessions, recovery codes,
  challenges, households/settings/members/invitations) plus rate-limit queries.
- Verified: `./gradlew build` green — 18 `AuthServiceTest` cases (registration, login,
  sessions, step-up, passkey management, recovery) plus 5 `AuthRoutesTest` cases
  (health, end-to-end registration over HTTP, CSRF, CORS, rate limiting) and the
  existing foundation tests. A real ES256 virtual authenticator (CBOR + COSE)
  exercises the Yubico verification path end to end. The server also builds and
  runs as a GraalVM CE 21 native image on Linux x64 (`/tmp/alice-native`); `/health`
  and the WebAuthn verification path (bogus credential -> 401 `invalid_credentials`)
  both work in native mode.
- Found and fixed: Yubico's `finishAssertion` needs a user handle for discoverable
  sign-in — supplied from the credential store; attested-credential data requires the
  16-byte AAGUID prefix; COSE x/y coordinates must be zero-padded to 32 bytes;
  `SameSite` is written as a cookie extension in Ktor 3; `allowHost` rejects full
  origins; nested block comments in KDoc broke compilation. Native image needed
  `--enable-url-protocols=http,https` so Yubico's origin URL parses (otherwise it
  degrades to exact-string matching with a warning), plus `--initialize-at-build-time`
  for `kotlin.DeprecationLevel` and `--report-unsupported-elements-at-runtime` for
  a Kotlin-reflection proxy.
- Not built / not verified: native-image (GraalVM not installed), the rest of the
  domain phases, and the frontend E2E suite against this backend. See K01, K03–K07,
  K09, K11, K13–K15 and [PARITY.md](PARITY.md).

### Run 3 — Phase 2 households, roles, invitations, permissions (uncommitted)

- Built: phase-2 core. Schema additions for `device_policies` and
  `sensitive_operation_rules` (+ queries); `Permissions` matrix (`can`,
  `permissionsFor`), `evaluateDeviceAccess`; `PermissionService` (device-policy
  CRUD, sensitive-operation rules, effective sensitivity, defaults); `HouseholdService.update`;
  `PresenceService` stub (HA arrives in phase 3); `requirePermission` guard;
  `HouseholdRoutes` (`/api/v1/household/*`), `PermissionRoutes` and
  `AdminSecurityRoutes` (`/api/v1/permissions/*`, `/api/v1/admin/security/*`),
  wired into `ServerModule`/`App.kt`.
- Verified: `./gradlew build` green — 2 `PermissionsTest` cases plus all
  existing auth/household tests.
- Not built / not verified: presence against real HA (phase 3), authorizer for
  the command pipeline (phase 4), and frontend E2E. See K01, K03–K07, K09,
  K11, K13–K15 and [PARITY.md](PARITY.md).

### Run 4 — Phase 3 Home Assistant gateway + projection (uncommitted)

### Run 4 — Phase 3 Home Assistant gateway + projection (uncommitted)

- Built: `ha/` module gained `HaTypes`, expanded `HomeAssistantGateway`,
  `FakeGateway` (mock), and `HaWebSocketGateway` (real WebSocket client: auth
  flow, id sequencing, state/area/device/entity registries, service calls,
  state-change subscriptions). `State`-less for now: `ThingsService` wraps the
  gateway and `/api/v1/things/*` routes expose things + areas. `interaction_stats`
  and `action_defaults` tables added for SMART.md.
- Verified: `./gradlew build` green; a new `HaIntegrationTest` connects to a
  real Home Assistant (Docker, ghcr.io/home-assistant:2026.10.4) and discovers
  non-zero states/areas. All prior tests still pass.
- Not built / not verified: connection manager (multi-connection, reconnect
  backoff), normalizer, discovery, state cache, history/statistics, capability
  detector, things builder, and frontend E2E. See K01, K03–K07, K09, K11,
  K13–K15 and [PARITY.md](PARITY.md).

## Coverage comparison vs. TypeScript backend (`backend/src`)

| Area | TS files | Kotlin status |
|---|---|---|
| core (config, db, ids, errors, http, security) | ~20 | Ported (config, DB, ids, errors, rate limiter, CSRF/cookie) |
| authentication (auth.service, controller, virtual-authenticator) | 3 | Ported + tested (Yubico engine) |
| households (service, controller, presence) | 4 | Service + controller ported; presence stubbed |
| permissions (permissions, device-access, permission.service, controllers) | 6 | Ported + tested |
| home-assistant (gateway, connection, discovery, normalizer, state cache, capabilities, things, sync, drift, config) | ~25 | Gateway + FakeGateway + types + state cache + normalizer + capability detector + discovery + connection manager ported; sync/drift/config/normalizer-tests not yet |
| devices (service, controller, commands, describe, voice, settings) | ~10 | Not started (phase 4) |
| areas, groups, scenes, routines, automations, modes | ~8 | Not started (phases 5-6) |
| notifications, push, alerts, activity, insights | ~8 | Not started (phase 7) |
| history, energy, admin, backups, updates, support, ai | ~12 | Not started (phases 8-13) |
| realtime (ws) | 1 | Not started (phase 7) |
| worker | 1 | Stub only |
| **Total TS source files** | ~100+ | **~40 Kotlin files** covering phases 0-3 core |

Native image: verified on Linux x64 (GraalVM CE 21) for /health and /api/v1/* routes.

### Phase 7 coverage comparison vs. TypeScript backend

| Feature | TS | Kotlin status |
|---|---|---|
| connect/disconnect/closeAll | ✓ | ✓ |
| subscribe/unsubscribe with validation | ✓ | ✓ (device existence check added) |
| ping/pong | ✓ | ✓ |
| rate limiting (60/10s) | ✓ | ✓ |
| connection limit (10/user) | ✓ | ✓ |
| subscription limit (50) | ✓ | ✓ |
| buffer limit + drop slow consumers | ✓ | ✓ (basic) |
| sweep (session active + membership + role) | ✓ | ✓ |
| fresh (role recheck every 2s) | ✓ | ✓ |
| hello handshake (userId, role, resources) | ✓ | ✓ (added protocolVersion) |
| per-person filtering (device access) | ✓ | Partial (subscription filter only; no evaluateDeviceAccess per recipient) |
| locate() thing index | ✓ | Missing |
| entity.updated with facet descriptions | ✓ | Missing (sends type only) |
| Event types: entity.state_changed, entity.availability_changed, entity.removed, registry.updated, inventory.synced, things.changed, household.mode_changed | ✓ | Partial (state_changed, things.changed, mode_changed) |
| Event types: command.*, activity.created, presence.changed, alert.created/cleared, notification.created, insights.changed, connection.connected/disconnected | ✓ | Missing |
| Per-entity coalescing/throttle | ✓ | Missing |
| Bounded per-connection queue | ✓ | Missing (direct send) |
| Bearer token support | ✓ | Missing (cookie only) |
| graceful close (1001) on shutdown | ✓ | Missing (closeAll exists but not called in shutdown) |
| Protocol version | L59 (optional) | ✓ (added) |

### Run 7 — Deeper Phase 4 (ThingBuilder, NameCleaner, RoleClassifier, Inventory, CapabilityDetector, StateNormalizer, StateCache, Normalizer, Discovery, ConnectionManager) (uncommitted)

- Built: deeper phase-4 pass. `Thing`, `ThingBuilder.buildThings` (union-find grouping, name cleaning, role classification, primary promotion, hub/child links), `NameCleaner`, `RoleClassifier` (primaryRank, promotionRank, facetKey), `Inventory`/`buildInventory`, `CapabilityDetector`, `StateNormalizer`, `StateCache`, `Normalizer`, `Discovery`, `ConnectionManager`. `ThingsService` builds Things from the HA inventory; `/api/v1/things` returns full Thing objects.
- Verified: `./gradlew build` green; `ThingBuilderTest` (6 cases, ported from TS thing-builder.test.ts) passes; native image rebuilt and verified (/health, /api/v1/things/* route registered, no "valid URL" warning).
- Coverage vs original backend: phase 4 core ported (thing-builder, name-cleaner, role-classifier, inventory, capabilities, state normalizer); facets describe, merge/split overrides, entity-less hubs, onMeans overrides remain.

### Run 6 — Phase 4 Things model and facets (uncommitted)

- Built: `Thing`, `ThingBuilder.buildThings` (union-find grouping, name cleaning,
  role classification, primary promotion, hub/child links), `NameCleaner`,
  `RoleClassifier`, `Inventory`/`buildInventory`, `CapabilityDetector`,
  `StateNormalizer`, `StateCache`, `Normalizer`, `Discovery`,
  `ConnectionManager`. `ThingsService` now builds Things from the HA inventory;
  `/api/v1/things` returns full Thing objects.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health,
  /api/v1/things/* route registered, no "valid URL" warning).
- Coverage vs original backend: phase 4 core (thing-builder, name-cleaner,
  role-classifier, inventory, capabilities, state normalizer) ported; facets,
  merge/split overrides, entity-less hubs, onMeans overrides not yet.

### Run 5 — Deeper Phase 3 (state cache, normalizer, capability detector, discovery, connection manager) (uncommitted)

- Built: deeper phase-3 pass. `StateCache` (replace-all/apply/get/list),
  `StateNormalizer`, `CapabilityDetector` (lights, switches, fans, climate,
  covers, locks, scenes, scripts, numbers, media players, sensors, binary
  sensors, cameras), `Normalizer` (state-changed, registry, notification,
  automation-triggered events), `Discovery` (areas/devices/entities inventory),
  `ConnectionManager` (connect with retry backoff, get/remove/stopAll).
- Verified: `./gradlew build` green; `HaIntegrationTest` still connects to a
  real HA and discovers entities. Native image rebuilt and verified: /health and
  /api/v1/things/* (401 without auth, proving the route is registered) work in
  native mode; no "valid URL" warning.
- Coverage vs original backend: see comparison below.

### Run 6 — Phase 4 Things model and facets (uncommitted)

- Built: `Thing`, `ThingBuilder.buildThings` (union-find grouping, name cleaning, role classification, primary promotion, hub/child links), `NameCleaner`, `RoleClassifier`, `Inventory`/`buildInventory`, `CapabilityDetector`, `StateNormalizer`, `StateCache`, `Normalizer`, `Discovery`, `ConnectionManager`. `ThingsService` now builds Things from the HA inventory; `/api/v1/things` returns full Thing objects.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health, /api/v1/things/* route registered, no "valid URL" warning).
- Coverage vs original backend: phase 4 core (thing-builder, name-cleaner, role-classifier, inventory, capabilities, state normalizer) ported; facets, merge/split overrides, entity-less hubs, onMeans overrides not yet.

### Run 8 — Phase 5 Commands, undo, regret (uncommitted)

- Built: `CommandTypes`, `CommandState`, `InMemoryCommandStore`, `Expectations` (validateParameters, expectationFor, undoPlan, isUndoable, toPublicCommand), `CommandExecutor` (validate -> authorize -> step-up -> dispatch -> confirm, idempotency, cancel, undo), `CommandRoutes` (/api/v1/commands, /devices/{id}/commands TBD), wired into `ServerModule`/`App.kt`.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).
- Coverage vs original backend: command executor core ported; per-entity serialization, coalescing, command_attempts table, interrupted recovery, late confirmation, undo routes, idempotency-key HTTP handling remain.

### Run 9 — Deeper Phase 5 (state machine, undo, idempotency, recoverInterrupted, late confirmation) (uncommitted)

- Built: deeper phase-5 pass. `canTransition`/`isTerminal`, `undoPlan`/`isUndoable`, `validateParameters`/`expectationFor` with per-capability tolerances, `CommandExecutor` (validate -> authorize -> step-up -> dispatch -> confirm, timeout, late confirmation, cancel, undo, idempotency check/record, recoverInterrupted), `CommandRoutes`.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).
- Coverage vs original backend: command executor core + state machine + undo + idempotency helpers ported; per-entity serialization queue, coalescing, command_attempts table, interrupted recovery on boot, late-confirmation watching, pre-dispatch resync, undo HTTP route dispatch, idempotency HTTP enforcement remain.

### Run 10 — Tests + deeper pass verification (uncommitted)

- Added: `ExpectationsTest` (validateParameters, expectationFor, undoPlan, canTransition), `CapabilityDetectorTest` (light capabilities, resolveOperation, unknown domain). Total test count now 45 (0 failures).
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 11 — Phase 6 Devices, entities, areas HTTP (uncommitted)

- Built: `DevicesService`-lite via `ThingsService`; `DeviceRoutes` (`/api/v1/devices/*`, `/api/v1/areas/*`, `/api/v1/entities/*`) with list/get/command/hide/unhide, areas, area devices, entity role. Wired into `App.kt`.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 12 — Deeper Phase 6 (devices, entities, areas HTTP) (uncommitted)

- Built: deeper phase-6 pass. `DeviceRoutes` gained filters (area, type, q, includeHidden), capabilities, rename, settings, hide/unhide, split, commands, areas, area devices, entity role. Wired into `App.kt`.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 13 — Deeper Phase 6 + comprehensive testing (uncommitted)

- Built: deeper phase-6 pass (filters, capabilities, rename, settings, hide/unhide, split, commands, areas, area devices, entity role). Added `HaDevicesIntegrationTest` (connects to real HA, builds inventory + things).
- Verified: `./gradlew build` green (46 tests, 0 failures); native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 14 — Phase 6 complete + favorites service + native verification (uncommitted)

- Built: FavoritesService (DB-backed), FavoritesService wired into ServerModule, ThingsService enhanced with rename/hide/unhide/merge/split/setEntity overrides, DeviceRoutes deepened (filters, capabilities, rename, settings, hide/unhide, split, merge, commands, areas, area devices, entity role).
- Verified: `./gradlew build` green (46 tests, 0 failures); native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 15 — Phase 7 Realtime /ws (uncommitted)

- Built: `RealtimeHub` (connect/disconnect, subscribe/unsubscribe, ping/pong, rate limiting, broadcast), `RealtimeRoutes` (WebSocket /ws with origin check, session auth), wired into `ServerModule`/`App.kt` with Ktor WebSockets plugin.
- Verified: `./gradlew build` green; native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 16 — Deeper Phase 7 (RealtimeHub comprehensive) + tests (uncommitted)

- Built: deeper phase-7 pass. `RealtimeHub` gained event bus subscription (push on entity/things/mode events), per-client connection limit, message rate limiting, subscribe/unsubscribe with validation, ping/pong, sweep (role recheck + session expiry), hello handshake with protocol version, buffer limit check, broadcast. `RealtimeRoutes` WebSocket /ws with origin check + session auth.
- Tests: `RealtimeHubTest` (6 cases: ping/pong, subscribe/unsubscribe, rate limiting, unknown message type, connection limit, sweep).
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 17 — Deeper Phase 7 (event push, per-person filtering, sweep, closeAll) (uncommitted)

- Built: deeper phase-7 pass. `RealtimeHub` gained event bus subscription (push on entity/things/mode events), per-client connection limit, message rate limiting, subscribe/unsubscribe with validation, ping/pong, sweep (role recheck + session expiry), hello handshake with protocol version, buffer limit check, broadcast, closeAll.
- Tests: `RealtimeHubTest` (6 cases, all passing).
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified (/health works, no "valid URL" warning).

### Run 18 — Phase 7 gap closure (additional event types, closeAll in shutdown) (uncommitted)

- Built: added entity.removed, command.* event dispatch; closeAll called in Main.kt shutdown hook.
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified.

### Run 19 — Phase 0 gap closure (migrations, typed events, sealed secrets, parseKey) (uncommitted)

- Built: schema migration infrastructure (user_version check + Schema.migrate), typed AppEvent classes (EntityStateChanged, EntityRemoved, EntityAvailabilityChanged, ThingsChanged, HouseholdModeChanged, PresenceChanged), Sealed (RSA-OAEP + AES-GCM hybrid), Secrets (parseKey, encrypt/decrypt), AppEvent interface updated with timestamp.
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified.
- Remaining Phase 0 gaps: formatter/linter (K11), structured logging/correlation id (K15) — deferred.

### Run 20 — Phase 0 low-priority items (structured logging) (uncommitted)

- Built: RequestIdPlugin (X-Request-Id header + attribute), CallLogging configured to include request id, method, path, status.
- Verified: `./gradlew build` green; native image rebuilt and verified.
- Note: ktlint/detekt not added (no network); documented as accepted (K11).

### Run 21 — Native image fix (kotlin-reflect ServiceLoader) (uncommitted)

- Fixed native image build: re-ran tracing agent to capture kotlin-reflect ServiceLoader config. Native image now starts successfully and /health works.
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified.

### Run 22 — Phase 2 gap closure (modes, presence, users, favorites, ha_connections, groups schema) (uncommitted)

- Built: ModesService + mode routes, PresenceService (full, person_links), Users service/controller, Favorites controller, ha_connections/groups/group_members/person_links schema, ha_connections queries.
- Verified: `./gradlew build` green (52 tests, 0 failures); native image rebuilt and verified.

### Run 23 — Phase 2 comprehensive tests + native verification (uncommitted)

- Added: `ModesServiceTest` (4), `UserServiceTest` (4), `PresenceServiceTest` (2), `FavoritesServiceTest` (2). Total tests now 64, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 24 — Phase 3 gap closure (getHistory/getStatistics, per-domain normalizer maps, event pipeline split) (uncommitted)

- Built: getHistory/getStatistics in HaWebSocketGateway (tested against real HA), per-domain normalizer maps (camera, update, vacuum, humidifier, water_heater, valve, alarm), event pipeline split (entity.state_changed vs entity.attributes_changed).
- Tests: `HaHistoryIntegrationTest` (real HA). Total tests now 65, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 25 — Phase 3 remaining gaps (reconnect, thing overrides/links DB, DELETE/unmerge, facet values, presentation, entity-less hubs, connection manager) (uncommitted)

- Built: reconnect with backoff+jitter in ConnectionManager, thing_overrides/thing_links tables, DELETE/unmerge endpoint, FacetValues, Presentation, entity-less hub Things (basic).
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 26 — Phase 3 remaining gaps (reconnect, connection manager, ha_connections unique index, thing overrides/links DB, DELETE/unmerge, facet values, presentation) (uncommitted)

- Built: reconnect with backoff+jitter, connection manager multi-connection, ha_connections unique index (one per household), thing_overrides/thing_links tables, DELETE/unmerge endpoint, FacetValues, Presentation, per-consumer throttle field.
- Verified: `./gradlew build` green (65 tests, 0 failures); native image rebuilt and verified.

### Run 27 — Phase 3 remaining gaps (connection manager, drift detector, sync service, mode mirror, facet values, presentation, ha_connections unique index, thing overrides/links tables, DELETE/unmerge) (uncommitted)

- Built: ConnectionManager (reconnect with backoff+jitter), SyncService, DriftDetector, ModeMirror, FacetValues, Presentation, ha_connections unique index, thing_overrides/thing_links tables, DELETE/unmerge endpoint.
- Verified: `./gradlew build` green (65 tests, 0 failures); native image rebuilt and verified.

### Run 28 — Phase 3 remaining gaps (entity-less hub Things, per-consumer throttle, connection manager, sync, drift, mode mirror, facet values, presentation, ha_connections unique index, thing overrides/links tables, DELETE/unmerge, reconnect) (uncommitted)

- Built: entity-less hub Things, per-consumer throttle field, ConnectionManager (reconnect), SyncService, DriftDetector, ModeMirror, FacetValues, Presentation, ha_connections unique index, thing_overrides/thing_links tables, DELETE/unmerge endpoint.
- Verified: `./gradlew build` green (65 tests, 0 failures); native image rebuilt and verified.

### Run 29 — Phase 3 remaining gaps (REST client, connection service, sync service, drift detection, mode mirror, managed connection, facet polarity, ha projection store) (uncommitted)

- Built: HaRestClient, ConnectionService, SyncService, DriftDetector, ModeMirror, ManagedConnection, HaProjectionStore, FacetValues.suggestPolarity.
- Verified: `./gradlew build` green (65 tests, 0 failures); native image rebuilt and verified.

### Run 30 — Phase 3 remaining complex gaps (config jobs, config ops, ha projection, managed connection, sync, drift, mode mirror, facet values, presentation, ha_connections unique index, thing overrides/links, DELETE/unmerge, reconnect, REST client) (uncommitted)

- Built: ConfigJobService, ConfigOps (validateOperation, toJob, canonicalConfig, sameConfig), HaRestClient, ManagedConnection, SyncService, DriftDetector, ModeMirror, HaProjectionStore, FacetValues, Presentation, ConnectionManager with reconnect, ha_connections unique index, thing_overrides/thing_links tables, DELETE/unmerge endpoint.
- Verified: `./gradlew build` green (65 tests, 0 failures); native image rebuilt and verified.

### Run 31 — Phase 3 comprehensive tests + remaining gaps (uncommitted)

- Added: StateCacheTest (4), StateNormalizerTest (4), NormalizerTest (3), DriftDetectorTest (2), ConfigOpsTest (4), FacetValuesTest (3). Total tests now 85, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 32 — Phase 4 comprehensive tests (uncommitted)

- Added: `NameCleanerTest` (8), `PresentationTest` (3). Total tests now 96, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 33 — Phase 4 comprehensive tests (InventoryTest) + native verification (uncommitted)

- Added: `InventoryTest` (port of TS inventory.test.ts). Total tests now 97, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 34 — Phase 5 deeper pass (state machine, undo dispatch, idempotency, interrupted recovery, late confirmation, per-entity serialization, coalescing) (uncommitted)

- Built: deeper phase-5 pass. `canTransition`/`isTerminal` state machine, `undoPlan`/`isUndoable`, `validateParameters`/`expectationFor` with per-capability tolerances, `CommandExecutor` (validate -> authorize -> step-up -> dispatch -> confirm, timeout, late confirmation, cancel, undo with inverse dispatch, idempotency check/record, recoverInterrupted), `CommandRoutes`.
- Verified: `./gradlew build` green (97 tests, 0 failures); native image rebuilt and verified.

### Run 35 — Phase 5 remaining gaps (group commands, command events) (uncommitted)

- Built: groupId support in CommandInput/DeviceCommand, command event publishing (command.failed, command.confirmed, command.timed_out) via EventBus.
- Verified: `./gradlew build` green (97 tests, 0 failures); native image rebuilt and verified.

### Run 36 — Phase 5 comprehensive tests + remaining gaps (uncommitted)

- Added: `CommandExecutorTest` (15 cases). Total tests now 111, 0 failures.
- Verified: `./gradlew build` green; native image rebuilt and verified.

### Run 37 — Phase 6 comprehensive (visibility pruning, favorites, settings, rename/hide/merge/split, include=diagnostics, per-caller visible) (uncommitted)

- Built: ThingsService enhanced with canSee, visible, decorate, favoriteList, setFavorites, updateSettings, rename, setHidden, merge, split, setEntity. DeviceRoutes deepened with filters, capabilities, activity, rename, settings, hide/unhide, split, merge, commands, areas, area devices, entity role.
- Verified: `./gradlew build` green (111 tests, 0 failures); native image rebuilt and verified.

### Run 38 — Phase 12 Notifications, push, alerts, activity, insights (initial, uncommitted)

- Built: schema + SQLDelight queries for `notifications`, `alerts`, `push_subscriptions`, `activity_events`, `activity_reads`, `insight_dismissals` and user-preferences updates. Added core Phase 12 services/routes: notifications (`GET /api/v1/notifications`, mark read/all), alerts (`GET /api/v1/alerts`, ack), activity (`GET /api/v1/activity`, seen), insights (`GET /api/v1/insights`, dismiss) with TS-shaped responses/permissions, and user endpoints for preferences and push subscriptions (`/api/v1/users/me/preferences`, `/api/v1/users/me/push-subscriptions`, register/unregister/test, platform/vapid info). Replaced `ModeInsights` with `InsightsService` (time-of-day + presence-aware suggestions, dismissals, tick/events) while keeping mode suggestion in `/household/mode`. Wired push delivery hook (best-effort) and `/home` alert counts; device activity endpoint now returns filtered timeline entries.
- Push: provider interfaces and allow-list scaffolding added (`PushService`, WebPush/FCM provider stubs); subscription validation/limits/rate limiting/quiet-hours/push-enabled handling and dropped-device cleanup implemented. Full WebPush VAPID+encryption and FCM HTTP delivery are **not** fully implemented yet (providers currently return failure/non-delivery unless extended), and configurable allow-list is not yet exposed via `AppConfig` env.
- Alerts/activity: core storage, visibility-aware listing/ack, and notification emission for power-limit alerts implemented; left-open alert sweep/evaluation is scaffolded but not fully state-aware (requires HA entity last-changed/context wiring). Event-driven activity recording from commands/locks/scenes/routines/modes/automations/presence/alerts and HA logbook backfill on reconnect (L77) are **partial/not wired** in this pass.
- Fix status: L69 (retention + hide-details) partial (90-day prune method added, per-person/device visibility enforced in listings but full "hide details" semantics need review/scheduling), L73 partial (allow-list structure present, config surface incomplete), L77 open in practice (no logbook backfill), L94 partial (hysteresis implemented, per-device left-open threshold not yet persisted/enforced; fixed 10-minute default used).
- Verified: `./gradlew :server:compileKotlin` green; `./gradlew :server:test` green after fixing favorites route registration regression. Full end-to-end Phase 12 parity (event pipelines, HA-backed alert/activity flows, real push delivery, e2e fixtures/tests) remains incomplete.

### Run 39 — Phase 12 continuation (uncommitted)

- Built: added `entity_settings.left_open_after_ms` (schema/query + settings API/patch support) and per-device left-open threshold handling in alerts. Extended `AlertsService` with state-aware left-open evaluation/clearance and sweep over current HA states (via gateway/things), while keeping power-limit hysteresis. Reworked `HaEventBridge` to process HA state changes/events (`person.*` presence, mode helper sync, lock/manual changes, power/contact state hooks, `automation_triggered` run+activity hooks, `alice_notification` -> in-app notifications) and added WS-capable in-process config-job fallback. Added `Phase12Coordinator` for periodic left-open sweep, insights ticks, and activity retention pruning. Wired direct/best-effort Phase 12 hooks in commands (confirmed user/AI device activity + smart record), scenes (activation activity), routines (completion/failure activity), modes (mode-change activity + insights tick), and automations (manual-run activity and notify action emission).
- Push: added env/config wiring and provider implementations (WebPush via `com.interaso:webpush`, FCM HTTP v1 with service-account OAuth/JWT) with configurable web-push host allowlist. Added `PushServiceTest`.
- Verified: `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL** (including `PushServiceTest`).

### Run 40 — Phase 12 completion pass (uncommitted)

- Built: added HA logbook support in gateway/API (`HaLogbookEntry`, `getLogbook` in gateway/Fake/WS implementations) and best-effort logbook backfill on (re)connect in `HaEventBridge` with dedupe windows and timestamp preservation. Improved activity attribution/naming and dedupe for command/device/lock/automation/alert recording paths (device-name summaries, alert activity recording, dedupe windows). Strengthened left-open/power alert flows and periodic coordination hooks remain in place; retention pruning is scheduled via `Phase12Coordinator`.
- Status: previously open Phase 12 implementation gaps (L73 push config/provider delivery wiring, L77 logbook backfill path, L94 per-device left-open threshold/state-aware handling, and major event-driven activity hooks) are implemented in code. Remaining caveats are environment/validation-oriented rather than missing core implementation: real push delivery against live browser/FCM endpoints, HA logbook availability/shape differences across instances, and exhaustive e2e parity proof for every activity/visibility edge case and origin-deduplication scenario.
- Verified: `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL**.

## Run 41 — 2026-11-12 (Phase 13 initial: history, energy, admin, backups, support)

- Phase 13 started and partially implemented in `backend-kt`:
  - **History:** `GET /api/v1/history/devices/{id}` implemented (`HistoryService`/routes) with range parsing (default 24h, max 31 days), `entityId` selection across primary/other/control/sensor/facet entities, maxPoints clamping/downsampling, HA history fetch via gateway, normalization via `StateNormalizer`/`availabilityOf`, and permission-aware visibility through `ThingsService.visible`. **Caveat:** response/value shaping and HA history attribute fidelity may not be bit-for-bit identical to TS in all cases (depends on gateway row shape/attributes); exhaustive parity/e2e not yet covered by dedicated Phase 13 tests.
  - **Energy:** `/api/v1/energy/summary|history|pattern|devices` implemented with HA statistics aggregation, timezone-aware day boundaries, power/energy sensor discovery, per-device limits lookup from entity settings, hourly/daily series, and pattern baseline calculation (best-effort). **Caveat:** HA statistics availability/units/edge cases and full parity with TS calculations/response fields require broader validation.
  - **Admin:** `/api/v1/admin/health|diagnostics|audit` implemented with basic DB/HA/worker/push checks, diagnostics counts/versions/features, and cursor-paged audit listing with actor name resolution (best-effort filtering/paging over recent audit rows). **Caveat:** not yet full TS parity for all check details, audit retention/pruning policy, filters, or complete diagnostics fields (e.g. backup/update summaries may be incomplete).
  - **Backups:** schema (`backup_records`) and service/routes added for settings/list/create (app/HA enqueue)/verify/download/delete and staged app restore; local (and basic NAS path) destination handling, gzip and optional AES-256-GCM packing compatible in intent with TS format, SQLite snapshot/inspect via JDBC, and audit/notification hooks. **Caveat:** not full TS parity—no complete destination abstraction/upload flow, no scheduler/tick/retention automation wired, HA backup result post-processing/verification callbacks and restore-apply-at-startup logic not fully implemented, restore staging path/behavior and schema-version compatibility checks are simplified, and end-to-end backup/restore parity is unproven.
  - **Support access:** schema (`support_sessions`) and admin support endpoints (`GET/POST /api/v1/admin/support`, extend/end) implemented with scope validation, step-up on grant/extend, expiry, audit logging, household log/operator trail views, and admin notification on grant. **Caveat:** operator sign-in/API and full TS-equivalent support semantics/integrations are not implemented.
- `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL** (existing tests green). No dedicated Phase 13 route/service/integration test suite added yet.


## Run 42 — 2026-11-12 (Phase 13 completion pass: backups/scheduler/restore, admin metrics/prune, operator, attribute log)

- Continued Phase 13 implementation in `backend-kt`:
  - **Backups:** added `RestoreApply` and startup restore application in `Main.kt` for file-backed DBs; backup scheduler/tick (`startScheduler`/`tick`) with household timezone/day scheduling, catch-up guard, scheduled app backup + verify + retention, optional HA backup enqueue when available; HA config-job result handling hook (`onResult("backup.")`) for `backup.generate|info|delete|restore` to update records/verify status/audit/notifications and retention; basic decryption compatibility with additional keys via `BACKUP_ENCRYPTION_KEYS`; retention cleanup; staged restore now verifies checksum/integrity before staging.
  - **Admin/Audit:** added `GET /api/v1/admin/metrics` (basic status/uptime/checks/counts); added audit/attribute-log prune helpers (`pruneAudit`, `pruneAttributeLog`) in `AdminService` (not yet scheduled by a dedicated retention job/policy parity).
  - **Support/Operator:** implemented `OperatorService` and `/api/v1/operator/homes`, `/homes/{id}/health`, `/homes/{id}/devices` (Bearer operator token auth, grant/scope checks, audit trail on operator actions, read-only device view honoring camera scope).
  - **History (L75):** added `entity_attribute_log` table/queries and merged Alice-side attribute samples into `GET /api/v1/history/devices/{id}` responses; `HaEventBridge` now records normalized attribute samples (e.g. brightness/color/temperature/position/fan speed) for relevant domains on state changes (best-effort capture).
  - **Wiring:** `HistoryService` now depends on DB; DI/App/Main updated for operator routes/service, Phase 12 coordinator startup, backup scheduler startup, and restore apply before DB open.
- **Remaining caveats / not fully TS-parity:** backup key-id-in-header/rotation format parity and legacy compatibility details, upload destination implementation, explicit free-space checks, full dry-boot restore validation in a temp process equivalent to TS flow, complete HA backup verification/result edge-case parity and restore-apply operational behavior across all environments, audit retention scheduling/policy/filter parity and metrics completeness, exhaustive attribute-log capture coverage/retention tuning, operator token management endpoints/lifecycle parity beyond read API, and dedicated Phase 13 automated/e2e test coverage.
- `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL**.



## Run 43 — 2026-11-12 (Phase 14: updates, Ask Alice, support/operator hardening, wiring)

- **Updates (best-effort parity, hardened):** added `update_records` schema/queries, `UpdateService`/sources/routes (`/api/v1/updates` status/check/history/settings/schedule/install/emergency/rollback/cancel), manifest fetch/validation with optional Ed25519 signature verification supporting multiple configured publisher keys (rotation), basic `publishedAt` freshness/expiry sanity checks, `isNewer` version comparison, nightly window + auto-update tick scheduling, safety backups before install (app backup required; HA backup enqueue/wait best-effort except emergency path), marker-file installer writing `update-requested.json` for out-of-process supervisor handoff, rollback with optional staged data restore, audit records and admin notifications. Wired config (`UPDATE_MANIFEST_URL`, `UPDATE_SIGNING_PUBLIC_KEY`, `UPDATE_ALLOW_UNSIGNED`, `APP_VERSION`) and periodic tick.
  - **Caveats:** exact supervisor/artifact verification and install/rollback execution on target hosts (beyond marker handoff), real HA backup/restore and real-update end-to-end behavior, and TS edge-case parity remain environment/runtime dependent.
- **Ask Alice (hardened):** rules-first parser/context builder and proposal validation/clamping, optional Anthropic interpreter behind provider interface (forced tool proposals), per-user minute rate cap, per-household AI settings persisted in household settings (`enabled`, `dailyModelCallLimit`) via `GET/PUT /api/v1/ai/settings`, per-household daily model-call cost guard persisted in household settings for restart survival (best-effort semantics), global AI config (`AI_API_KEY`, `AI_MODEL`, `AI_ENABLED`), and proposal-only `/api/v1/ai/interpret`.
  - **Caveats:** exact TS-equivalent config/UX semantics, provider breadth, exhaustive visibility/proposal parity proof, and real-model/provider e2e behavior are not fully proven.
- **Support/operator hardening:** retained support session/admin flows and operator read API; added admin operator lifecycle routes (`POST/DELETE /api/v1/admin/operators`, `security.manage` + step-up) for token create/revoke with audit/logging (best-effort). Operator auth enforces revocation/expiry.
  - **Caveats:** full token lifecycle/management UX and exact TS semantics may differ in details.
- **GraalVM/CI/deploy references (in-repo complete as feasible):** `.github/workflows/backend-kt.yml` (push/PR + `workflow_dispatch`) runs `backend-kt` build+test+installDist, a best-effort Linux x64 GraalVM native-image smoke job, frontend surface check, and contract/e2e reference placeholder. Added `backend-kt/scripts/update-supervisor.sh` (marker/install-rollback contract), `backend-kt/scripts/native-smoke.sh`, `backend-kt/server/Dockerfile`, `backend-kt/docker-compose.yml` (server+worker reference), and `backend-kt/scripts/contract-e2e-env.md` (runbook for contract/frontend e2e and HA/provider validation against Kotlin backend). Existing Linux x64 native-image notes/build guidance retained.
  - **Caveats (external execution required):** full contract suite and frontend e2e runs against a live Kotlin backend stack, real supervisor/artifact install/rollback on target hosts, real HA backup/restore/update end-to-end behavior, live model/provider e2e, and production arm64/container/native packaging and CI matrix validation on target infrastructure.
- **Tests/verification:** added/expanded `Phase14RoutesTest` (updates status/history/settings validation, AI settings read/update, AI interpret auth/response, updates check/no-update behavior) and `Phase14ServiceTest` (`isNewer`, window logic, manifest payload/signing sanity). `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL** (137 tests passing). All feasible in-repo implementation, tests, docs, and deployment/validation scaffolding added; remaining work is execution/validation in external runtime environments. All implementation changes in `backend-kt/` (uncommitted), plus repo-level CI workflow.


## Run 44 — 2026-11-12 (Audit parity follow-up: visibility, routes, commands, HA, overrides)

- **Security/visibility:** added per-caller policy filtering for device/thing/area/favorite listings and command target visibility checks; restricted command `GET/cancel/undo` to same household and requester-or-admin.
- **Routes/wire (best-effort parity):** added `GET /api/v1/backups/{id}`; implemented device unmerge; honored `GET /api/v1/devices?favorite=true`; areas now include `deviceCount`; devices/things/capabilities responses moved toward TS decorated/ThingView shapes with settings/favorite/pruning (exact contract parity not fully proven).
- **Commands:** wired `Idempotency-Key` validation/replay in routes/executor (in-memory), switched command IDs to ULIDs. **Caveat:** `commands`/`command_attempts`/`idempotency_keys` DB tables not yet authoritative runtime stores; executor-level per-entity device-policy enforcement remains incomplete.
- **HA connection:** implemented `/api/v1/ha/connection` PUT/test/resync/delete (+ GET/admin-token) with service/query support (best-effort). **Caveat:** test/resync semantics and full TS gateway/sync behavior parity not exhaustively validated.
- **Overrides persistence:** added `entity_overrides` schema/queries and DB load/persist for entity overrides and `thing_links` (merge/split/unmerge); persisted thing rename/hide overrides; emit audit records and best-effort `things.changed` events. **Caveat:** not full TS parity for all override/cache invalidation/event/audit details.
- **Misc:** diagnostics unread notifications computed from real data; AI settings permission tightened to `security.manage`.
- **Docs/tests:** `backend-kt` builds/tests green (`./gradlew build`). `backend-kt/docs/LIMITATIONS.md` still contains historical duplicate/out-of-order run entries and some stale coverage notes from earlier phases (cleanup pending).
