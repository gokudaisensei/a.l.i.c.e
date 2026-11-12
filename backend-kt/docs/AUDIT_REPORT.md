# backend-kt audit: consolidated final report

This merges three audit passes into one list. Every ID from the earlier passes is kept so items can be traced back. The audit itself changed no project source files; the fixes made afterwards are recorded in sections 12 to 40 and summarised in the next section.

**Status tags:** **(V)** verified by reading the code, grep, or the compiler. **(R)** concluded by reading, not executed. **(H)** depends on real Home Assistant behavior and is unconfirmed.

**Severity:** **C** wrong or unsafe in a real deployment, **H** high, **M** medium, **L** low or polish.

---

## Status at a glance (after tranches 1 to 29)

> **Per-item detail:** the 17 rows below are only the headlines. Every one of the 304 itemised findings now has its own status in [AUDIT_ITEM_STATUS.md](AUDIT_ITEM_STATUS.md): 60 fixed, 51 partly, 187 not done, 6 moot. The headline table below is the optimistic view; that file is the full one.

Test suite: core 19, ha 41 (2 skipped), server 212 (4 skipped), worker 13; no failures. Before the fixes: core 3, ha 43, server 135, worker 13. Nothing has been run against a real Home Assistant, a real phone, or a built container image. `backend-kt` is still not tracked in git.

| # | Headline (section 1) | State | Where |
|---|---|---|---|
| 1 | HA runtime unwired | **Fixed** (`HaRuntime`, `SwitchableGateway`); untested against real HA. With no connection configured the app still serves `FakeGateway` data | 13, 17, 36 |
| 2 | Command pipeline fails against real HA | **Fixed** with tests against a payload-checking gateway | 12 |
| 3 | Authorization gaps | **Fixed** (sensitivity rules, entity ownership, undo) | 12 |
| 4 | Schema migration cannot work | **Fixed** (version-aware open, `.sqm` migrations, fail loudly) | 12, 14, 20, 21 |
| 5 | `"conn-1"` and first household | **Fixed as far as it matters**: household scoping fixed for settings, overrides and links; `"conn-1"` kept on purpose (thing ids hash it) and defined in one place | 17, 20, 24, 41 |
| 6 | `runBlocking`, DB lock, `Thread.sleep` | **Partly**: hot paths made `suspend`, ~10 `runBlocking` remain; the global DB lock and sleeping scheduler threads remain | 33 |
| 7 | Security hygiene | **Fixed**: HA token encrypted, sessions revalidated, size limit (declared bodies only), proxy header, keyed code hashes | 12, 15, 16, 28 |
| 8 | Backups | **Fixed** except per-household export, which does not apply while an install can hold only one household | 19, 29, 42 |
| 9 | Inventory amplification | **Fixed** (30 s cache, registry-event refresh) | 32 |
| 10 | Hand-built JSON; in-memory commands | **Partly**: commands and idempotency persisted, update marker built safely; other hand-built JSON remains | 14, 22 |
| 11 | Silent failure, `CancellationException` swallowed | **Partly**: cancellation fixed at 42 suspend call sites; broad `catch`/`runCatching` elsewhere unchanged | 35 |
| 12 | Deployment files disagree with code | **Fixed in the files**; images not built | 34 |
| 13 | Tests give false confidence | **Mostly fixed** (live tests skip properly, placeholder tests replaced, many new tests); some services still untested | 23, 25, 26, 33 |
| 14 | Hand-rolled facilities; organised by phase | **Partly**: `Phase*` names gone; no feature-folder reshuffle or lint; shared Gradle settings now live once in the root script | 43, 44 |
| 15 | Endpoints always 500 | **Fixed**, plus a sweep of 54 read endpoints | 12, 26 |
| 16 | Update flow is a stub | **Fixed** (real supervisor script, tested by hand; CI jobs can fail) | 22 |
| 17 | Native-client blockers | **Fixed on the server** (extra WebAuthn origins, ping/timeouts, revocation sweep, step-up parity); nothing built on the Android side | 12 |

Still open and worth knowing: a feature-folder reorganisation and a lint setup (not possible offline); the global database lock; typed models in place of remaining `Map<String, Any?>`; three Yubico deprecation warnings; a `HaEventBridge` that still assumes one connection; Android integration (yours to schedule).

---

## 0. Scope, method, corrections

**What was read**
- **In full:** all of `core`, all of `ha`, `worker` `Main` and `ConfigWorker`, and on the server: `App`, `Main`, `ServerModule`, the HTTP plugins, `AuthService`, `CommandExecutor`, `ThingsService`, `RealtimeHub`, `AutomationsService`, `SmartService`, `EnergyService`, `YubicoPasskeyEngine`, `PermissionService`, `HouseholdService`, `AdminService`, `GroupsService`, `HaCompile`, `BackupService`, `UpdateService`, `PushService` and providers, `ConfigSyncService`, `ConfigJobApplier`, `HaConnectionAdminService`, `HistoryService`, `ActivityService`, `AlertsService`, `InsightsService`, `PresenceService`, `ModesService`, `ModeMirrorService`, `ScenesService`, `FavoritesService`, `UserService`, `NotificationsService`, `Audit`, `SupportService`, `OperatorService`, `AskAlice.kt`, and the small routes.
- **Read in the final passes:** the rest of `RoutinesService`, every route file, `CommandTypes.kt`, `CommandStore.kt`, `PasskeyModels.kt`, `AuthModels.kt`, `ErrorModels.kt`, the worker's `HaAdminApi`, `scripts/`, the CI workflow, all 49 test files (including `AuthServiceTest` and `VirtualAuthenticator` in full), `Identity.sq` and `Core.sq` in full (comments skipped), the Android module's architecture doc and repository contract, and the TypeScript backend's `sensitivity.ts` for a parity check. Nothing in `backend-kt` is left unread.
- **Build and runs:** `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with 27 warnings. The test suite was not run. Two small throwaway checks were run: one against kotlinx.serialization 1.12.0 (NEW-2) and one throwaway Ktor test (NEW-31). The throwaway test file was deleted afterwards.
- **Context from you:** the clients will be the native Android app (in `android/`, still on a mock repository) and later a native iOS app. Section 10.5 reads the findings against that.

**Corrections folded into this report**
- **ThingsService overrides.** `ThingsService.kt` changed during the audit (modified 08:49). It now persists merges, splits and entity overrides. The earlier claim that they were never persisted is withdrawn. What remains is that the in-memory maps are shared across households (DOM-2). The tree is uncommitted and changing, so line numbers may drift.
- **`ha` test wiring claim:** withdrawn, it could not be supported.
- **Push SSRF (SEC-13, DOM-11):** withdrawn as a defect. `registerWebPush` requires `https`, no user-info, and a full match against an allowlist of push hostnames with a sensible default. The non-thread-safe rate list remains (PSH-2).
- **"Recovery-code regeneration lacks step-up":** not a bug, `AuthService.regenerateRecoveryCodes` checks it.
- **HA-1 (dead HA classes):** strengthened, see NEW-11 and NEW-12.

---

## 1. Executive summary

| # | Headline | Sev |
|---|---|---|
| 1 | **The Home Assistant runtime is unwired.** DI registers `FakeGateway`; nothing calls `gateway.connect()`; nothing feeds the state cache; nothing publishes device events. The real gateway, REST client, connection manager and about 8 related classes are dead code. (SRV-1, HA-1, NEW-11, NEW-12) | C |
| 2 | **The command pipeline would fail against real HA:** no entity target on dispatch, string parameters wrapped in literal quotes, `toggle` maps to `turn_on`, `set_color` confirmation crashes. (NEW-1, 2, 3, 6) | C |
| 3 | **Authorization gaps:** configurable "sensitive operation" rules are never enforced; `entityId` in the command body is not tied to the device in the URL; undo skips policy checks. (NEW-4, 5, 7) | C |
| 4 | Schema migration cannot work (no `.sqm` files; failure is swallowed, then the version is stamped as current). (CORE-1) | C |
| 5 | `"conn-1"` and "first household" are hardcoded in about 34 places. (DOM-2, DOM-3, HHD-4) | C |
| 6 | 34 `runBlocking` calls on request and event paths, one global DB lock, `Thread.sleep` inside `suspend` code. (SRV-4, CORE-3) | C/H |
| 7 | **Security hygiene:** HA token stored in plaintext; WebSocket sessions never revalidated; no request-size limits; spoofable `X-Forwarded-For`. (NEW-13, 14, 21, 22) | H |
| 8 | **Backups** can vanish with the container, be written unencrypted without warning, or be an inconsistent copy. (NEW-16) | H |
| 9 | **Inventory amplification:** every `things()`/`findEntity` call rebuilds the whole HA inventory, and many read paths call it per row. (DOM-2, NEW-9, NEW-19) | H |
| 10 | Hand-built JSON strings with unescaped interpolation; commands, idempotency and per-entity "queue" live only in memory. (DOM-1, DOM-6) | H |
| 11 | Silent failure everywhere: about 24 `catch` blocks plus many `runCatching`; `CancellationException` swallowed. | H |
| 12 | Deployment files disagree with the code (env names, worker key, `HA_URL`/`HA_TOKEN`). (SEC-2 to SEC-4) | H |
| 13 | **Tests give false confidence:** six "live HA" tests pass when HA is absent; two `HaCompileTest` tests never run; many tests assert nothing; many services have no tests. (TST-1 to TST-20) | H |
| 14 | Dozens of hand-rolled facilities that Ktor or small libraries provide; project organized by build phase, not feature. | M/H |
| 15 | **Several endpoints always return 500** because they respond with a mixed-type `Map`: `GET /api/v1/notifications`, `POST /api/v1/updates/{id}/rollback`, and the operator devices list. No test hits them. (NEW-31) | C/H |
| 16 | **The update flow is a stub end to end:** the reference supervisor script never downloads or verifies anything, and two of four CI jobs cannot fail. (NEW-35) | H |
| 17 | **Native-client blockers:** Android passkeys cannot work with the single-origin WebAuthn setup, `/ws` has no ping or timeouts (stale sockets exhaust the 10-per-user limit), the Kotlin step-up rules diverge from the TypeScript backend (locking and cover open demand a passkey). (AND-1 to AND-3, NEW-44) | H |

The **cleanest code** in the project is `AuthService`, the `core` crypto and the HTTP guards. Problems concentrate in the HA integration, the command pipeline, background work and the cross-cutting glue.

---

## 2. Module-by-module findings

### 2.1 `core`

| ID | File | Finding | Sev |
|---|---|---|---|
| CORE-1 | `core/src/main/kotlin/alice/core/db/DatabaseFactory.kt` | `Schema.migrate(driver, 0, version)` sits in `try/catch { }`, then `PRAGMA user_version` is stamped current regardless. There are no `.sqm` files, so any schema change leaves an existing DB marked up to date with missing columns. It always migrates from 0 instead of the stored version. (V) | C |
| CORE-2 | same | `isNewFile` is `file.length() == 0`, so a truncated DB silently becomes a fresh schema. `PRAGMA foreign_keys` runs after `Schema.create`. | M |
| CORE-3 | `Database` | One `ReentrantLock` serializes every `read` and `write`, which defeats WAL and `busy_timeout`. With `runBlocking` under the lock there is deadlock risk. | H |
| CORE-4 | `Database.write` | Nested writes give nested transactions. Many callers do `read {}` then `write {}` for read-modify-write, which is non-atomic. | M |
| CORE-5 | `Sealed`, `Secrets`, `BackupService.pack` | Three AES-GCM implementations, each splitting `ciphertext‖tag` by hand; default-charset string conversions; "s2 rotation groundwork" parsed but unused. | M |
| CORE-6 | `RateLimiter` | Read-modify-write under a JVM `synchronized`; KDoc claims the worker can share counters, but the lock does not span processes. | M |
| CORE-7 | `InProcessEventBus` | `tryEmit` result ignored with `DROP_OLDEST`, so slow subscribers silently lose events. | M |
| CORE-8 | `Ids` | Stringly prefix; other code bypasses it with `UUID` and `"cfg_${millis}_${random}"`. | L |
| CORE-9 | `TimeProvider` | 13 server files still call `System.currentTimeMillis()` directly. | M |
| CORE-10 | `ConfigLoaderFactory` | Hoplite loads the file, then about 150 lines hand-merge env vars with `copy()`; every new field needs edits in two places. | M |
| CORE-11 | `Core.sq` | `jobs` table has no apparent callers. | L |
| AUD-1 | `Audit.kt` | `Audit.write` takes a raw `AliceDb` and defaults `now` to `System.currentTimeMillis()`; cannot take the injected clock; easy to call outside a transaction (see NEW-26). | M |

### 2.2 `ha`

| ID | File | Finding | Sev |
|---|---|---|---|
| HA-1 | whole module | Unreferenced from `server`/`worker` main code: `HaProjectionStore`, `ConnectionService`, `ConnectionManager`, `ManagedConnection`, `DriftDetector`, `SyncService`, `HaRestClient`, `ModeMirror`. `HaWebSocketGateway` is used only by tests. About 700 lines of dead production code. (V) | C |
| HA-2 | `HaWebSocketGateway.kt:61` | Auth failure throws `IllegalStateException`, never `HaAuthError`, so every "don't retry a bad token" branch is unreachable. | H |
| HA-3 | same | `pending` is a plain map, never cleaned, and not failed when the socket drops (callers wait 30 s). | H |
| HA-4 | same | `baseUrl.replace("http","ws")` replaces every occurrence; no disconnect handling or reconnect; callback sets are plain mutable sets. | H |
| HA-5 | same | `getConfig()`/`getServices()` return `emptyMap()`; `callService` falls back to `"ctx"`; two near-identical `sendCommand` overloads. | M |
| HA-6 | `HaRestClient.kt` | `callService` ignores status and body, always returns `"ctx-rest"`, stringifies values, posts `body.toString()` despite content negotiation. | H |
| HA-7 | `StateCache.kt` | Backed by non-thread-safe `linkedMapOf` read and written from different threads. | H |
| HA-8 | `ConfigJobService.kt` | Domain sync logic living in `ha/` with a `Database` dependency; job ids `"cfg_${millis}_${random}"`; `prune()` always returns 0; polls every 500 ms on a raw thread; N+1 reads and copy-pasted object-id formulas; uses `"conn-1"`. | H |
| HA-9 | `ConnectionManager`/`ManagedConnection` | Each declares its own `ConnectionConfig`; `ConnectionService` is a third connection holder. | M |
| HA-10 | `HaProjectionStore` | `save` writes `attributes = null`; `load` returns empty attributes. | M |
| HA-11 | `HaTypes.kt` | `typealias HaStatisticsPeriod = String`; snake_case property names throughout; gateway returns `Map<String, List<Any>>`. | M |
| HA-12 | `HomeAssistantGateway` | Mixes production calls with test hooks (`emitState`, `emitEvent`); `prev!!` default; `sendRawCommand` leaks transport. | M |
| HA-13 | `Normalizer`, `NameCleaner` | Compiler-proven dead branches (3x "cast can never succeed"). | L |
| HAD-1 | `ThingBuilder` | An `object` with mutable `lastInventoryHash`/`lastThings`; `buildThingsIncremental` caches by `inv.hashCode()` ignoring connection and overrides. **No callers.** (V) | M |
| HAD-2 | `ThingBuilder` | `thingId = SHA-1(connection:ref)` truncated to 16 hex characters; a merge or split changes the ref and the id, orphaning usage stats, home order, scene usage and defaults. | M |
| HAD-3 | `ThingBuilder` | `hasChildren` rebuilds a list per iteration (O(n²·m)); `Thing.hubThingId` is a `var` while all else is `val`; `looseEntity!!`; recursive union-find. | L |
| HAD-4 | `Normalizer` | Two functions always `return null` ("placeholder") after computing unused locals; their `as? String` casts on `JsonElement` can never succeed. Nothing calls `Normalizer`. `HaAppEvent` and five event classes duplicate `core/events/AppEvents.kt` with different names and shapes. (V) | M |
| HAD-5 | event classes | `val type: String = "…"` is an overridable constructor parameter. | L |
| HAD-6 | `CapabilityDetector` | `DeviceCapability` is `@Serializable` with `Map<String, @Contextual Any?>` and no registered serializer; encoding would fail at runtime. | M |
| HAD-7 | `CapabilityDetector` | `supported_features` bits are magic numbers (1, 2, 4, 8, 16, 32). | M |
| HAD-8 | `CapabilityDetector` | No `play`/`pause`/volume for `media_player` (yet the executor has verbs for them); `alarm_control_panel` has no mapping though defaults mark arm/disarm sensitive; `valve` `open` maps to `open_cover`; `climate` has no power operation. | M |
| HAD-9 | `StateNormalizer` | `Map<String, Any?>` result; no "jammed" for locks; redundant helper. | L |
| HAD-10 | `Inventory` | `name` and `sourceName` always identical; `Instant.now()` default; only entities with a state are included. | L |
| HAD-11 | `FakeGateway` | Test double in `ha/src/main` with public mutable state and its own `Triple`/`Quad`. | L |
| HAD-12 | `NameCleaner` | Elvis and `!!` on non-null (compiler warnings); regexes compiled per call. | L |
| CMP-1 | `HaCompile` + worker `ConfigOps` | The Jinja templates are duplicated as exact-match constants; the worker rejects any other template, with no shared definition. | M |
| CMP-2 | `HaCompile` | `power_over_limit` fires at `limitW * 0.9` (hidden constant) with no debounce. (H) | M |
| CMP-3 | `HaCompile` | Missing fields default silently (empty ids, mode `"home"`, `"00:00"`); non-object conditions/actions are skipped. | M |
| CMP-4 | `HaCompile` | Object ids are `alice_scene_<ULID>` (upper-case); HA ids are normally lower-case slugs; `.replace("-", "_")` is a no-op. (H) | M |
| CMP-5 | `HaCompile` | Another copy of the any-to-JSON helpers. | L |

### 2.3 `server`: wiring, boot, HTTP

| ID | File | Finding | Sev |
|---|---|---|---|
| SRV-1 | `server/src/main/kotlin/alice/server/di/ServerModule.kt:78-79` | `single { FakeGateway() }` and `single<HomeAssistantGateway> { FakeGateway() }` are two separate instances. Production serves a fake home. (V) | C |
| SRV-2 | `ServerModule` | `InMemoryCommandStore` is registered twice as two different instances (once per type). | H |
| SRV-3 | `ServerModule` | Positional `get()` wiring (up to 9 args); many `getOrNull()` deps turn wiring mistakes into silent feature loss. | H |
| SRV-4 | repo-wide | 34 `runBlocking` calls (`RealtimeHub` 7, `AlertsService` 7, others) block engine/Default threads and can deadlock against CORE-3. | C/H |
| SRV-5 | `App.kt` | `configure(koin)` is a 40-service locator hand-wiring 30 route functions; about 60 import lines (one duplicated). | M |
| SRV-6 | `Main.kt` | Boot is a pile of `runCatching { … start() }` that discard failures, a raw daemon thread with `Thread.sleep`, an inline never-cancelled scope; the shutdown hook misses several loops; `phase12.start()` is called in both `App.kt` and `Main.kt`. | H |
| SRV-7 | `Main.kt` | First-run setup code logged in plaintext at WARN. | M |
| SRV-8 | `App.kt` | All `BadRequestException`s return 422 (contradicting the comment); `exception<Throwable>` catches `CancellationException`. | M |
| SRV-9 | `CorsPlugin` | Reimplements Ktor `CORS`; `Allow-Credentials: true` on every response; echoes the request method. | M |
| SRV-10 | `RequestIdPlugin` | Trusts a client-supplied `X-Request-Id` with no length or charset limit. | M |
| SRV-11 | `SessionCookie` | `sessionCookieAttributes(secure)` ignores its parameter. | L |
| SRV-12 | `SessionPlugin` | `lateinit var` config fails at first request. | L |
| NEW-20 | `SessionPlugin`/`AuthService.getSession` | `getSession` runs on **every API request inside `database.write {}`** (a write transaction on the global lock, up to two UPDATEs) from `onCall` on the engine thread, which defeats the `blocking {}` rationale in `AuthRoutes`. (V) | M/H |
| NEW-21 | `App.kt` | No request body size limit anywhere, including unauthenticated auth endpoints. (V, grep) | M |
| NEW-22 | `AuthRoutes.clientIp` | With `trustProxy` on, the **first** `X-Forwarded-For` entry is used, which clients control; per-IP rate limits can be bypassed. (V) | M |
| NEW-8 | `RealtimeRoutes.kt` | `bufferedAmount()` is hardcoded `0`, so the slow-consumer check never fires; `install(WebSockets)` sets no ping, timeout or max frame size; hardcodes `"alice_session"`. (V) | H |
| NEW-14 | `RealtimeHub.sweep()` | Only `sweep()` checks `isSessionActive`, and nothing calls it. A logged-out or revoked session keeps its socket and events while the user remains a member. (V) | H |
| NEW-15 | `RealtimeHub` | Activity and alert events are sent to broadly-permitted clients without the per-device visibility check used by `GET /activity` and `AlertsService.viewFor`. (R) | M |
| RT-1 | `RealtimeHub.connect` | Per-user limit of 10 is a check-then-act race. | M |
| RT-2 | `RealtimeHub` | Collector and flush loops start in `init` and are never cancelled. | M |
| RT-3 | `RealtimeHub.onEvent` | Handles both event families (`ha` and `core`) because both exist (HAD-4). | M |
| RT-4 | `RealtimeHub` | Message types and resources are bare strings. | L |
| RT-5 | `RealtimeHub` | `canClientSeeEntity` reloads all policies per client per event. | M |
| DOM-12 | `RealtimeHub` | `messageLimiter` lists are not thread-safe; `enqueue` claims to drop "non-critical" but drops the oldest unconditionally; `stop()` clears the map without closing sockets. | H |
| NEW-19 (part) | `RealtimeHub` | One collector coroutine runs `onEvent` sequentially, each with `runBlocking { locate }` (a full inventory build); while it is slow, the bus (buffer 512, drop-oldest) drops events. (V) | H |

### 2.4 `server`: domain services

**Command pipeline, things, groups** (logic defects are in section 3)

| ID | Service | Finding | Sev |
|---|---|---|---|
| DOM-1 | `CommandExecutor` | `entityQueues`/`entityLocks` are never drained or removed, so there is no real per-entity serialization or coalescing. Confirmation uses `Thread.sleep(50)` in a `suspend` function for up to 5 s. Idempotency is in memory, keyed `key + userId`, cleaned in O(n), with a racy check-then-record. The `commands`, `idempotency_keys`, `command_attempts` tables are unused; history is lost on restart. `cancel` cannot stop an in-flight command. The activity-feed text (a 15-case `when`) is built inside `publishCommandEvent`, which uses `GlobalContext`. | H |
| DOM-2 | `ThingsService` | Every `things()`/`find`/`findEntity` rebuilds the full inventory (four gateway calls) and runs `ThingBuilder`; event handlers call it per event. Overrides, merges and splits are plain mutable collections shared by all households; `overridesLoadedFor` holds one household id, so a second household clears or mixes the first. `auditOverride` ends with a note `overridesLoadedFor = null // force reload-safe? no…`. 11 hardcoded `"conn-1"`. | H |
| NEW-9 | `visible()`, `GroupsService`, `ActionService`, `EnergyService.meters()` | `EnergyService.meters()` calls `visible()` per thing, so N things cost N inventories. `GroupsService.create/update` call `things()` once per member id (up to 100). `GroupsService.view` runs `canSeeEntity` per entity (each a `findEntity` plus a policy list). `ActionService.run` does two inventories and two policy loads per action. `GET /devices/{id}` and `PATCH …/name` build views for every device to pick one. (R) | H |
| NEW-10 | `GroupsService.view` | The read path **writes**: it re-links stale refs by deleting every member and re-inserting inside the loop. The private `resolveMembers` does the same in two separate transactions (crash between them empties the group) and has no callers. The re-link code is copied three times. (V) | H |
| GRP-1 | `GroupsService` | `GroupDevice.available = thing.primary != null` means "has a primary", not "online". | M |
| GRP-2 | `GroupsService` | `target: String = "first"` string option; hardcoded `"conn-1"`; compiler warnings at lines 60, 61, 82. | L |
| FAV-1 | `FavoritesService` | Favorites are stored by `ref`; merge/split changes refs (HAD-2), so favorites disappear. Defaults to `"conn-1"` and filters after fetching all rows. | M |
| DOM-14 | permissions | A typed `Permission` enum exists but guards take strings (see PRM-6). | M |

**Automations, routines, scenes**

| ID | Finding | Sev |
|---|---|---|
| DOM-4 | `RoutinesService`: steps are raw `JsonObject` with string `type`; states are strings; `remove()` deletes the routine even when no `script.delete` job was queued (orphan HA scripts); write-then-reread; `GlobalContext`; `!!`. | H |
| DOM-5 | Scene, routine and automation sync code is the same logic three times (the `alice_*` id formulas appear 13 times). | M |
| SYN-1 | `ConfigJobApplier` is a third copy of the sync-state update (with `ConfigJobService.postApply` and the three `syncRow`s). | M |
| AUT-1 | Automation definitions parsed and validated as raw `JsonObject`s (about 150 manual lines). | M |
| AUT-2 | `validateTrigger`: `t["userId"]!!.jsonPrimitive.content` evaluates and discards, so a malformed `userId` passes. | M |
| AUT-3 | `notify` actions accept any `userIds` with no check that they are members. | H |
| AUT-4 | Scene and routine ids in actions are not checked for existence; `compileAction` emits `script.alice_scene_` for an empty id. | M |
| AUT-5 | `runNow` applies actions in sequence with no failure handling; `executed++` counts actions skipped because an optional service was null. | M |
| AUT-6 | Third copy of the mode list. | L |
| AUT-7 | `compileContext()` uses `GlobalContext`, `runBlocking` and `"conn-1"`. | M |
| AUT-8 | Several non-atomic writes per operation. | L |
| AUT-9 | Four `Caller` types (`things`, `routines`, `automations`, `AccessCaller`) converted by hand. | L |
| AUT-10 | `describe()` builds user-facing English strings in the service. | L |
| SCN-1 | `activate` runs actions one at a time, each waiting up to 5 s for confirmation (and always timing out, NEW-12). | L |
| NEW-28 | `ScenesService.view` returns the full action list (entity ids and parameters) to non-guest members even for entities denied by policy. (R) | M |
| NEW-27 | `updateScene/updateRoutine/updateAutomation` rewrite every column from a stale snapshot; `activate` and `recordRun` overwrite concurrent edits. (V) | M |

**Smart, energy, history**

| ID | Finding | Sev |
|---|---|---|
| SMT-1 | `sceneChips` builds `HomeSceneChip(it.first, it.first, …)`: the scene name is its id. | M |
| SMT-2 | `home()` makes two DB queries per device; builds the inventory twice; runs `canSee` per entity. | M |
| SMT-3 | Usage counters read then write in separate transactions (lost updates); many queries filter in Kotlin. | M |
| SMT-4 | `"%.2f".format(...)` is locale-dependent. | L |
| SMT-5 | `tz` defaults to `"UTC"` here while energy reads the household timezone. | L |
| SMT-6 | Alert level uses `it.data.toString().contains("tamper")`. | L |
| SMT-7 | Regexes compiled per call; trigrams recomputed per search. | L |
| SMT-8 | Feature flags checked inline in about ten places. | L |
| ENG-1 | Unknown units are treated as kWh/W; `GJ` uses an approximation. | M |
| ENG-2 | `parseTimeEnergy` treats any 10+ digit number as milliseconds; a 10-digit epoch in seconds becomes January 1970. | M |
| ENG-3 | `pattern()` subtracts fixed 24-hour days, wrong across DST. | M |
| ENG-4 | `consumption()` swallows every error and reports "unavailable". | M |
| ENG-5 | `pattern()` makes up to 9 sequential queries, no cache. | L |
| ENG-6 | Invalid `resolution` becomes `"hour"`; invalid timezone becomes UTC. | L |
| ENG-7 | `mapToJsonObject` exists only to bridge the untyped gateway result. | L |
| ENG-8 | Uses the `HomeAssistantGateway` singleton and `"conn-1"`. | L |
| HST-1 | `parseTime` is a copy of `parseTimeEnergy`, with the same epoch bug. | M |
| HST-2 | HA errors swallowed (`getOrDefault(emptyList())`), so an outage looks like no data. | M |
| HST-3 | Quadratic attribute-log merge; the only `@Suppress` in the project; redundant `!!`. | L |
| HST-4 | `recordAttributes` is another inline converter and swallows write errors. | L |

**Alerts, notifications, push**

| ID | Finding | Sev |
|---|---|---|
| NEW-18 | (a) `NotificationsService.notify` calls `runBlocking { hook(...) }`, which runs `push.deliver` with blocking network calls per device; everything that creates a notification waits, and `notifyHousehold` does it user by user. (b) `FcmProvider` treats `INVALID_ARGUMENT` as "gone" and deletes the subscription, so a payload bug can erase valid tokens. (c) `WebPushProvider` classifies the library result by string-sniffing; the first branch matches `contains("valid")`, so an "invalid…" state is reported **sent**. (d) `http.send` is blocking inside `suspend`. (e) An unused second library object (`helper`). (V) | H |
| NEW-24 | Quiet hours are stored without validating `from`/`to`; `inQuietHours` calls `toInt()` and a malformed value marks every non-urgent push "failed"; it also round-trips the time through an `"h:mm a"` string. (V) | M |
| NEW-19 (part) | `ActivityService.list` calls `thingIdFor` per row (`runBlocking { findEntity }`, a full inventory per item, up to 100 per request) plus a user lookup per row. `AlertsService.list` calls `viewFor` per alert, each rebuilding inventory; `SmartService.home()` calls it. `evaluatePower` rebuilds the inventory before checking `device_class == "power"`. (V) | H |
| NTF-1 | `onCreated` is a `var` wired in `App.configure`, not in DI. | M |
| NTF-2 | `notifyAdmins` calls `listMembers` twice. | L |
| ACT-1 | `record` dedupes by scanning recent rows with a check/insert race; `list()` paging logic is convoluted. | M |
| ACT-2 | `ActivityService.prune()` returns a real count (via `RETURNING`); `AdminService.pruneAudit` and `ConfigJobService.prune` could copy it. | L |
| ALR-1 | `AlertsService.toWatts` is a third copy; thresholds hardcoded. | M |
| ALR-2 | `sweepLeftOpen` uses `"conn-1"` and `runBlocking`. | L |
| ALR-3 | `evaluatePower` does the cheap `device_class` check last. | L |
| PSH-1 | `PushResult`, `EntityRole`, `ThingKind`, `TimeOfDay` use lower-case enum entries. | L |
| PSH-2 | `rate` map grows per user; per-user lists are unsynchronized. | L |
| PSH-3 | `upsert` count-then-insert is racy; one device token registered by two users pushes to both. | L |
| PSH-4 | `parseKeys` tries four formats and hides every failure. | L |
| PSH-5 | FCM `accessToken` does a blocking call under `@Synchronized`. | L |

**Backups, updates, restore**

| ID | Finding | Sev |
|---|---|---|
| NEW-16 | (a) Backups are written to `user.dir/data/backups`, not next to the DB; in the shipped Docker setup that is `/app/data/backups`, outside the `/data` volume. (b) `BACKUP_ENCRYPTION_KEY` is read from the environment; a malformed or wrong-length key is silently ignored, so backups are **unencrypted with no warning**. (c) `snapshotDb()` falls back to copying the live DB file without the `-wal` file when `VACUUM INTO` fails, producing an inconsistent backup silently. (d) The snapshot is the whole database (all households), downloadable by any household's admin. (e) The scheduler marks the day done before the backup runs. (f) Files are written in place (no temp-and-rename) and a `running` record is never recovered after a crash. (g) `inspectRaw` does not check `user_version`. (V) | H |
| NEW-25 | Update state is per household but the operation is server-wide (one binary, one marker file); each household's tick fetches the manifest; "done" is inferred from the version. `start()` does blocking backup I/O in a coroutine; a failed HA safety backup is skipped silently; `tick` wraps `start`/`check` in `runCatching`, so a record can sit in `preparing`; the `settings` JSON column is read-modify-written by `UpdateService`, `BackupService.saveSettings` (outside a transaction) and `AskAliceService`. (R) | M |
| DOM-7 | `ManifestUpdateSource.latest()` is `suspend` but calls blocking `HttpClient.send`; hand-rolled semver compares pre-release as strings (`rc.10` before `rc.2`); Ed25519 verify is hand-rolled; `MarkerFileInstaller` builds JSON by interpolation; settings JSON parsed with `runCatching` in three places. | M/H |
| DOM-8 | `RestoreApply` moves the live DB aside then moves the pending file in; no rollback if the second move fails; only `integrity_check` validates. | H |
| DOM-9 | `BackupService`: `System.arraycopy` with offsets 5/17/33, `catch (_: Throwable) {}` per key, `Thread.sleep(60_000)` scheduler, own hex SHA-256. | M |
| BKP-1 | Reads `BACKUP_ENCRYPTION_KEY(S)` straight from `System.getenv`. | M |
| BKP-3 | `findRecordById` queries every household. | M |
| BKP-4 | `retain()` assumes newest-first ordering. | L |
| BKP-5 | `nasPath` blocks only `..`; any writable absolute directory is accepted. | M |
| BKP-6 | One full-database copy per household per scheduled run; all held in memory. | L |
| BKP-7 | `verify` decompresses synchronously in a request thread. | L |
| UPD-1 | `nextWindowStart` is an hour off across DST. | L |
| UPD-2 | `triedBefore` stops auto-update retrying a failed version forever. | L |
| UPD-3 | `check()` catches `Throwable`, recording cancellation as an error. | L |
| UPD-4 | Status values are strings. | L |

**HA connection admin, sync**

| ID | Finding | Sev |
|---|---|---|
| NEW-13 | The HA long-lived token is stored **in plaintext** in `operational_token_enc`; `Secrets.encryptSecret/decryptSecret` have no callers; `SECRETS_KEY` is never read; the token ends up in unencrypted backups. (V) | H |
| NEW-17 | `deleteConfigJobsByDedupeKey` deletes pending jobs by key only (no household filter); `"verify"`, `"helper:mode"` and `"voice:<entityId>"` collide across households; `verifyAll` therefore leaves only the last household's job. (V, SQL) | H |
| SYN-2 | The in-process applier handles only `helper.ensure_mode_select` and `voice.expose` and is polled only for connections **without** an admin token, while the code that enqueues those jobs requires one; probably never reached. (R) | M |
| SYN-3 | `applyPending(null)` does nothing; it also selects `running` jobs, so it could re-run a job the worker is executing. | L |
| SYN-4 | `testConnection` uses blocking `HttpURLConnection` in a route; reports `ok = true` for HTTP 401; `putConnection` accepts any URI scheme. | M |
| SYN-5 | `updateHaConnectionStatus` has no callers, so status, version, last-connected and last-error never update; `entities`/`syncedAt` never set. (V) | M |
| SYN-6 | `resyncConnection` swallows errors and always returns `ok: true`; `verifyAll()` has no per-household try/catch. | L |
| SYN-7 | `reconcileScenes` uses `runBlocking` and a different `Caller` type than its siblings. | L |

**Admin, support, operators, presence, insights, modes**

| ID | Finding | Sev |
|---|---|---|
| ADM-1 | `audit()` loads the latest 2000 audit rows for **all households** and filters in memory; `audit_log` is indexed only on `created_at`; N+1 user lookups. | H |
| ADM-2 | `pruneAudit`/`pruneAttributeLog` always return 0 and prune globally. | M |
| ADM-3 | `diagnostics()` loads full tables just to count, queries per member, uses `runBlocking`; `metrics()` repeats this and calls `jobs.status` twice. | M |
| ADM-4 | `operationalTokenEncryption` is hardcoded `false`. | L |
| ADM-5 | `startedAt` is service-construction time; hand-built JSON. | L |
| SUP-1 | `expireSupportSessions` (a write) runs at the start of almost every method, including read paths. | M |
| SUP-2 | `householdLog`/`operatorTrail` read the latest 500 audit rows across households and filter in memory. | M |
| SUP-3 | `"support.expired"` log text exists but nothing writes that audit action. | L |
| SUP-4 | `OperatorService.devicesOf` calls `things.visible` per thing; `authenticate` writes `last_seen` every call. | M |
| INS-1 | `list()` does a `runBlocking` presence count (inventory plus all states) each time; `tick()`/`dismiss()` call it again; `dismiss` 404s if the suggestion stopped being current. | M |
| PRS-1 | Every presence query builds the inventory and fetches all states; sync `persons()`/`people()` are stubs; `PresenceLinksChangedEvent` is declared in the service file. | M |
| MOD-1 | `ModesService.set` audits via `database.raw`, uses `GlobalContext`, calls `runBlocking { mirror?.push }` (network on the request thread) and swallows failure. | M |
| MOD-2 | The mode list exists in about six places; `MODE_HELPER_ENTITY` is defined three times. | M |
| MOD-3 | `ModeMirrorService` fetches all HA states to read one entity; when the helper changes, the bridge sets the mode for **every** household. | M |
| DOM-3 | `HaEventBridge` uses `households.firstOrNull()`, queries all households on every state change, polls every 2 s unconditionally, uses `GlobalContext`, logs failures at debug. | H |
| USR-1 | `UserService`: `locale` unvalidated, `time` unused, `getPreferences` writes on GET, unbounded `extra` JSON. | L |

**Permissions, households, auth, passkeys, AI**

| ID | Finding | Sev |
|---|---|---|
| PRM-1 | `resolveSensitivity` returns the first match in list order, so a generic rule listed first overrides a more specific device-class rule. (Currently unused, NEW-4.) | H |
| PRM-2 | `ReplaceResult` is declared twice (nested and top level). | L |
| PRM-3 | `createPolicy` does not check that the connection or entity exists, that a `member` subject belongs to the household, or what `operations` contain. | M |
| PRM-4 | `defaultsSwitchedOff` uses a redundant double filter; unused `val changed`. | L |
| PRM-5 | `sensitivityPolicy()` reloads rules from the DB on each call. | L |
| PRM-6 | The `Permission` enum is ignored by routes that use literals (`"scene.run"`, `"device.view"`, `"ha.manage"`, `"mode.change"`, `"group.write"`). | M |
| PRM-7 | Policies match on string `subjectType`/`effect`. | L |
| HHD-1 | `Role.fromWire` throws on an unknown role inside `lookupMembership`, so one bad row gives that user a 500 on every request. | M |
| HHD-2 | `updateMember` always replaces `expires_at`, so a role change passing null clears a guest's expiry. | M |
| HHD-3 | `removeMember` leaves sessions, push subscriptions, person links and favorites. | M |
| HHD-4 | "One household per user" is encoded in `selectMembershipByUser`, but code elsewhere assumes `householdId` everywhere. State which is supported. | L |
| HHD-5 | Household timezone is stored without validation. | L |
| HHD-6 | `HOUR_MS`/`DAY_MS`/`MINUTE_MS` are defined in several files. | L |
| DOM-13 | `AuthService`/`AuthRoutes`: best code; lockout response reveals the credential exists; five failures can be forced by anyone holding a credential id. | L/M |
| AUTH-1 | Stale comment in `regenerateRecoveryCodes`. | L |
| AUTH-2 | `secretsGlobal` uses one key `"all"`: an attacker can exhaust it and block legitimate invite and recovery flows. | L |
| NEW-23 | Recovery codes (about 50 bits) and invitation codes are stored as unsalted SHA-256; if a DB or unencrypted backup leaks they can be brute-forced offline. Estimate: about a day on one modern GPU (not measured). (R) | M |
| PSK-1 | Both passkey finish methods catch `Exception` and log at debug, so real faults look like a wrong passkey. | M |
| PSK-2 | `.origins(setOf(config.webauthn.origin))` allows exactly one origin. The Android app will sign in with passkeys, and Android's Credential Manager reports the origin as `android:apk-key-hash:<hash of the app signing certificate>`, so the backend would reject every Android sign-in, step-up and registration until that origin can be configured. See AND-1. (H, Android platform behavior) | H |
| PSK-3 | `finishRegistration` rebuilds the options instead of using the stored request. | L |
| PSK-4 | The user handle is `usr_<ULID>`, exposing creation time in a value WebAuthn wants opaque. | L |
| PSK-5 | Duplicated algorithm list; encode-then-decode round trip; `%02x` again; 6 deprecation warnings. | L |
| PSK-6 | `SqlCredentialRepository.lookup` accepts an empty user handle. | L |
| DOM-10 | `AskAliceService`/`AnthropicInterpreter` builds request JSON with a `StringBuilder` and hand-written escaper; `java.net.http` instead of an SDK or Ktor client; unsynchronized per-user rate lists. | M |
| AI-1 | The text interpreter is regex heuristics with global tables and no tests; `Regex(...)` compiled per call. | M |
| AI-2 | The sealed `Plan` interface is unused (suggestions use a raw `JsonObject`); about 60 fully-qualified `kotlinx.serialization.json.*` references. | L |
| AI-3 | `validateProposals` flags only `unlock` as sensitive and accepts `toggle` (NEW-3); otherwise it validates the model output well against known ids. | M |
| SEC-9 | The Anthropic call sends household device names to a third party. | L/M |

### 2.5 `worker`

| ID | Finding | Sev |
|---|---|---|
| WRK-1 | `HaAdminApi` is a **third** HA client (with `HaTimeout`, `HaConfigHttpError`). | M |
| WRK-2 | `worker/ConfigOps` (217 lines) and `ha/ConfigOps` (87 lines) are two different implementations; only one has the template allow-list. | H |
| WRK-3 | `tick()` catches `Exception` around suspend code (swallows cancellation); `perform()` uses `payload["objectId"]!!`, so a missing key is an NPE classified as retryable. | H |
| WRK-4 | `recoverInterrupted()` always returns 0; heartbeat JSON is interpolated. | L |
| WRK-5 | `Main.kt` reads four env vars directly from `System.getenv`. | M |
| WRK-6 | Separate `Database` lock per process; heartbeat freshness uses each process's clock. | L |

### 2.6 Routes

| ID | Finding | Sev |
|---|---|---|
| RTE-1 | `split` does not check entity ids belong to the thing; `PUT /entities/{entityId}/role` does not validate the role or that the entity exists or is visible; `merge`/`unmerge` do not check ids. | M |
| RTE-2 | `AutomationRoutes` requires `AUTOMATION_WRITE` for every endpoint including reads; no run permission. | M |
| RTE-3 | `ThingsRoutes` and `DeviceRoutes.toViewJson` hand-build near-identical device JSON. | M |
| RTE-4 | `PreferencesPatchBody` cannot distinguish null from absent; `POST …/push-subscriptions/test` wraps `suspend` in `runBlocking`. | L |
| RTE-5 | `HaConnectionRoutes`/`BackupRoutes` copy an inline any-to-JSON converter four times because services return `Map<String, Any?>`. | L |
| RTE-6 | `BackupRoutes` builds an untyped `Map<String, Any?>` patch. | L |
| RTE-7 | Seven route files rebuild the same `Caller` by hand. | L |
| RTE-8 | `InsightsRoutes` and alert routes borrow `MODE_CHANGE`/`NOTIFICATION_RECEIVE`; health uses a separate uptime clock. | L |
| RTE-9 | `AskAliceRoutes` turns a malformed body into defaults via `runCatching`. | L |

### 2.7 SQL schema (`Core.sq`, `Identity.sq`)

| ID | Finding | Sev |
|---|---|---|
| SQL-1 | No `CHECK` constraints anywhere; status and enum-like columns are free text. (V) | M |
| SQL-2 | `audit_log` has only a `created_at` index although audits filter by household. | M |
| SQL-3 | `deleteExpiredChallenges` has no caller; no query purges expired sessions. (V, grep) | M |
| SQL-4 | 72 `SELECT *` queries; several unbounded per-request reads (`selectAllHouseholds`, `selectAllPersonLinks`, `selectDevicePoliciesByHousehold` for every `canSee`). | L |
| SQL-5 | `ha_connections` is `UNIQUE (household_id)` (one connection per household), conflicting with `ConnectionManager`'s id-keyed map and the literal `"conn-1"`. | L |
| SQL-6 | Some `created_by`/`updated_by` columns reference `users(id)` with no `ON DELETE` rule. | L |

---

## 3. Logic and correctness issues (itemized)

| ID | Where | Defect | Effect | Sev |
|---|---|---|---|---|
| NEW-11 | whole server | No code publishes entity state, availability, removed or registry events (only the uncalled `Normalizer` builds them). The `StateCache` singleton is written only by unreferenced classes. (V) | `entity.updated`, `entity.availability_changed` and `devices.changed` over the WebSocket never fire. | C |
| NEW-12 | `CommandExecutor`, energy, history, admin | `gateway.connect()` is called only by unreferenced classes; `FakeGateway` stays disconnected; the cache is empty. (V) | Every command with an expectation waits 5 s and ends `TIMED_OUT`; undo has no `previousState`; history always returns 503; energy always "unavailable"; admin health reports HA down. | C |
| NEW-1 | `CommandExecutor.kt:128` | Dispatch builds `HaServiceCallInput(domain, service, data = …)` with **no `target`**; `resolveOperation` never puts `entity_id` in `data`. Scenes/routines and `ThingsService.callService` do set targets. (V) (H) | Most likely a silent no-op: current Home Assistant treats an entity call with no target as an empty target list, and "all" has to be sent explicitly (see section 11). The command is then reported as accepted and times out. The only test with a target skips the executor. | C |
| NEW-2 | `CommandExecutor.kt:128`, `:233` | Parameters become `JsonPrimitive(v?.toString())` where `v` is already a `JsonElement`. Running `JsonPrimitive("cool").toString()` on kotlinx.serialization 1.12.0 returns `"cool"` **with the quotes**. (V, run) | `hvac_mode`, `preset_mode`, `fan_mode`, `swing_mode`, `direction` reach HA in literal quotes; numbers become strings; an `rgb` array becomes the string `"[255,0,0]"`. Scenes/routines convert correctly, so the two paths disagree. Same code in `HaRestClient:39`. | C |
| NEW-3 | `CapabilityDetector.kt:87` | `"toggle"` maps to the HA service `turn_on`. (V) | Toggling an "on" device does nothing; the expectation wants the opposite state, so it times out. | H |
| NEW-4 | whole server | `sensitivityPolicy()`/`resolveSensitivity()` have zero callers; step-up uses a hardcoded `setOf("unlock","lock","open")` in `CommandExecutor`, `ActionService.validate`, `AutomationsService.sensitiveActions`. (V, grep) | Editing the rules in the UI does nothing; `alarm_control_panel` arm/disarm are unprotected although defaults mark them sensitive; `cover.open` is treated as sensitive although defaults say it is not. | C |
| NEW-5 | `DeviceRoutes.kt:~296`, `ThingsService.canSee` | `POST /devices/{id}/commands` takes `entityId` from the body and checks `vis.canSee(entityId)`, which builds targets from the thing in the URL. Nothing verifies the entity belongs to `{id}`; the executor does not check it exists. (R) (H) | A member's deny rule on another device's ref is missed; a guest with one allow rule can pass any `entityId` and match through that thing's targets. | C |
| NEW-6 | `Expectations.kt` (`set_color`) | `p["rgb"] as List<*>` succeeds for `JsonArray`, then elements are cast to `Number`, which fails for `JsonPrimitive`; normalized light state has no `color` key. (R) | The exception escapes the confirm loop; even if fixed, a color command can never confirm. | H |
| NEW-7 | `CommandExecutor.undo` | Calls `execute()` as the original user without re-checking policies. (R) | A deny added after the original command does not block the undo. | H |
| LOG-3 | `CommandExecutor` | No real serialization or coalescing (DOM-1). | Concurrent toggles race. | H |
| LOG-4 | idempotency | Check and record are not atomic; key is `key + userId`. | Duplicate execution on retry storms; theoretical cross-user collision. | H |
| LOG-5 | `fingerprint` | Hash over `params.toString()`, in memory. | Idempotency lost on restart. | M |
| LOG-10 | `runCommand` | Re-reads cache, polls with `Thread.sleep(50)`, "late confirmation" duplicates the loop body. | Thread starvation under load. | H |
| LOG-6 | `ThingsService` | Shared caches across households. | Cross-household leakage of merges, hides and renames. | H |
| LOG-7 | `HaEventBridge` | `firstOrNull()` household. | Events attributed to the wrong or only the first home. | H |
| LOG-8 | gateway | `HaAuthError` never thrown. | Bad tokens retried forever. | H |
| LOG-9 | gateway `pending` | Never cleaned or failed. | Memory growth, 30 s hangs after disconnect. | H |
| LOG-17 | `StateCache` | Plain map, multithreaded. | Torn reads or `ConcurrentModificationException`. | H |
| LOG-18 | `HaProjectionStore` | Attributes dropped. | Restored state loses brightness and colors. | M |
| LOG-19 | realtime queue | Drop-oldest is unconditional. | "Critical" events can be dropped. | M |
| NEW-10 | `GroupsService.view` | Reads write. | `GET` mutates data; a crash can empty a group. | H |
| LOG-11 | `RoutinesService.remove` | Deletes row even if the HA delete job wasn't queued. | Orphan HA scripts. | M |
| LOG-12 | `ConfigJobService.prune`/`recoverInterrupted`, `AdminService.prune*` | Return 0 always. | Counts invisible to callers and logs. | L |
| LOG-13 | `RestoreApply` | No rollback. | Possible total DB loss on I/O failure. | H |
| LOG-14 | `isNewer` | String-compares pre-releases. | Wrong update decisions for `rc.N`. | M |
| LOG-15 | `App.kt`/`Main.kt` | `phase12.start()` twice. | Duplicate maintenance loops. | M |
| LOG-16 | `StatusPages` | 422 for all `BadRequestException`. | Contradicts its comment and likely the API contract. | M |
| LOG-20 | `GroupsService:60-61`, `AskAliceService:214,218`, `PermissionService:116`, `HistoryService:95` | Compiler proves the guarded branch is dead. | Intended fallbacks never run. | M |
| LOG-21 | `HaCompile:231` | Redundant `else` in exhaustive `when`. | A new enum case won't be flagged. | L |
| NEW-17 | config jobs | Dedupe keys are global. | One household's enqueue deletes another's pending job. | H |
| NEW-14 | `RealtimeHub.sweep` | Never called. | Revoked sessions keep receiving events. | H |
| NEW-15 | realtime activity/alerts | No per-device visibility filter. | Members denied a device see its activity over the socket. | M |
| NEW-24 | quiet hours | Unvalidated input, then `toInt()`. | Malformed value makes every non-urgent push "failed". | M |
| NEW-27 | wide-row updates | Stale snapshot rewrites every column. | Concurrent edits silently overwritten. | M |
| PRM-1 | `resolveSensitivity` | First match wins. | Specific rule ignored when a generic one precedes it. | H |
| HHD-1 | `Role.fromWire` | Throws in the hot path. | One bad role row gives a user 500s everywhere. | M |
| HHD-2 | `updateMember` | Always replaces `expires_at`. | Role change can clear a guest expiry. | M |
| SYN-4 | `testConnection` | `ok = true` for 401. | A bad token reports success. | M |
| SYN-5 | `ha_connections` | Status never written. | Status endpoint always "disconnected". | M |
| ENG-2 / HST-1 | epoch parsers | 10-digit seconds parsed as milliseconds. | Wrong time range. | M |
| ENG-3 | `pattern()` | Fixed 24-hour days. | One-hour error across DST. | M |
| SMT-1 | `sceneChips` | Name is the id. | UI shows ids as names. | M |
| GRP-1 | groups | `available` means "has primary". | Wrong availability. | M |
| HAD-2 | thing id | Derived from the ref. | Merge or split orphans stats, favorites, order. | M |
| CMP-2 | `power_over_limit` | Fires at 90%. (H) | Alerts earlier than named. | M |
| CMP-3 | compile | Silent defaults for missing fields. | Invalid automations compile. | M |
| NEW-30 | dead code | No callers for `RealtimeHub.sweep`, `ThingsService.favoriteList` (also compares ids with refs), `ModeMirrorService.consumePushEcho`/`helperState`, `GroupsService.resolveMembers`, `ThingBuilder.buildThingsIncremental`, the `Normalizer` object, the sealed `Plan` interface, `PresenceService.persons()`, plus the HA classes in HA-1. (V) | Maintenance burden; latent bugs. | M |

---

## 4. Kotlin-feature and library gap tables

### 4.1 Language features not used

| Feature | Where it should be used | Evidence |
|---|---|---|
| `sealed interface` / sealed results | Routine steps, command outcomes, update check, restore result, idempotency result, automation definition | `Pair<DeviceCommand?, Boolean>`, `Pair<Boolean, String>`, `Triple<…>`, string `type` fields, an unused `Plan` hierarchy |
| `enum class` for states | Sync status, run/step state, command action, job operation, WS types, update kind, permissions | `"pending"`, `"synced"`, `"device.control"`, `"command.confirmed"`, `"voice.expose"` |
| `@Serializable` DTOs | Device views, job payloads, routine steps, update marker, worker heartbeat, Anthropic request | `DeviceRoutes.toViewJson` (~60 `put`s), `buildJsonObject` plus `as?` ladders |
| Immutability + `copy` | `DeviceCommand`, `CommandStore.update` | Mutable data class mutated through a lambda |
| `kotlin.time.Duration`/`Clock` | All time math | About 40 raw millisecond constants |
| `HexFormat` | SHA-256 hex in 5 places | `joinToString("") { "%02x".format(it) }` |
| `singleOf(::X)` | `ServerModule` | 9-argument positional `get()` |
| Extensions / context | `Caller` creation, error factories | Seven route files rebuild `Caller` by hand |
| `require`/`check`/`error` | Input and state checks | Manual `throw IllegalArgumentException`; a business error `idempotency_key_reuse` thrown as one |
| Collection idioms | `GroupsService`, `ActionService`, `ThingBuilder` | Manual accumulation |
| Value classes | `HouseholdId`, `UserId`, `EntityId`, `ConnectionId` | Everything is `String`; many same-typed parameters |
| `lazy`, delegation | Overrides loading, service lookup | `@Volatile` flag plus `synchronized` |
| Structured concurrency | Background loops | 5+ unmanaged scopes; raw threads |
| `use`/`AutoCloseable` | `HaAdminApi`, HTTP clients | `runCatching { api?.close() }` |
| Explicit imports | About 211 inline fully-qualified names | `alice.ha.HaServiceCallInput`, `kotlinx.coroutines.runBlocking` |
| Style | Enum naming | Lower-case entries in `PushResult`, `EntityRole`, `ThingKind`, `TimeOfDay` |

### 4.2 Hand-written code that a library covers

| Hand-written | Replace with | Location |
|---|---|---|
| CORS, request id, CSRF, session cookie | Ktor `CORS`, `CallId`, `Sessions`/`Authentication` | `http/*` |
| Rate limiting (4 implementations) | One library (Ktor rate limit, Bucket4j) | `RateLimiter`, `PushService`, `AskAliceService`, `RealtimeHub` |
| AES-GCM (3x) and RSA-OAEP | Google Tink | `Sealed`, `Secrets`, `BackupService` |
| Hex / SHA-256 | `HexFormat`, one helper | 5 files |
| Semver | A semver library | `UpdateSources.isNewer` |
| Env-over-file config merge | Hoplite env source | `ConfigLoaderFactory` |
| Command store | SQLDelight table | `InMemoryCommandStore` |
| DB lock | Pool or single-writer dispatcher | `Database` |
| Anthropic HTTP and JSON | SDK or Ktor client plus `@Serializable` | `AnthropicInterpreter` |
| WS request matching | `CompletableDeferred` multiplexer | `HaWebSocketGateway.pending` |
| Retry/backoff (3 copies) | One shared helper | `ManagedConnection`, `ConnectionManager`, `reconnectWithBackoff` |
| Scheduling | One lifecycle registry | `Main`, `Phase12Coordinator`, `BackupService`, `ConfigJobService`, `HaEventBridge`, `RoutinesService` |
| Any-to-JSON conversion | One shared converter | 9 named copies plus 6 inline blocks |
| Metrics JSON | Micrometer with Ktor | `AdminService.metrics` |

### 4.3 Anti-pattern counts (main code, lower bounds)

| Pattern | Count |
|---|---|
| `runBlocking` | 34 |
| `!!` | 50 |
| `Thread.sleep` | 5 |
| Clock calls bypassing `TimeProvider` | 29 |
| `catch (e: Exception)` / `catch (Throwable)` | 14 / about 10 |
| `GlobalContext` lookups | 13 |
| `"conn-1"` literal | 34 |
| `Map<String, Any?>` | 51 |
| `as?`/`as` casts | about 204 |
| Fully-qualified names in bodies | about 211 |
| Hand-interpolated JSON sites | at least 8 |
| `Audit.write(db.raw …)` bypassing the lock | 24 sites |
| Any-to-JSON converter copies | 9 named plus 6 inline |
| Mode list definitions | 6 (`MODE_HELPER_ENTITY` 3) |
| Hardcoded sensitive-action sets | 3 |
| `Caller` types | 4 |
| Live-HA tests that pass when HA is absent | 6 files |
| Compiler warnings | 27 |
| Tests | 201 (core 3, ha 43, server 140, worker 15) |

---

## 5. Organization and structure

| Area | Problem | Suggested fix |
|---|---|---|
| Naming | `Phase12Coordinator`, tests `Phase9/10/13/14`, `HaPhase6`, `SmartPhase8Completion`, `ConfigJobServicePhase11Test` | Rename by purpose |
| Package layout | `routes/` mirrors every domain package; DTOs and mappers live in route files | One package per feature |
| `ha` package | 30 files in flat `alice.ha` | Split `gateway`, `inventory`, `things`, `sync` |
| Module boundaries | README says nothing outside `ha/` speaks HA, but `ha/` holds domain logic and a `Database` dependency | Move domain logic out |
| Duplicates | Two `ConfigOps`, two `ModeMirror`, two `ConnectionConfig`, three HA clients, three AES-GCM, three retry loops, two event-type families, any-to-JSON copies | Consolidate |
| `App.kt` | 241-line locator | Koin module per feature that also registers routes |
| Build files | `build.gradle.kts` copied four times; test deps not in the catalog | Convention plugin, `jvmToolchain(21)` |
| Tooling | No detekt/ktlint/spotless; no dependency automation | Add and baseline |
| Docs | README says "phase 0"; five overlapping docs | One living status doc |
| Repo hygiene | `application.yaml` git-ignored but read by the loader | Provide an example |
| Schema | 72 `SELECT *`, no `STRICT`, no `CHECK` | Explicit columns, constraints |
| Schema vs code | `commands`, `idempotency_keys`, `command_attempts`, `ha_entities`, `jobs` have no live users | Wire or drop |
| Dead code | See NEW-30 | Delete or wire |

---

## 6. Security, robustness, operations

| ID | Finding | Sev |
|---|---|---|
| SEC-1 | First-run setup code logged in plaintext (SRV-7). | M |
| SEC-2 | `docker-compose.yml` sets `ADMIN_SEAL_PRIVATE_KEY`; the worker reads `CONFIG_WORKER_PRIVATE_KEY(_FILE)`. The worker cannot decrypt admin tokens as shipped. | H |
| SEC-3 | Compose mentions `HA_URL`/`HA_TOKEN`; nothing reads them. | H |
| SEC-4 | `Dockerfile` runs as root, no `HEALTHCHECK`, copies a prebuilt dir; the compose healthcheck uses `bash -lc curl`, which may be missing in the image (unverified). | M |
| SEC-5 | `trustProxy` trusts `X-Forwarded-For` blindly; the first entry is used (NEW-22). | M |
| SEC-6 | `X-Request-Id` echoed unvalidated. | M |
| SEC-7 | Restore has no rollback and no schema check (DOM-8). | H |
| SEC-8 | `allowUnsigned` switch; marker JSON hand-built. The reference `scripts/update-supervisor.sh` does **not** verify `artifactSha256` (the download and checksum lines are commented-out examples), see NEW-35. | M/H |
| SEC-10 | `SecureRandom()` per call; default-charset string conversions. | L |
| SEC-11 | `BackupService.unpack` swallows `Throwable` per key, hiding I/O errors. | M |
| SEC-12 | Lockout can be forced by anyone holding a credential id and discloses account existence. | L |
| NEW-13 | HA token stored in plaintext; `Secrets` unused. | H |
| NEW-14 | WebSocket sessions never revalidated. | H |
| NEW-16 | Backups (container volume, silent no-encryption, WAL-less fallback, whole-DB download). | H |
| NEW-21 | No request body size limits. | M |
| NEW-22 | Spoofable `X-Forwarded-For`. | M |
| NEW-23 | Unsalted SHA-256 over 50-bit recovery and invitation codes. | M |
| NEW-26 | `Audit.write(db.raw …)` at 24 sites bypasses the lock and transactions. (V) | M |

---

## 7. Testing and CI

| ID | Sev | Observation |
|---|---|---|
| TST-1 | H | The six "live HA" tests (`HaIntegrationTest`, `HaHistoryIntegrationTest`, `HaDevicesIntegrationTest`, `HaCommandIntegrationTest`, `HaRealtimeIntegrationTest`, `HaPhase6IntegrationTest`) start with `val url = System.getenv("HA_URL") ?: return`, **before** `Assumptions.assumeTrue`. Without the variables they pass instead of skipping, so CI counts them green. The worker's `HaLiveIntegrationTest` uses `assumeTrue` correctly. (V) |
| TST-2 | M | `HaCommandIntegrationTest` calls the gateway directly, never `CommandExecutor`, prints the context id and asserts nothing about the result. (V) |
| TST-3 | M | Weak assertions: `turn_on succeeds` accepts `CONFIRMED`, `TIMED_OUT` or `ACCEPTED`; `recoverInterrupted` asserts `count >= 0`; cancel asserts `assertNotNull`. (V) |
| TST-4 | M | `runTest` used 0 times despite the dependency; 80 `runBlocking` blocks and about 25 real `delay` calls (50 to 250 ms) in hub and routine tests. (V) |
| TST-5 | M | Test setup repeated in about 34 places; `HealthTest` and others use the full production `serverModule()`, so they inherit the fake gateway. (V) |
| TST-6 | M | No test names: `BackupService`, `UpdateService`, `EnergyService`, `HistoryService`, `AlertsService`, `ActivityService`, `AdminService`, `InsightsService`, `SupportService`, `OperatorService`, `AskAliceService`, `HaEventBridge`, `ConfigJobApplier`, `ConfigSyncService`, `RestoreApply`, `RateLimiter`, `Secrets`, `CommandStore`. Some are hit through HTTP (one file each for `/backups`, `/updates`, `/energy`, `/history`, `/admin/audit`, `/admin/health`, `/operator`, `/admin/support`). (V, grep) |
| TST-7 | M | No test file contains `api/v1/activity`, `/alerts`, `/insights`, `/ai/interpret`, `/permissions` or `/notifications`. (V, grep; permissions may be tested under another prefix) |
| TST-8 | L | About 4,500 test lines against about 20,000 main lines; core has 3 tests. |
| TST-9 | M | Server tests cannot detect the unwired runtime (SRV-1, NEW-11, NEW-12) because they use `FakeGateway`; no test exercises the executor with real `JsonPrimitive`/`JsonArray` parameters or a dispatch target (NEW-1, NEW-2); no guest or deny-policy test through the command route (NEW-5); no `toggle`, `set_color` or sensitivity-gating test (NEW-3, NEW-6, NEW-4); no migration test; no multi-household tests for `ThingsService` or `HaEventBridge`; no concurrency tests for `CommandExecutor`, `StateCache` or `RealtimeHub`. |
| CI | — | `backend-kt.yml` builds, tests and runs a native-smoke job. No lint, no dependency or vulnerability scan. |

---

## 8. Compiler warnings (27, from the build)

| File | Warning |
|---|---|
| `HaWebSocketGateway.kt:110,115` | Unnecessary safe call on non-null `JsonObject` |
| `NameCleaner.kt:34,45` | Unnecessary `!!`; Elvis on non-null |
| `Normalizer.kt:130,132,138` | "This cast can never succeed" x3 |
| `AskAliceService.kt:214,218` | Elvis on non-null `Role` and `List<String>` |
| `AuthService.kt:232` | Redundant conversion call |
| `BackupService.kt:500` | Elvis on non-null |
| `Expectations.kt:46` | Redundant cast x2 |
| `GroupsService.kt:60,61,82` | Unnecessary `!!` x3; "Condition is always true" |
| `HistoryService.kt:95` | Unnecessary `!!` on `Pair` |
| `PermissionService.kt:116` | Elvis on non-null |
| `HaCompile.kt:231` | Redundant `else` in exhaustive `when` |
| `YubicoPasskeyEngine` | 6 deprecations from the Yubico Java API |
| `ConfigJobServicePhase11Test.kt:38` | Unnecessary `!!` |

Several of these mean intended logic never runs.

---

## 9. Suggested order of work

| # | Action | Fixes |
|---|---|---|
| 1 | **Wire the whole HA runtime:** a connection per household (`connect`), feed `StateCache`, normalize and publish entity events, update `ha_connections.status`, replace `FakeGateway` in DI, delete the dead clients. | SRV-1, HA-1, HA-2, NEW-11, NEW-12, SYN-5 |
| 2 | **Fix command dispatch before step 1 reaches users:** add the entity target, pass `JsonElement`s through a real converter instead of `toString()`, fix `toggle` and `set_color`; add one test per verb against a gateway that validates the payload. | NEW-1, NEW-2, NEW-3, NEW-6 |
| 3 | **Fix authorization:** tie `entityId` to the URL's thing, re-check policies on undo, enforce sensitivity from one place (with the specificity fix), reconcile the three hardcoded sets. | NEW-4, NEW-5, NEW-7, PRM-1 |
| 4 | **Add real migrations**, read `user_version`, fail loudly, stamp only on success; add CHECK constraints, an `audit_log` household index, and purge jobs for sessions and challenges. | CORE-1, SQL-1 to SQL-3 |
| 5 | **Security cleanup:** encrypt the HA token with `Secrets`; revalidate WebSocket sessions; filter activity/alert events by visibility; trusted-proxy handling; request size limits; salt or strengthen recovery-code hashing. | NEW-13, NEW-14, NEW-15, NEW-21, NEW-22, NEW-23 |
| 6 | **Backups:** store next to the DB or on a declared volume, fail loudly on a bad key, no live-file fallback, atomic writes, schema check, per-household export. | NEW-16, BKP-* |
| 7 | **Cache the inventory per connection** (invalidate on registry events); make activity, alerts, groups, energy, actions and event handlers use it; remove per-row `runBlocking`. | DOM-2, NEW-9, NEW-19 |
| 8 | **Replace `"conn-1"` and `firstOrNull()` household guesses** with real ids; decide whether multi-household is supported. | DOM-3, HHD-4, SQL-5 |
| 9 | **Remove `runBlocking` and `Thread.sleep`**; one lifecycle registry for background jobs; WebSocket buffering, ping and frame limits; make push delivery asynchronous and fix provider result handling. | SRV-4, SRV-6, NEW-8, NEW-18, NEW-24 |
| 10 | **Fix shared-state bugs:** global dedupe keys, `getSession` write path, `Audit.write(db.raw)`, stale wide-row updates, GET-writes. | NEW-17, NEW-20, NEW-26, NEW-27, NEW-10 |
| 11 | **Persist commands and idempotency** in the existing tables with real per-entity locking. | DOM-1, LOG-3, LOG-4 |
| 12 | **Fix the tests:** make live tests skip properly, use virtual time, cover the untested services and routes. | TST-1 to TST-9 |
| 13 | **Typed models** instead of hand-built JSON and `Map<String, Any?>`; one converter; one mode list; one template definition shared by server and worker. | DOM-6, CMP-1, RTE-5 |
| 14 | **Fix deployment config:** env names, worker key, remove `HA_URL`/`HA_TOKEN`, non-root image. | SEC-2 to SEC-4 |
| 15 | **Restructure by feature**, rename `Phase*`, convention plugin, `singleOf`, detekt/ktlint, then fix the 27 warnings and delete dead code. | sections 5, 8, NEW-30 |
| 16 | **Quick wins, do early:** return typed `@Serializable` responses instead of mixed maps (notifications, rollback, operator devices), move the two `HaCompileTest` tests into the class, fix the PATCH semantics and the hardcoded `mode = "home"`, add `Access-Control-Allow-Headers` if the frontend is cross-origin. | NEW-31, TST-10, NEW-37, NEW-38, NEW-43 |
| 17 | **Make the update flow real or mark it unsupported:** a supervisor that downloads, verifies the checksum and rolls back on failure; CI jobs that can fail; stop storing invitation codes in plaintext and purge challenges. | NEW-35, NEW-34, SQL-3 |
| 18 | **Fix routine execution:** register the run before launching it, prune old runs on a schedule, report real step errors. | NEW-32, NEW-33 |
| 19 | **Make the backend ready for native clients:** configurable WebAuthn origins and rpId (Android `apk-key-hash` origin, a real HTTPS domain with `assetlinks.json`), WebSocket ping and idle timeouts, close sockets when a session is revoked, make push token cleanup mobile-safe. | AND-1 to AND-6, PSK-2, NEW-8, NEW-14 |
| 20 | **Restore parity with the TypeScript backend where the Kotlin port diverged:** step-up only for `lock.unlock` and `lock.open` by default, enforced through the household rules, most-specific rule wins; then add contract tests against the TS oracle. | NEW-44, NEW-4, PRM-1, AND-7 |

---

## 10. Findings from the final pass (routes, models, worker API, scripts, CI, tests)

### 10.1 Defects in running behavior

| ID | Sev | Where | Finding | Status |
|---|---|---|---|---|
| NEW-31 | C/H | `NotificationRoutes`, `UpdateRoutes`, `OperatorRoutes`/`OperatorService.devicesOf` | These handlers pass a `Map` with values of different types to `call.respond`. Ktor then cannot pick a serializer and fails with "Serializing collections of different element types is not yet supported". A throwaway Ktor test with the same shapes returned **500** for `mapOf("items" to list, "unread" to 3)` and for a `Map<String, Any?>` of Boolean, String and an object, and 200 for a single-type map. Affected: **`GET /api/v1/notifications` (always, even when empty)**, **`POST /api/v1/updates/{id}/rollback`**, and the operator devices list when it has at least one device (that one I reasoned from the same mechanism and did not probe). No test touches these routes (TST-7, TST-17). | V (probe) for the first two, R for the third |
| NEW-32 | H | `RoutinesService.start`/`drive` | `start()` launches the run coroutine on `Dispatchers.Default` and only afterwards stores `live[runRow.id] = Live(job)`. `drive()` begins with `val l = live[runId] ?: return`. If the coroutine runs first, it returns silently and the run stays `running` until the next restart. | R |
| NEW-33 | M | `RoutinesService` | (a) Per NEW-12, every device or scene step waits 5 s for confirmation and ends `TIMED_OUT`, which the routine counts as a failure, so routines report `failed` in production. (b) `deleteOldCompletedRoutineRuns` runs only inside `resumeInterrupted()` at startup, so old runs are never pruned while the server stays up. (c) `RoutineRunEvent` ("routine.finished") has no handler in `RealtimeHub.onEvent`. (d) The "did the commands fail" condition is copy-pasted between the scene and device branches. (e) `runCatching { … }.getOrNull()` replaces the real error with "Failed to run action". (f) `save()` rewrites the whole steps JSON after every step. | V (reading) |
| NEW-34 | M | `AuthModels.ChallengeData`, `takeChallenge` | `ChallengeData(inviteCode = …)` is stored as JSON in `webauthn_challenges.data_`, so invitation codes sit in **plaintext** in the database, although invitations themselves are stored only as hashes. `takeChallenge` only sets `used_at` (an `UPDATE … RETURNING`) and `deleteExpiredChallenges` has no caller, so these rows, and the codes in them, are never removed. They are also in every backup. | V |
| NEW-35 | H | `scripts/update-supervisor.sh`, `.github/workflows/backend-kt.yml` | The "reference" supervisor stops the service, **does not download or verify anything** (the download and `sha256sum -c` lines are comments), deletes the marker, restarts the service and prints "handoff complete". The server then waits for a new version that never arrives and, after 30 minutes, requests a rollback through the same script. The update install flow therefore cannot work as shipped. In CI, `native-image … \|\| true` and the frontend `bun run lint \|\| true` / `bun run build \|\| true` can never fail, and the native job never runs the binary, so the README's "GraalVM-ready" claim has no check behind it. The contract e2e job is manual only, and `scripts/contract-e2e-env.md` states that no Kotlin e2e or contract harness exists. | V |
| NEW-36 | M | worker `HaAdminApi` | `generateBackup` swallows every error and returns `backupId = backup_job_id ?: ""` with `sizeBytes = 0`, so a failed Home Assistant backup is reported as done, and a job id is stored where a backup id is expected (later restore or delete would use the wrong id; HA behavior unconfirmed). `backupInfo` is a stub that always returns `exists: true`, so every HA backup "verifies" as passed. `deleteBackup` swallows errors. `automationEntityId` runs right after `reload("automation")` and may find nothing, so the enabled/disabled state is then silently not applied. `automationEntityId` and `automationEnabled` each download all states (a `config.verify` with N automations downloads N times). A new `HttpClient` is created per instance (per job). `pending` is a plain map. `baseUrl.replace("http","ws")` is a third copy of HA-4. | V (reading), H for the id semantics |
| NEW-37 | M | `HouseholdRoutes` | `PATCH /household` always returns `mode = "home"`. `PATCH /members/{id}` passes `body.expiresAt` (null when absent), so sending only a role **clears a guest's expiry** (confirms HHD-2). An unknown role string makes `Role.fromWire` throw, so `PATCH /members/{id}` and `POST /invitations` return 500 instead of a validation error. `expiresInHours` and `guestAccessHours` are not bounded (a negative value creates an already-expired invitation). The timezone is passed to the service unvalidated (HHD-5). | V |
| NEW-38 | M | `GroupRoutes`, `RoutineRoutes`, `SceneRoutes`, `ModeRoutes` | PATCH "provided or null" semantics are inconsistent. `GroupRoutes` treats the icon as provided whenever **any** field is present, so renaming a group clears its icon. `RoutineRoutes` and `SceneRoutes` treat `icon != null` (and `description != null`) as provided, so those fields can never be cleared. `ModeRoutes` builds `ModeActor(it, it)`, so `displayName` is the user id. | V |
| NEW-39 | M | `FavoriteRoutes`, `ThingsRoutes`, `ModeRoutes` | `FavoritesResponse(val devices: List<alice.ha.Thing>)` puts the internal domain `Thing` on the wire (entity ids, diagnostics, controls) and only checks that **some** entity of a thing is visible, so a caller sees entity ids and names of entities they are denied. `GET /household/mode` runs `insights.suggestion` and `mirror.status` on every call (an inventory build plus a full state fetch). `ThingsRoutes` holds a third copy of the entity JSON builders (RTE-3) and a `jAny` copy. | R |
| NEW-40 | L/M | `BackupRoutes`, `UpdateRoutes` | `BackupListResponse` is declared twice (service file and route file). `POST /updates/{id}/rollback` turns a malformed body into `restoreData = false` through `runCatching`, so a user asking for a data restore silently gets a rollback without it. `POST /backups` treats any `kind` other than `"ha"` as an app backup. `PUT /backups/settings` cannot clear `nasPath`. `GET /backups/{id}/download` loads the whole database into memory with `respondBytes`. | V |
| NEW-41 | L | `CommandTypes.kt`, `CommandStore.kt` | `InvalidTransitionException` is never thrown. `FailureCode.UNKNOWN_ENTITY`, `HA_REJECTED` and `NOT_CONFIRMED` are never used: an unknown entity id is never rejected (links to NEW-5) and every HA error is reported as `HA_UNREACHABLE`. `InMemoryCommandStore` never evicts, so memory grows with every command (each stored and returned as a copy). `DeviceCommand` is a data class with `var` fields. | V |
| NEW-42 | L | `PasskeyModels.kt` | `AuthenticatorSelection` defaults (`residentKey = "preferred"`, `requireResidentKey = true` with `EncodeDefault.NEVER`) disagree with the engine (`REQUIRED`), and `requireResidentKey` can never be emitted. Wire DTOs and engine domain types are in one file. No size limits on the base64 fields of the client responses (NEW-21). | V |
| NEW-43 | M (H) | `CorsPlugin` | The preflight answer sets `Access-Control-Allow-Methods` and `Max-Age` but **never `Access-Control-Allow-Headers`**. A browser must see it for a cross-origin `POST` with `Content-Type: application/json` or a custom header (`X-Requested-With`, `Idempotency-Key`). If the frontend calls the backend cross-origin (default config: frontend on port 3000, backend on 3002) its JSON POSTs would fail the preflight. I did not check whether the frontend uses a same-origin proxy, and no test covers preflight. Other CORS/CSRF notes: CSRF is skipped when there is no session cookie (login relies on the challenge) and for bearer-token (operator) calls; any non-empty `X-Requested-With` value passes when `Origin` is missing; `OPTIONS` is answered for every path. | R, H |

### 10.2 Tests (all test files read; the earlier TST items stand)

| ID | Sev | Finding |
|---|---|---|
| TST-10 | H | **Two tests never run.** In `HaCompileTest.kt` the class closes at line 55, but `compiles arrive and leave triggers with context` (line 57) and `compiles power over limit trigger with context` (line 87) are top-level functions. JUnit 5 does not run top-level or static methods, so they are silently skipped, and the "201 tests" count (from `@Test` occurrences) overstates what executes. (V, file structure) |
| TST-11 | M | Tautologies: five `ThingsServiceTest` tests (`rename`, `setHidden`, `merge`, `split`, `setEntity`) end with `assertTrue(true)`; `CommandExecutorTest.undo returns null…` ends with `assertTrue(true)`; `RealtimeWsIntegrationTest.unauthenticated websocket is rejected` asserts `closed \|\| true`; `Phase13RoutesTest` backup create asserts `status in 200..599`; `HaLiveIntegrationTest` asserts `jd.status == "done" \|\| "failed"`. (V) |
| TST-12 | M | `Phase14RoutesTest` "updates settings require step up and validate window" sends the PUT with a cookie but **no `Origin` header**, so the CSRF plugin answers 403 and the test passes for the wrong reason; the window validation is never reached. The same test file accepts any of several failure codes for `schedule`, and no test reaches install or rollback. (V) |
| TST-13 | M | `PermissionsTest` is named "denies guests without an allow…" but only tests a guest **with** an allow and a member with a deny; the no-allow denial, `resolveSensitivity` and `PermissionService` are untested. (V) |
| TST-14 | M | Tests that mask production defects: `HaRealtimeIntegrationTest` publishes the `EntityStateChangedEvent` itself (nothing does in production, NEW-11); `RealtimeHubPhase7ExtraTest` tests handlers for `ConnectionConnected`/`ConnectionDisconnected`, events no production code publishes; `RealtimeHubTest.sweep` passes `auth = null`, so the session-revocation branch (NEW-14) is untested; every `FakeSocket.bufferedAmount()` returns 0; `HaConnectionAdminServiceTest` seeds `"enc-op"` placeholders, so plaintext token storage (NEW-13) is invisible and `putConnection`, `testConnection`, `deleteConnection`, `resync` are untested; `Phase9` and `Phase10` only check command counts, never states (the commands time out, NEW-12), and the routine tests use only mode and delay steps. (V) |
| TST-15 | M | `PushServiceTest` only covers registration; `deliver` (suppression, quiet hours, rate limit, removal of gone devices) and both providers are untested. `AuthServiceTest` (17 tests, read by names) has no account-lockout test. `Phase14ServiceTest`'s Ed25519 test verifies with the JDK directly, not the production `verifyEd25519`, and the `isNewer` test lacks the `rc.10` versus `rc.2` case (DOM-7). `ExpectationsTest` has no `set_color` or `toggle` case. `ConfigJobServicePhase11Test` checks `prune` removes rows but not the returned count, and has no cross-household dedupe case (NEW-17). (V) |
| TST-16 | M | `HaLiveIntegrationTest` (worker): the fallback reads `File("../backend/.env.test")`, which from the module directory resolves to `backend-kt/backend/.env.test` (the TS backend is two levels up); several assertions sit inside `if (didScript) { if (js.status == "done") … }`; `db.read` is called **after** `db.close()` (it would throw when HA is configured); `helper.ensure_mode_select` creates a persistent helper in the real Home Assistant that is never removed. (R) |
| TST-17 | M | Routes with no test at all by URL: notifications (a likely-always-500 route, NEW-31), activity, alerts, insights, `ai/interpret`, permissions, favorites mutation, groups, scenes, routines routes, household/members/invitations routes, command POST. `DeviceRoutesTest` "returns empty for new user" only checks status and one key, against the fake gateway. (V, grep) |
| TST-18 | L | `registerCookie`/`registerAndCookie` is copied in five test classes (and inlined three times in `AuthRoutesTest`); the in-memory DB plus seed block is repeated about 34 times. `ConfigTest` calls `ConfigLoaderFactory.load()` with the real environment and working-directory YAML, so it fails if `PORT`, `DATABASE_URL` or similar are set. `FakeHaAdminApi` extends an open class whose constructor builds a real `HttpClient`, and its overridden `close()` never closes it. |
| TST-19 | L | Duplicate tests: `HaDevicesIntegrationTest` and `HaPhase6IntegrationTest` do the same thing, and `HaPhase6IntegrationTest` never calls a device route despite its name. `HaHistoryIntegrationTest` asserts nothing (only `println`). `FacetValuesTest` accepts either of two outcomes (`value == "closed" \|\| ambiguous`) and contains an indecisive comment. `ha/ConfigOpsTest` uses `try`/`assertTrue(false)`/`assertTrue(true)` instead of `assertFailsWith`, and `Normalizer`, `DriftDetector` tests cover code that production never calls. |
| TST-20 | L | Worker tests are the best in the project: they cover retry versus permanent failure, claiming, and recovery. Weak spots: `ConfigWorkerTest` accepts `failed \|\| pending`, and the tests use the real clock. `VirtualAuthenticator` is a good helper but covers only ES256 and "none" attestation. |

---

### 10.3 Schema findings (`Identity.sq`, `Core.sq` read in full)

| ID | Sev | Finding |
|---|---|---|
| SQL-7 | M | **Tables that only grow.** There is no delete query, or none with a caller, for: `notifications`, `alerts` (cleared ones stay), `automation_runs`, `sessions` (expired or revoked), used `recovery_codes`, `invitations` (used, revoked, expired), `query_history`, `insight_dismissals`, `webauthn_challenges`. `routine_runs` are pruned only when `completed`, and only at startup (NEW-33). `backup_records` and `update_records` have no retention either. (V) |
| SQL-8 | H (multi-household) | **Per-connection tables are not household-scoped and do not reference the connection.** `entity_settings` has primary key `(connection_id, entity_id)`, `thing_overrides` is `UNIQUE (connection_id, ref)`, and `entity_overrides` has primary key `(connection_id, entity_id)`; none includes `household_id`. All code writes the literal connection id `"conn-1"`, so two households with the same entity id (for example `light.kitchen`) share one row: one household's power limit, voice exposure, rename or role override overwrites the other's, and `getSettings(connectionId, entityId)` reads it without a household filter. Real connection ids are `hac_<ULID>` (from `putConnection`), so these rows never relate to an actual `ha_connections.id`, and no table has a foreign key to `ha_connections` (`entity_settings`, `thing_overrides`, `entity_overrides`, `thing_links`, `favorites`, `group_members`, `person_links`, `ha_entities`, `device_policies`, `alerts`). Deleting or replacing a connection leaves all of it behind and the next Home Assistant inherits it. (V) |
| SQL-9 | M | **Schema and model disagree.** The `commands` table has no `group_id` column although `DeviceCommand.groupId` exists, so moving commands into the table (priority 11) needs a schema change. `backup_records.schema_version` exists but `BackupService` always inserts null. `commands.failure_code`/`failure_message` versus the model's `Pair<FailureCode, String>`. `webauthn_challenges.data` is exposed as `data_`. |
| SQL-10 | M | **Missing indexes.** `groups`, `thing_overrides` and `entity_overrides` are queried by `household_id` with no index on it; `config_jobs.dedupe_key` has no index (the dedupe delete scans); `operators.token_hash` has no index and `selectOperatorByTokenHash` runs on every operator request; `sessions.revoked_at`/`expires_at` have none. |
| SQL-11 | M | `selectActiveSupportSession` filters on `ended_at IS NULL` but not on `ends_at`, so every reader must first run the `expireSupportSessions` UPDATE (this is the cause of SUP-1: reads that write). Adding `ends_at > ?` to the query would remove the need. |
| SQL-12 | L | `backup_records`, `support_sessions`, `entity_attribute_log` and `operators`-related tables have no foreign key to `households`; `routine_runs.user_id` has none to `users`. `invitations.created_by` and `used_by` reference `users(id)` with no `ON DELETE` rule, so a user who created an invitation cannot be deleted (SQL-6). |
| SQL-13 | L | `insertHousehold` has no timezone parameter, so a new household is `UTC` until an admin patches it. Backup windows, update windows, energy "today" and smart ordering all depend on it, so native onboarding should set it. |
| SQL-14 | L | `jobs` with `insertJob`/`countPendingJobs`, and the test-only queries `selectAuditLogByAction` and `selectAllSessionTokenHashes`, live in the production schema; none has a caller in main code. |
| SQL-15 | L | `selectAllAutomations` and `selectAllPersonLinks` are unfiltered and used by `HaEventBridge`, so a person-entity event is matched against the links of **every** household (a `person.x` id that two households share conflates them); this adds to DOM-3. |

### 10.4 Parity with the TypeScript backend (`backend/src/modules/devices/commands/sensitivity.ts`)

| ID | Sev | Finding |
|---|---|---|
| NEW-44 | H | The Kotlin port diverges from the TS oracle on step-up. **TS:** default sensitive operations are only `lock.unlock` and `lock.open`, the executor asks the household policy (`sensitivity.isSensitive`), and `resolveSensitivity` lets a device-class match beat a generic one. **Kotlin:** the executor ignores the household policy (NEW-4); its hardcoded set is `unlock`, `lock` and `open` for **every domain**, so locking a lock and opening a cover (blinds, garage door) both demand a fresh passkey; the Kotlin default rule list also marks `lock.lock` and alarm arm/disarm sensitive; and `resolveSensitivity` takes the first match, not the most specific (PRM-1, a port bug). The Android architecture doc says the backend "requires a fresh passkey to unlock and never for locking", which the Kotlin backend contradicts. (V) |

### 10.5 What this means for the native Android (and later iOS) clients

CORS is enforced only by browsers, so **NEW-43 matters for the web `frontend/` only**, not for the native apps. For native clients the findings below matter instead. The Android module today uses a mock repository, so none of this has been exercised yet; `android/docs/architecture.md` states the target is the same REST and `/ws` contract as the TypeScript backend.

| ID | Sev | Finding |
|---|---|---|
| AND-1 | H | **Passkeys cannot work from Android as configured.** The engine accepts one origin (`webauthn.origin`, default `http://localhost:3000`) and one `rpId` (default `localhost`). Android passkeys need a real HTTPS relying-party domain that publishes `/.well-known/assetlinks.json`, and the origin the server sees from Android is `android:apk-key-hash:<hash>`. Sign-in, step-up (unlocking, member management, backups, updates) and registration would all fail with `invalid_credentials`. iOS reports `https://<rpId>` as the origin, so it works once `rpId` and `origin` are the real domain. `VirtualAuthenticator` (ES256, "none" attestation, one origin) cannot catch this. (R; the Android and iOS origin behavior is platform knowledge, not checked in this repo) |
| AND-2 | H | **Contract points the app relies on that the backend does not honor:** sockets are "closed server-side on revocation" (NEW-14: `sweep()` is never called); an idempotency key per tap (in memory, lost on restart, a reused key with a different payload gives a 500, DOM-1/LOG-4); undo within ten minutes (needs the previous state, which is always null, NEW-12); locking never needs a passkey (NEW-44); `command.*` events reconcile optimistic state (every command ends `timed_out`, NEW-12). |
| AND-3 | H | **Mobile networks and `/ws`:** the server sets no ping period, idle timeout or frame limit (NEW-8) and counts at most 10 sockets per user (RT-1). Phones drop connections without closing them, so stale sockets pile up until TCP times out, and after 10 the user is refused with 4429 "Too many connections". The client also refetches everything on every reconnect (`refresh()`), and those endpoints rebuild the whole inventory per row (NEW-9, NEW-19), so reconnect storms are expensive. |
| AND-4 | M | **Auth transport for native clients.** HTTP requests are authenticated only by the `alice_session` cookie (`SessionPlugin` ignores `Authorization`); `Bearer` works only on `/ws`, and no response body ever contains the token. A native client must keep a cookie jar, honor `Set-Cookie` on any response (the session slides), and send `Origin` or `X-Requested-With` on every state-changing call, otherwise CSRF returns 403 (it does not know about native clients). That is workable but should be written down as the native contract; a bearer option would be simpler for iOS and Android. |
| AND-5 | M | **Push over FCM.** `registerFcm` caps a user at 10 subscriptions, and tokens are only removed on a `gone` result, so repeated reinstalls or token rotations hit the limit and registration returns 409. `FcmProvider` treats `INVALID_ARGUMENT` as "gone" and deletes the token, so one bad payload can unregister devices (NEW-18). Sends are blocking and happen on the thread that created the notification (NEW-18). Quiet hours must be validated before they are saved (NEW-24). |
| AND-6 | H | **Repository calls that land on known backend defects:** `setHvacMode`, `setFanPreset` (string parameters arrive wrapped in quotes, NEW-2); `setColor` (the rgb array is stringified, NEW-2, and the confirmation crashes, NEW-6); `toggleDevice`, `toggleLock` (`toggle` maps to `turn_on`, NEW-3; locking demands step-up, NEW-44); `lockAll` (same); `setDeviceAccess` (device policies are bypassable through the command route, leak through realtime events, scene actions and favorites: NEW-5, NEW-15, NEW-28, NEW-39, and policy creation is unvalidated: PRM-3); `createInvite` (needs step-up; unbounded hours, NEW-37); `setPrefs` (NEW-24); `verifyBackup` for Home Assistant backups (always passes, NEW-36); `installUpdate` (the supervisor is a stub, NEW-35); notifications list (always 500, NEW-31). |
| AND-7 | M | **Parity is unverified.** The doc assumes the Kotlin backend has the same REST surface, `/ws` protocol and command lifecycle as the TypeScript one, but no contract tests exist (`scripts/contract-e2e-env.md` says so) and the divergences above (NEW-44, the `422` versus `400` choice in SRV-8, mixed-map 500s) show it has drifted. The TS backend in `backend/` is available as an oracle. A failed command is returned as HTTP 200 with state `failed` by the Kotlin route; confirm that matches the TS contract before the app depends on it. |
| AND-8 | L | `GET /api/v1/home` supports ETag and 304, which suits an offline-first app; the other list endpoints do not, so a cold start or reconnect refetches everything. `GET /api/v1/permissions/me` returns role permissions only, not per-device policy, so the UI cannot know which devices a guest may use without trying. |

## 11. Not read, and not confirmed

**Everything in `backend-kt` has now been read.** `Identity.sq` and `Core.sq` were read with comment lines skipped.

**Resolved since the last version:**
- **NEW-1 (no target):** a web search of Home Assistant sources points to a no-op, not a domain-wide action. Omitting the entity target is deprecated, a call with no `entity_id` resolves to an empty list in Home Assistant's own tests, and `entity_id: "all"` must be sent explicitly. A community report says light calls without an entity or area now fail. I did not run it against a real Home Assistant, so the exact result on your version (silent success or an error) is still unconfirmed, but it is not domain-wide. Either way the command does not work.
- **NEW-43 (CORS):** matters only for the web frontend. Native Android and iOS clients ignore CORS (section 10.5).
- **PSK-2 (Android origin):** the Android app will use passkeys, so the single-origin limit is a real blocker (AND-1).

**Still depends on real Home Assistant, platform or browser behavior (H):** the exact result of NEW-1 on your Home Assistant version, NEW-5, CMP-2, CMP-4, the backup id semantics in NEW-36, and the Android and iOS passkey origin details in AND-1 (platform knowledge, not checked in this repo). The Android module itself has no networking yet, so AND-2 to AND-8 are derived from its architecture doc and repository contract, not from running it.

**Verified by running something:** NEW-2 (kotlinx.serialization quoting) and NEW-31 (mixed-type map responses return 500). Everything else is from reading the code or from grep.

**Estimates:** the NEW-23 brute-force time is not measured.

**Risks to know:** the tree is uncommitted and changing, so some details may shift (`ThingsService` already did). The first item to confirm is NEW-11/NEW-12, because it determines how much of the rest matters in production.

## 12. Fix status (tranche 1)

Fixed, with tests: command dispatch targets and data (CommandDispatchTest), sensitivity rules by domain/action/device class (SensitivityTest), device-entity ownership and undo visibility, mixed-map 500s on notifications, role/expiry/timezone validation on household routes, DB version handling (core DatabaseTest), WebSocket ping/timeout/frame limits, hub revocation sweep (interval now configurable), WebAuthn extra origins, routine job start, idempotent Phase12 start.

Not yet done: ThingsServiceTest tautologies, routine race test, hub sweep test, real HA runtime wiring, command persistence, push/backup/config-job fixes, schema constraints and retention.

## 13. Fix status (tranche 2: Home Assistant runtime)

`HaRuntime` (server/ha) now connects the configured Home Assistant, reconnects with backoff, loads `StateCache`, applies every state change, publishes `EntityStateChanged`/`EntityRemoved`/availability events, and records status, version and last error in `ha_connections`. A bad token is recorded and not retried. Saving or deleting the connection restarts or stops it.
The app's gateway is a `SwitchableGateway` (starts on `FakeGateway`, points at the real connection once up; listeners survive the swap). `HaWebSocketGateway` now detects dropped sockets, fails waiting calls, raises `HaAuthError` on `auth_invalid`, uses concurrent collections, and subscribes to `alice_notification`. `StateCache` is synchronized.
Known limits: one live connection (first row); with no connection configured the app still serves `FakeGateway` data; the HA token is still stored unencrypted; `getConfig()`/`getServices()` on the real gateway still return empty maps (HA version is not yet read); `HaEventBridge` still uses `"conn-1"` and the first household.

## 14. Fix status (tranche 3: command persistence)

Commands and idempotency keys now live in SQLite (`SqlCommandStore`, bound in DI; `InMemoryCommandStore` stays for tests). `commands` gained `group_id` and a state index via migration `1.sqm` (schema version 2). Idempotency keys are keyed by (user, key), fixing the old `key + userId` string collision, and expire after 24h. `recoverInterrupted()` is now called at startup (it never was), and also purges finished commands older than 30 days and expired keys.
Limits: purging runs only at startup; `connection_id` is still always null for commands.

## 15. Fix status (tranche 4: HA token encryption)

The HA operational token is now encrypted (AES-GCM via `Secrets`) by a new `TokenVault` before it is stored, and decrypted only when connecting or testing. The key comes from `SECRETS_KEY`; if unset, a `secrets.key` file (owner-only) is created beside the database. Rows written by older builds are encrypted in place the next time `HaRuntime` starts. Saving with no token keeps the existing one.
Limits: the default key file lives next to the database, so a copied data folder carries both (set `SECRETS_KEY` to separate them); losing the key means re-entering the token; the admin token still uses its existing sealed-box scheme.

## 16. Fix status (tranche 5: hardening)

- `X-Forwarded-For` (only read when `TRUST_PROXY=true`) now uses the last entry, the one our proxy added, instead of the client-supplied first one.
- Requests declaring a body over 1 MB get 413 (`BodyLimitPlugin`). Chunked bodies declare no length and are not capped here; set a body limit on the proxy.
- Config-job dedupe now deletes only the same household's pending job (it matched on the key alone across households).
- Push delivery runs on its own scope instead of `runBlocking` inside the request that created the notification.
Not done: FCM `INVALID_ARGUMENT` handling and WebPush response sniffing, backup fixes, mixed-map responses audit, `"conn-1"` and first-household assumptions in `HaEventBridge`.

## 17. Fix status (tranche 6: bridge target, HA version)

`HaEventBridge` now takes its household from the configured `ha_connections` row instead of the first household. (Correction, tranche 9: it first also took the real connection id, but settings, alerts and things are all keyed by the app-wide id `"conn-1"`, so that would have made power limits and left-open thresholds stop matching; the bridge keeps `"conn-1"` for the connection id until SQL-8 is finished.) The real gateway's `getConfig()` now calls `get_config`, so the HA version is recorded in `ha_connections`.
Limits: still one connection; the mode-helper sync still applies to every household; the automation-run and notification handlers use the same single target.

## 18. Fix status (tranche 7: push result handling)

- WebPush: the result is now read from the library's real `SubscriptionState` (ACTIVE sent, EXPIRED dropped) and `WebPushStatusException.statusCode` (404/410 dropped). The old code matched substrings of the state's name, so "invalid" counted as sent because it contains "valid", and any error message containing "gone" or "404" deleted the subscription.
- FCM: only 404 or `UNREGISTERED` removes a subscription. `INVALID_ARGUMENT` no longer does, since it usually means our own payload was rejected and would have deleted every device's subscription.
Not done: backup fixes, mixed-map response audit, schema constraints/indexes/retention, entity-settings household scoping, update-supervisor/CI `|| true`, remaining test items (hub sweep, routine race, ThingsServiceTest).

## 19. Fix status (tranche 8: backups)

- Backups are written to a `backups` folder beside the database (so the Docker `/data` volume holds them); files from the old folder are still readable.
- A `BACKUP_ENCRYPTION_KEY` that is set but not a 32-byte base64 value stops startup instead of silently producing unencrypted backups.
- A failed `VACUUM INTO` fails the backup; the fallback that copied the live file without its `-wal` is gone.
- Files are written as `.partial` then renamed atomically.
- Verify rejects a backup from a newer schema version.
- First tests for `BackupService` (folder, bad key, encrypted backup verifies with no partial file left, plain backup).
Not done: per-household export (the file is still the whole database), scheduler marking the day done before the backup runs, recovering `running` records after a crash, key handling through `AppConfig`, `Thread.sleep` scheduler.

## 20. Fix status (tranche 9: household scoping of per-connection settings)

`entity_settings`, `thing_overrides` and `entity_overrides` now include `household_id` in their key (migration `2.sqm` rebuilds them, schema version 3), so two households with the same entity id (for example `light.kitchen`) no longer share one row; every read of entity settings (alerts, energy, automations, things, config-job results, device routes) is filtered by household.
Not done (SQL-8 remainder): the connection id is still the literal `"conn-1"` everywhere, no foreign key to `ha_connections`, and a deleted connection still leaves its rows behind.

## 21. Fix status (tranche 10: retention and indexes)

A `Retention` job (started in `Main`, runs at startup and every 6 hours) now removes: expired WebAuthn challenges (which can hold an invitation code in plaintext), sessions expired or revoked more than 7 days ago, invitations closed more than 30 days ago, notifications read more than 90 days ago (or any older than a year), alerts cleared more than 90 days ago, and automation runs older than 90 days. Migration `3.sqm` (schema version 4) adds the missing indexes on `sessions.expires_at`, `config_jobs(household_id, dedupe_key)`, `groups.household_id` and `operators.token_hash`.
Not done: `query_history`, `insight_dismissals`, used recovery codes, `backup_records` and `update_records` have no retention; the plaintext invitation code in challenge data is still written (it is now removed once the challenge expires); no `CHECK` constraints; `selectActiveSupportSession` still needs the expiry UPDATE first.

## 22. Fix status (tranche 11: update flow and CI)

- `scripts/update-supervisor.sh` now does the work: it downloads `<base>/<version>/alice.tar.gz`, checks the sha256, unpacks beside the install, swaps it in keeping the old one as `.prev.<time>`, and restarts; a bad checksum, failed download, or a new version that will not start leaves (or restores) the old version and keeps the marker. `rollback` restores the newest `.prev.*`. An install with no checksum is refused unless `ALICE_ALLOW_UNVERIFIED=1`, and with no dist dir or base URL it leaves the request in place instead of reporting success. Checked by hand against fixture tarballs (bad checksum, missing version, good install, rollback); there is no automated test of the script.
- The update marker is built with kotlinx.serialization instead of string concatenation (a quote in a value could produce invalid JSON), with tests.
- CI: the `|| true` on the native build and on frontend install/lint/build are gone. Those two jobs are now `continue-on-error` at job level, so a failure shows red instead of being hidden.
Not done: the server still does not know whether the supervisor succeeded (it infers "done" from the running version); `systemctl` handling assumes a systemd host; the frontend jobs may now show red until its lint/build are clean.

## 23. Fix status (tranche 12: tests that checked nothing)

Replacing four `assertTrue(true)` tests in `ThingsServiceTest` with real assertions exposed a bug: `rename` and `setHidden` stored the override under the thing **id** (what the API passes), but the builder looks overrides up by **ref**, so renaming or hiding a device through the API never took effect. They now resolve the id to the ref first (the two methods are `suspend`). New tests cover rename, hide, merge/unmerge and split on a real two-device inventory, plus the same rename and hide through the HTTP routes. Also added: two `RealtimeHub` tests that a client whose membership ends is dropped by the periodic sweep (and one that stays is not).
Found, not fixed: `ThingsService` keeps `thingOverrides`, `entityOverrides`, `merges` and `splits` in plain in-memory maps shared by all households (`overridesLoadedFor` only remembers the last household loaded), so with two households one household's overrides can leak into the other's view; the routine start/race test is still open.

## 24. Fix status (tranche 13: per-household overrides)

`ThingsService` now keeps each household's renames, hides, entity overrides, merges and splits in its own overlay, loaded from the database the first time that household is used (previously four maps shared by every household, with a single "last loaded household" marker). Thing links are read and deleted by household (`selectThingLinksByHousehold`, and `deleteThingLinksByRefs` now takes the household); before, loading links for one household pulled in every household's merges and splits. Tests cover isolation of rename/hide/merge, of splits, and that a new service instance reloads each household's own overrides.
Not done: favorites, groups, and `person_links` still use the literal `"conn-1"`; the routine start/race test is still open.

## 25. Fix status (tranche 14: routine start and resume tests)

Added tests for the routine runner: twenty runs started from eight threads at once all complete (guards the start/registration race fixed earlier), a run left `running` by a restart is picked up by `resumeInterrupted` and finished, and a run whose owner lost access is failed instead of resumed. No code change was needed; the tests pass against the current implementation.
Not done: `RoutinesService` still has no `stop()` for its scope; the runner does not enforce a maximum total run time.

## 26. Fix status (tranche 15: server-error sweep of read endpoints)

Instead of auditing for mixed-type map responses by reading, a test now signs in as an admin with a small home loaded and requests 54 read endpoints (everything under `/api/v1` that is a GET and needs no setup), failing on any 5xx. All pass, so no further 500s of the kind fixed for `/notifications` remain on the read paths with that data. The one 503 it hit (`/history/...` with Home Assistant down) is deliberate and the test marks the gateway connected.
Not covered: POST/PUT/PATCH/DELETE bodies and responses; GETs that need ids of things not in the fixture (operator, backups by id, routine runs); responses with richer data (alerts, energy, automations with content).

## 27. Fix status (tranche 16: invitation code in challenges, reads that wrote)

- Starting a registration with an invitation now stores the invitation's **id** in the challenge, not the code; finishing the registration re-checks that invitation (so one revoked in between is refused). No plaintext invitation code is written to the database any more. Challenges created before the upgrade carry the old field, which is ignored, so an in-flight registration must be restarted (they live minutes).
- Support access: `active()` and `history()` no longer run an UPDATE first. An expired session is recognised by its end time (`selectActiveSupportSession` filters on `ends_at`), and history shows it as ended by expiry. Grant, extend and end still normalise first, since they write.
- Test helper bug found on the way: `RouteFixesTest.send` turned DELETE into POST; fixed.
Not done: CHECK constraints; favorites, groups and person links still use `"conn-1"`; recovery codes and invitation codes are still unsalted SHA-256 (NEW-23).

## 28. Fix status (tranche 17: keyed hashes for short codes)

Recovery and invitation codes (about 50 bits) are now stored as HMAC-SHA256 under the server's secrets key (`TokenVault.keyedHash`), not plain SHA-256, so a leaked database or backup can no longer be brute-forced offline without that key. Lookups try the keyed hash first, then the old plain hash, so codes made before the upgrade keep working until they are used. Tests cover keyed storage, that another key finds nothing, case/space-insensitive matching and the legacy fallback for invitations; the legacy fallback for recovery codes uses the same path but has no test of its own.
Caveat: the key is the one from `SECRETS_KEY` or the `secrets.key` file; losing it makes every unused recovery and invitation code stop working (the old plain-hash rows still would).
Not done: session tokens and operator tokens stay plain SHA-256 (they carry 256 bits, so this is fine); CHECK constraints; `"conn-1"` in favorites, groups and person links.

## 29. Fix status (tranche 18: backup scheduler)

- A scheduled backup no longer marks the day done before it runs: the day is marked only once a backup exists. After a failure the scheduler waits an hour before trying again (instead of either retrying every minute or giving up until tomorrow).
- At startup, app backups still `running` from a crash are marked failed ("The server stopped before this backup finished") and leftover `.partial` files are removed.
- Tests drive `tick()` with a controllable clock: failure then no retry within the hour then retry; success marks the day and does not repeat, and the next day gets its own backup; crash recovery.
Not done: the retry timer is in memory (a restart retries at once, which is fine); `saveSettings` is still a read-modify-write outside a transaction; the scheduler is still a sleeping thread; HA-side backup records (kind `ha`) are not recovered; per-household export.

## 30. Fix status (tranche 19: service locator removed for the activity feed)

`HaEventBridge`, `CommandExecutor`, `ModesService`, `ScenesService`, `RoutinesService`, `AutomationsService` and `AlertsService` looked up `ActivityService` (and, in the bridge and executor, several other services) through Koin's `GlobalContext`. Under test the global context does not exist, so that code silently did nothing and was never exercised. They now take `Lazy<…>` dependencies from the Koin module (lazy, so no construction cycles), and tests confirm a mode change and a confirmed command really appear in the activity feed.


## 31. Fix status (tranche 20: last service-locator lookups)

The remaining `GlobalContext` lookups are gone: `AutomationsService` takes lazy presence, things, scenes, routines, modes and notifications; `RoutinesService` takes `ConfigJobService`; `ThingsService` takes the event bus. There is now no use of `GlobalContext` in main code. A test confirms `things.changed` is published for the right household (it was never published under test before). Routines now see the config-job service under test, so routine sync status in tests reflects the real "no Home Assistant connection" path instead of an unconditional "not synced".

## 32. Fix status (tranche 21: inventory cache)

`ThingsService.inventory()` asked Home Assistant for areas, devices, the entity registry and every state on **every** call, and nearly every thing, device, search and realtime path calls it; with the real gateway wired in that is four websocket round trips per request. It is now cached for 30 seconds, built once for concurrent readers, and dropped when a `things.changed` event arrives. The real gateway now subscribes to Home Assistant's area, device and entity registry update events and `HaRuntime` turns them into `things.changed`, so a device added in Home Assistant appears without waiting for the timeout. A reconnect also invalidates it. Tests: one fetch for many reads, one fetch for ten simultaneous reads, refetch after the time is up, and refetch after a registry event.
Limits: attributes read from the cached inventory (names, device classes, capabilities) can be up to 30 seconds old when no registry event arrives; live state values still come from `StateCache`. `RealtimeHub` and `AlertsService` still call `runBlocking` to reach this suspend function (14 uses), which is cheap now but still blocks a thread.

## 33. Fix status (tranche 22: blocking calls in event handling, alert tests)

`RealtimeHub`'s entity state and availability handlers and `AlertsService`'s left-open check, clear and sweep are now `suspend` and call the inventory directly; four `runBlocking` calls in the hub (which ran on the event-collection coroutine, blocking a dispatcher thread per event) and five in the alert service are gone. `HaEventBridge` launches the left-open evaluation instead of waiting for it. The left-open and power-limit alert logic had **no tests at all**; six now cover: threshold, one alert updated not duplicated, clearing, a household-specific threshold, power above/below a limit, no limit means no alert, one household's limit not affecting another, and the sweep raising and clearing.
Remaining `runBlocking` (about 10): `RealtimeHub.connect`/`drop` (socket close from non-suspend code), `AlertsService.runBlockingThingByRef` (alert list view), and single uses in `AdminService`, `ConfigSyncService`, `UserRoutes`, `NotificationsService`, `ModesService`, `InsightsService`, `AutomationsService`, `ActivityService`, `CommandExecutor`, `HaEventBridge`, `SwitchableGateway`.

## 34. Fix status (tranche 23: deployment files)

- `docker-compose.yml`: the worker's variable is now `CONFIG_WORKER_PRIVATE_KEY` (it was `ADMIN_SEAL_PRIVATE_KEY`, which the worker never read, so it could not decrypt admin tokens as shipped); `HA_URL`/`HA_TOKEN` are gone (nothing read them; Home Assistant is set up inside the app); the server's real settings (`WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_EXTRA_ORIGINS`, `TRUST_PROXY`, `SECRETS_KEY`, `BACKUP_ENCRYPTION_KEY`, `ADMIN_SEAL_PUBLIC_KEY`) are listed as commented examples; the worker waits for the server to be healthy and runs as the same unprivileged user.
- `server/Dockerfile`: runs as user `alice` (uid 10001) with `/data` owned by it, and has its own `HEALTHCHECK`. The check uses bash's socket support instead of `curl`, which the base image may not have; the command was exercised by hand against a throwaway server (200 passes, 500 and nothing listening fail), but the image itself was **not built or run** here.
- The key file (`secrets.key`) is now created atomically (`CREATE_NEW`), because the server and worker share `/data` and may start at once; a test starts eight resolvers together and checks they agree.
Not done: building and running the images; the worker still needs its key pair generated by hand (no setup script in `backend-kt`); the worker image mounts a host build directory rather than shipping its own image.

## 35. Fix status (tranche 24: cancellation swallowed by runCatching)

`runCatching` around a suspend call also catches the `CancellationException` that stops the coroutine, so cancelled work carries on (the realtime hub's event loop, the bridge's subscriptions and backfill, alert evaluation, the Phase 12 loop, the executor's activity recording, presence, mode mirroring, AI, history and energy reads, the HA runtime's config read). A new `runCatchingNonCancellation` (core) behaves the same but rethrows cancellation; 42 call sites that wrap suspend calls now use it. A test shows the difference directly: a cancelled coroutine with plain `runCatching` carries on, with the helper it stops.
Limits: chosen by a script that looks for suspend function names near `runCatching`, then checked by hand, so some sites that wrap suspend calls through a name the script did not match may remain; about 190 other `runCatching` uses wrap non-suspend code and are unchanged; no lint rule prevents new ones.

## 36. Fix status (tranche 25: dead Home Assistant classes removed)

With `HaRuntime` in place, eight classes in the `ha` module had no users: `ConnectionManager`, `ConnectionService`, `ManagedConnection`, `HaRestClient`, `SyncService`, `HaProjectionStore`, `DriftDetector` (only its own test used it) and `ModeMirror`, plus `HaWebSocketGateway.reconnectWithBackoff`. They are deleted along with `DriftDetectorTest`. Because `backend-kt` is not tracked in git, a copy of each deleted file (and the gateway as it was) was first saved in the session scratchpad under `dead-code-backup/`; that folder is temporary, so commit or copy it elsewhere if you may want any of this back.
Not done: the `ha_entities` table and its queries (only `HaProjectionStore` used them) are still in the schema; `RegistryUpdatedEvent` and `InventorySynced` events are still handled by the hub though nothing publishes them; ~27 compiler warnings and the `Phase*` naming remain.

## 37. Fix status (tranche 26: compiler warnings)

27 warnings reduced to 6. Removed: unnecessary `!!`, `?:` and `?.` (including a `!!` on a value that a few lines earlier had been checked, in `GroupsService`), redundant casts and conversions, a redundant `else`, and three casts in `Normalizer` that could never succeed (`ev.data[...] as? String` on a map of JSON elements, so the `alice_notification` and `automation_triggered` normalizers could not have worked; they still end in `return null` as placeholders, nothing calls them, and they now read the values correctly).
The 6 left are Yubico library deprecations in `YubicoPasskeyEngine` and `SqlCredentialRepository`. They sit in the sign-in code, so I did not change them without a passkey test against the replacement methods; the existing `AuthServiceTest`/virtual-authenticator tests would catch a regression.

## 38. Fix status (tranche 27: Yubico deprecations, part)

Three of the six deprecation warnings are fixed: the assertion result's credential id and user handle are now read from `result.credential` (the supported accessors) in `YubicoPasskeyEngine`. The sign-in tests (virtual authenticator, register then log in) pass. Three remain: `RegisteredCredential.Builder.transports(...)` and the registration result's `isBackupEligible`/`isBackedUp`; the library marks them deprecated without a replacement name I could confirm, so they stay as they are.

## 39. Fix status (tranche 28: allowed values for enum-like columns)

The database now refuses unknown values for `household_members.role`, `invitations.role`, `commands.state`, `commands.source`, `backup_records.status` and `config_jobs.status`, on both insert and update. They are implemented as triggers listed in `core/src/main/resources/alice/core/db/constraints.sql` and applied every time the database is opened, rather than as `CHECK` constraints: SQLite can only add a `CHECK` by rebuilding the table, SQLDelight 2.4 cannot compile triggers that refer to `NEW`, and triggers also cover databases that already hold rows. A row already holding an unknown value still opens and reads; only new writes are checked. Tests: bad role refused, good one accepted; update refused; an old database with a legacy value opens and then refuses new bad values.
Not done: other enum-like columns (routine run state, alert kind, push platform, notification kind, verify status, update status, scene sync status and so on); the lists must be kept in step with the enums in code by hand.

## 40. Fix status (tranche 29: more allowed-value triggers, and a flaw in my key-file fix)

- `constraints.sql` now also covers `routine_runs.state`, `push_subscriptions.platform`, `alerts.kind`, `backup_records.kind` and `backup_records.verify_status`. Adding them showed that `RetentionTest` had been inserting alerts of kind `"k"`; the test data now uses a real kind.
- **Correction to section 34:** the "atomic" key-file creation I described there was not safe. It used `CREATE_NEW`, but another process that saw the empty, just-created file skipped creation and read it before the key was written; the new concurrency test failed on one run. The key is now written whole to a private temporary file and published with a hard link (which fails if another process already published one), so the file is never visible half-written and exactly one key wins. The test passed three times in a row on forced re-runs; a race that appeared once in a full run can in principle still hide, so treat it as well covered, not proved.
Not done: remaining free-text columns (notification kind, update status, scene sync status, activity kind and others).

## 41. Fix status (tranche 30: the connection id)

Decision: **the literal `"conn-1"` is kept as the connection id, but defined once** (`alice.ha.Connections.DEFAULT_ID`, with an explanation); all 38 uses in main code now refer to it. Replacing it with per-household or per-`ha_connections` ids was looked at and not done, because:
- thing ids are `SHA-1("<connection id>:<ref>")`, so any new value renames **every** thing and breaks favorites, group members, thing and entity overrides, thing links, entity settings and any id a client has saved;
- the TypeScript backend the port is compared against uses the same value, so the contract tests would diverge;
- isolation between households, the actual bug, is already fixed by scoping on `household_id` (sections 20 and 24); with one connection per household (`UNIQUE (household_id)`) the id carries no extra information.
A test pins the id derivation (`thing id = sha1("conn-1:" + ref)`), so an accidental change fails the suite. To change it for real, ship a migration that rewrites the id in `favorites`, `group_members`, `thing_overrides`, `entity_overrides`, `entity_settings`, `thing_links`, `alerts` and `person_links`, and tell every client that thing ids will change.
Updates the status table: item 5 is now "household scoping fixed; connection id deliberately fixed and centralised".

## 42. Fix status (tranche 31: duplicated map converters; a note on backups and households)

- The connection routes (test, resync, delete) and the backup routes (restore, delete) each carried their own copy of a "map to JSON" `when` block (four copies, RTE-5). They now use one helper, `Map<String, Any?>.toJsonObject()`. The JSON they answer with is unchanged, and new tests pin it for the connection endpoints (save, status, test with an unreachable server, resync, delete, then 404 on a second delete) and the 404s for a missing backup. The services still return plain maps; typed response classes would change the wire format (null versus missing keys), so that was left alone.
- **Per-household backup export (NEW-16d) is moot for now**, not done: `createHousehold` is called only once, by the first registration (`AuthService`), and everyone else joins that household by invitation. A running install therefore holds exactly one household, so a whole-database backup is that household's data. If a second household is ever creatable, the export (and the global `applyConstraints`, key file and operator tables) must be revisited first.

## 43. Fix status (tranche 32: names that described the build phase)

`Phase12Coordinator` is now `HousekeepingScheduler` in `alice.server.maintenance` (next to `Retention`), and nine test classes lost their phase names: `RoutinesAutomationsPresenceTest`, `AdminBackupSupportRoutesTest`, `UpdateManifestTest`, `UpdateAndAiRoutesTest`, `HaLiveIntegrationTest`, `GroupsScenesTest`, `SmartCompletionTest`, `ConfigJobServiceTest`, `RealtimeHubExtraTest`. No test was added or removed: the server count is 215 before and after this tranche's rename (212 at the status table plus the three tests added in tranches 30 and 31). The docs `LIMITATIONS.md` and `PARITY.md` still use phase wording.
Not done: reorganising packages by feature (the code is still grouped by kind in places), a convention plugin for the Gradle modules, and lint (detekt/ktlint).

## 44. Fix status (tranche 33: shared Gradle settings)

The four modules each repeated the same three blocks (Kotlin `jvmTarget` 21, Java source/target 21, `useJUnitPlatform()`). They now live once in the root `build.gradle.kts`, applied to any module that uses the Kotlin JVM plugin (`subprojects { plugins.withId(...) }`), and each module's build file holds only what is particular to it. After a forced full rebuild the counts are unchanged (core 19, ha 41, server 215, worker 13) and compiled classes are Java 21 (class version 65).
This is a root-script approach, not a separate convention plugin (`build-logic` or `buildSrc`): that needs the Kotlin DSL plugin resolved and was not worth the extra moving parts for four modules. Lint (detekt or ktlint) is not added: the plugins are not in the offline Gradle cache, so I could not verify them here.

## 45. Fix status (tranche 34: concurrent writes to the database)

A test that saves the backup form from one thread while the scheduler marks days done on another turned up two real faults:
- **Audit writes bypassed the database lock.** 22 call sites wrote audit rows with `Audit.write(db.raw, ...)`, handing the one shared SQLite connection to a second thread while another thread had a transaction open on it; SQLite answered "database is locked" and a request failed. (This was audit item NEW-26.) `Audit.write` now has an overload that takes the `Database` and writes through its lock, and all 22 sites use it.
- **The backup snapshot waited for no lock.** `VACUUM INTO` runs on a second connection to a file the app is writing to, with no busy timeout, so it failed at once when a write was in progress; it now waits up to 10 seconds.
- Also fixed in this tranche: `BackupService.saveSettings` read the stored settings outside the write and replaced the whole `backups` object, so a form save and the scheduler's "day done" marker could erase each other. It now reads, changes and writes in one transaction, and a form save keeps the scheduler's marker.
The test checks that no marked day and no saved form value is lost (three forced runs and the full suite pass). It does not check the number of backups left, because retention trims them to the changing "keep" value; my first version asserted that and was wrong.
Still open: other code paths that pass `database.raw` to non-audit calls were not found (`grep` shows none left in main code), but nothing prevents a new one; the single global lock still serialises all database work.

## 46. Fix status (tranche 35: group reads no longer write)

`GroupsService.view` (used by every `GET` on groups) rewrote the group while reading it: on a stale member ref it deleted every member and re-inserted them inside the loop, three copies of that code existed, and a crash in between could empty the group (NEW-10). Reading is now pure: a drifted ref is resolved on the fly by one function (`matchThing`). The repair lives in `relinkStaleMembers(householdId)`, which rewrites each group in a single transaction and is run once a minute by `HousekeepingScheduler`. The unused `resolveMembers` copy is gone. Tests: reading (`get` and `list`) leaves a stale stored ref untouched while the device still shows up; relinking repairs the ref without losing a member and a second run changes nothing.
Per-item status is kept in `AUDIT_ITEM_STATUS.md` (NEW-10 is now Fixed there); the tables in this report do not carry a status column.

## 47. Fix status (tranche 36: undo checks the device rules)

`CommandExecutor.undo` ran the inverse command as the person who made the original without asking again whether they may still use that device, so an allow removed or a deny added after the original command did not stop the undo (NEW-7). The HTTP route checked the person asking, not the person the inverse runs as. `undo` is now `suspend` (the `runBlocking` inside it is gone) and refuses with 404 when the original requester is denied by the device rules, has left the household, or the device no longer exists. When the executor has no things service (some tests) it skips the check, as before. Tests: a guest who ran a command without an allow rule cannot be undone for; the same undo goes ahead once an allow rule exists; an undo is refused once the guest has left.
Statuses for this and earlier tranches are in `AUDIT_ITEM_STATUS.md`.

## 48. Fix status (tranche 37: one command at a time per entity)

`CommandExecutor` kept two maps, `entityQueues` and `entityLocks`, that were filled and never drained or consulted: commands were not serialised, "coalescing" removed nothing, and both maps grew for ever (DOM-1, LOG-3). Each entity now has a lane (a coroutine `Mutex` plus a note of the newest request per action) that exists only while someone uses it. Commands for one entity run one after another, so two toggles cannot interleave; different entities still run in parallel. While a command waits its turn, a newer command for the same entity and the same absolute action (`set_*`, `turn_on`, `turn_off`, `lock`, `unlock`, `open`, `close`) replaces it: the older one is recorded as `cancelled` and never reaches Home Assistant, so dragging a slider does not queue up stale values. Toggles and undos are never merged. The command's construction was split out of `runCommand` so a dropped command still gets a record.
Tests: two toggles never overlap and both run; two entities run together; of three brightness changes the middle one is cancelled and the calls are the first and last values; lanes are all released afterwards. Run three more times on forced re-runs without a failure.
Not changed: `cancel` still cannot stop a command already sent; the 5 s confirmation wait is held inside the lane, so a second command on the same entity waits for the first to be confirmed or to time out.
Statuses are in `AUDIT_ITEM_STATUS.md` (LOG-3 Fixed; DOM-1 still Partly, with what remains).

## 49. Fix status (tranche 38: realtime hub backpressure and limits)

- **A stuck client held everyone up.** The hub flushed clients one after another and `send` suspends while a client's outgoing buffer is full, so one phone that lost its network without closing stalled the broadcast for all (the `bufferedAmount()` check that was meant to catch this always read 0). Each client's batch is now sent on its own, a client that cannot take a message within 5 s is dropped with close code 1013, and the socket adapter reports the bytes it has handed over but not yet got accepted (NEW-8, DOM-12).
- **Queue drop policy.** Over its limit the per-client queue dropped its oldest message whatever it was. It now drops the oldest *replaceable* one (a state snapshot, which carries a coalesce key) first, so notifications, activity items and command results are not pushed out by a burst of state changes.
- **Rate-limit list** was a plain list touched from several threads; it is now used under a lock (DOM-12).
- **Connection cap race.** Counting a user's open sockets and registering the new one were two steps, so simultaneous connects could exceed 10; they are now one (RT-1).
- **`stop()`** cleared the client map without telling anyone; it now closes every socket (1001) and stops the loops.
Tests (hub tests now 18): a stuck client is dropped while a healthy one still gets its message; 100 notifications survive 250 snapshots through the queue limit; 40 simultaneous connects for one user accept exactly 10; stopping closes sockets. The realtime tests were re-run three times with no failure.
Not changed: the session cookie name is still hardcoded in the route; `receive` still runs on the connection's own coroutine, so a stuck client's answer waits up to the timeout before the client is dropped.

## 50. Fix status (tranche 39: restoring a backup safely)

`RestoreApply` swaps a staged backup in at the next start. It only ran `PRAGMA integrity_check` on the staged file, moved the live database aside, **deleted the live database's `-wal` and `-shm` files**, and then moved the new file in, with no way back if that last move failed (DOM-8, LOG-13, SEC-7). Now:
- The staged file is checked again at start, since it can change after staging: integrity, a schema version no newer than this build, the tables Alice needs, and at least one user and one household (a restore of an empty database would wipe the install).
- The live database **with its write-ahead log** is moved aside together (`.before-restore-<time>`, `-wal`, `-shm`). The log can hold committed changes not yet in the main file, which the old code threw away, so the "kept" copy was not the whole database.
- If anything fails after that, every moved file is put back and the staged file stays for another try.
- Staging writes the file under a temporary name and renames it, so a crash cannot leave a half-written file for the restart to find.
Tests (five, run three times): a good restore, with the old log kept; a damaged file set aside; a newer-schema file refused; an empty database refused; a failing swap rolls back the database and its log. Writing the log assertion first mattered: simply opening a database beside a leftover log makes SQLite delete that log, which is also why a stale `-wal` must not be left lying about.
Not done: the restore still happens only at restart (an admin must restart Alice); no automatic cleanup of old `before-restore` copies; HA-side restores are unchanged.

## 51. Fix status (tranche 40: notification recipients, and tests that never ran)

**AUT-3.** A `notify` action in an automation carried a free list of `userIds`, and the same list arrives from Home Assistant in an `alice_notification` event. Nothing checked that those people belong to the home. `NotificationsService.notifyUsers` now delivers only to current recipients of the household (members, not expired, allowed to receive), and is used both when an automation runs and when the bridge handles the HA event; saving an automation that names a non-member is refused with a 400. Tests: non-members and unknown ids are skipped; the save is refused for a non-member and accepted for a member; an HA event naming a member and an outsider notifies only the member. (`FakeGateway.emitEvent` can now carry lists.)

**Four tests had never run.** Writing the third notification test, one method silently did not run: JUnit skips a `@Test` that returns a value, and a test written as `= runBlocking { ... }` returns whatever its last expression is (`assertThrows`, a `create(...)` call). Comparing the number of `@Test` annotations with the number of tests that ran, per file, found four older ones that were never executed: `routine delete and not found`, `presence people and link basics` and `automation CRUD preview and runs` (in `RoutinesAutomationsPresenceTest`), `tick claims and fails job without admin token` (`ConfigWorkerTest`), and the worker's live-HA test, which is skipped without a configured Home Assistant but was not even being started. All now run and pass. To keep this from happening again each module has an `EveryTestRunsTest` that loads the compiled test classes and fails if any `@Test` method returns a value; a throwaway test returning `42` made it fail, as intended.
Counts now, with every declared test running (including one guard test per module): core 20, ha 42 (2 skipped), server 241 (4 skipped), worker 16 (1 skipped); no failures.

## 52. Fix status (tranche 41: the audit log is read by household)

`AdminService.audit` fetched the newest 2,000 rows of the whole table (every home), kept those for one home in memory, sorted them, then looked each actor up one by one (ADM-1). With one home that was only wasteful, but it meant a home's entries older than the newest 2,000 anywhere were unreachable, paging stopped there, and the same pattern ran in the support screens (SUP-2: the newest 500). Now `selectAuditPage` returns one page for one home, newest first, optionally only actions with a given prefix, after a (time, id) cursor; actors are looked up once per distinct person; `householdLog` and `operatorTrail` use their own queries (`selectAuditPage` with prefix `support.`, and `selectAuditByActorType`). A new index on (household, time, id) supports them (migration `4.sqm`, schema version 5; SQL-2).
Tests (five): a home's entries stay reachable after another home writes 2,500 newer rows; pages follow on with no gaps or repeats even when ten entries share a timestamp; prefix filter and isolation between homes; actor names (and a missing actor); the support screens ignore 1,600 entries from another home.
Behaviour change to know: the action filter is a SQL `LIKE`, which ignores letter case for ASCII, where the old in-memory `startsWith` did not (`%` and `_` are still stripped from the filter).
Not done: `ADM-2` (`pruneAudit`/`pruneAttributeLog` still report 0 and prune globally); no separate retention of old audit rows beyond what exists.

## 53. Fix status (tranche 42: worker job handling)

**WRK-3 (config worker cancellation and payload safety).** `ConfigWorker.tick()` caught `Exception` around suspend code (decrypt and the whole perform/finish path), so cancelling the worker was swallowed and the job was marked failed or retried. A `CancellationException` is now rethrown (and `runCatchingNonCancellation` is used for parse, heartbeat, recovery and the drain loop; `api.close()` in `finally` also uses it). A job cancelled while `perform` is running is left in state `running` with its attempt count unchanged and no error/result written: `recoverInterrupted()` resets `running` jobs to `pending` when the worker starts, which is the existing recovery for an interrupted worker. `perform()` read required payload keys with `!!`, so a missing key threw `NullPointerException`, which the old classifier treated as retryable (up to 3 attempts) even though a malformed payload cannot succeed. Required keys are now read through helpers that throw `ConfigOps.ConfigOpError("<operation> needs \"<key>\"")`, so the existing classification marks them as permanent failures on the first attempt with the key named; `ConfigOps.validate(operation, payload)` still runs first, and the messages for missing required keys in both validators now name the key. Other suspend `catch`/`runCatching` in the worker files were adjusted: `HaAdminApi.generateBackup` and `deleteBackup` no longer swallow cancellation, and `restoreBackup` rethrows `CancellationException` before treating `TimeoutCancellationException` as the expected "HA may restart without answering" case.

**WRK-2 (two `ConfigOps` implementations).** `worker/ConfigOps` (JsonObject-based) and `ha/ConfigOps` (Map-based, used by the server's `ConfigJobApplier` for its constants) were different implementations; the audit noted only one had the template allow-list and the worker's checks were stricter. They were compared rule by rule (table below). Route taken: **tighten-and-test, not merged.** `ha/ConfigOps.validateOperation` was rewritten to enforce the same rule set as the worker for the covered operations (service allow-list, alice-script exceptions, target/data/`input_select`/`script.turn_on` constraints, delay bounds, parallel/event rules, trigger and condition types, the two allowed presence templates, entity-id patterns, and the size/bounds checks for scripts, automations, helper options, voice exposure and verification). A table-driven parity test (`ConfigOpsParityTest`) feeds the same inputs to both validators and asserts the same accept/reject verdict (the real guard against drift). The implementations and APIs remain separate (`worker/ConfigOps` still takes `operation: String, payload: JsonObject` and its `ConfigOpError` extends `RuntimeException`; `ha/ConfigOps` still takes `op: Map<String, Any?>` with an `op` field and its `ConfigOpError` extends `Exception`; `ha`'s `canonicalConfig`/`sameConfig` are still the simpler map-based forms, while the worker's normalize plurals/mode/empty conditions). `worker/ConfigOps` was left in place and the worker still uses it (it can be made to delegate to `ha` later); `ha/ConfigOps` keeps the public names the server uses (`MODE_HELPER_NAME`, `MODE_HELPER_ENTITY`, `ALICE_ID`).

**WRK-2 comparison (before this tranche; `ha` now tightened to match on the rules below):**

| Rule | `ha` (before) | `worker` (before) | Differed? | `ha` now |
|---|---|---|---|---|
| API / types | `validateOperation(Map{"op",...})`, `ConfigOpError: Exception`, `canonicalConfig(Any?)` | `validate(op,payload:JsonObject)`, `ConfigOpError: RuntimeException`, `canonicalConfig(JsonElement)` | Yes | Unchanged APIs/types |
| Service allow-list + alice-script exception | Yes (service key only) | Yes | Partly | Yes |
| Action structure (target/entity, data object, delay 1–3600, parallel ≤50 depth≤3, `alice_notification` event only) | No | Yes | Yes | Yes |
| `input_select.select_option` only for mode helper; `script.turn_on` only alice scripts | No | Yes | Yes | Yes |
| Trigger types/bounds (state, numeric_state needs `above`, time `HH:MM(:SS)?`, sun) | No (automation.upsert checked id only) | Yes | Yes | Yes |
| Condition types (state, template allow-list, time weekdays) | No | Yes | Yes | Yes |
| Template allow-list (the two presence templates) | No | Yes | Yes | Yes |
| Entity-id format `^[a-z_]+\.[a-z0-9_]+$` | No | Yes | Yes | Yes |
| Script/automation schema bounds (alias, sequence/trigger/action counts) | Script only; automation id only | Yes | Yes | Yes |
| Helper options 2–10, `^[a-z_]{1,20}$` | Count only | Yes | Yes | Yes |
| Voice expose: ids 1–200, entity format, `expose` boolean | Count only | Yes | Yes | Yes |
| `config.verify` bounds (≤500 items) | No | Yes | Yes | Yes |
| Canonical config normalization | Rename service/platform, drop id/null/empty/continue_on_error:false, sort | Also renames plurals, drops `mode:"single"` and empty conditions, wraps scalars for trigger/condition/sequence | Yes | Unchanged (separate implementations) |

**Tests.** Added `worker/src/test/kotlin/alice/worker/ConfigWorkerWrk3Test.kt` (missing required key fails permanently on the first attempt with the key named, for each operation that has a required key; cancelling while `perform` runs leaves the job `running` with attempts unchanged and no error/result; ordinary failures still retry up to the existing limit) and `worker/src/test/kotlin/alice/worker/ConfigOpsParityTest.kt` (worker and `ha` validators agree on valid/invalid cases including disallowed service, disallowed template, unknown trigger/condition, malformed/oversized entity-id/sequence cases, and valid script/automation/helper/voice/delete operations). Proved failing without the fix by reasoning against the pre-fix code: (1) `ConfigWorkerWrk3Test.missing required key...` — `perform` used `!!`, throwing `NullPointerException`, which was not classified permanent, so `tick` retried (status `pending`, attempts 1) instead of failing permanently with the key named; the test asserts `failed`, attempts 1 and the key in the error. (2) `ConfigWorkerWrk3Test.cancelling worker...` — `tick` caught `CancellationException` in `catch (e: Exception)` and finished/retried the job, so the row would not remain `running` with attempts unchanged; the test asserts `running`, attempts 1, no error/result. Worker tests run 3 times with `--rerun-tasks`: all passed each time.

**Not changed.** WRK-1 (third HA client), WRK-4 (`recoverInterrupted` always returns 0; heartbeat JSON interpolated — I only made it not swallow cancellation), WRK-5 (env vars in `Main.kt`), WRK-6, `server` module, database lock (CORE-3), HA-8, SRV-3, and the separate `ConfigOps` APIs/canonicalization (no merge, no delegation). `HaAdminApi.generateBackup` still swallows non-cancellation failures and can report an empty backup id (NEW-36, out of scope). The `ha` validator's stricter rules apply at `validateOperation` call sites (none in production main code today); they were not applied to jobs already stored. No live Home Assistant was used; the worker is exercised through fakes.

### 53a. Correction found when the tranche 42 work was reviewed

The delegated change made `tick()` rethrow every `CancellationException`. But `withTimeout` (used by `HaAdminApi.wsSend` for every Home Assistant websocket call) throws `TimeoutCancellationException`, which *is* a `CancellationException`. So any Home Assistant call that got no answer in 30 s would have been rethrown out of `tick()` and out of `runLoop`, ending the worker and leaving the job `running`; before the change that case was classified as a timeout and failed that one job. The worker's own tests had no timeout case, and the agent's "fails without the fix" claim was by reasoning, not by running it.
Fixed: `wsSend` now turns a timeout into `HaTimeout` (and `restoreBackup` treats `HaTimeout` as the expected "Home Assistant restarted without answering"); `tick()` also tells a timeout raised while the worker is still active apart from a real cancellation, which still propagates. Two tests: a timed-out job is failed (once, not retried) and `tick()` returns normally; the loop survives a timed-out job and processes the next one. Both were shown to fail against the agent's version (put back temporarily) and pass with the fix. Worker tests re-run three times forced; the whole suite passes (core 20, ha 42 (2 skipped), server 246 (4 skipped), worker 22 (1 skipped)).
Also corrected in `AUDIT_ITEM_STATUS.md`: the agent had left WRK-3 in the "not fully fixed" list with the state Fixed; it is removed from that list.
Lesson for later briefs: a change that stops swallowing an exception type needs a test for each *subclass* callers rely on, and "fails without the fix" must be demonstrated by running it.

## 54. Fix status (tranche 43: defects found by the e2e harness)

Fixes for three critical Kotlin defects reported by the end-to-end parity harness in `e2e/FINDINGS.md` (F-026, F-021, F-017). Work was done in `backend-kt` only (not git-tracked, multi-session tree). The TypeScript backend in `backend/` was treated as the oracle for response shapes where relevant. The e2e harness was **not** run (no Docker/real HA/bun in scope), and nothing under `e2e/` was edited. Nothing was verified against a real Home Assistant.

**Baseline (before changes, full suite `./gradlew --offline test --console=plain --continue`):** core 20 (0 skipped), ha 42 (2 skipped), server 246 (4 skipped), worker 22 (1 skipped), 0 failures. **Final (after changes):** core 20 (0 skipped), ha 42 (2 skipped), server 251 (4 skipped), worker 22 (1 skipped), 0 failures. Added tests: 5 in server (2 in `alice.server.commands.CommandResponseSerializationTest`, 3 in `alice.server.F021F017ParityFixesTest`). Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks --console=plain` succeeded with only the 3 pre-existing Yubico deprecation warnings in `server`. Added server tests were run >=3 times with `--rerun-tasks` (all passed). `EveryTestRunsTest` guards remain intact (test bodies written as `= runBlocking<Unit> { ... }` where applicable).

### F-026 — command responses crash on string/nested state values (critical, Fixed)

**What was wrong.** `server/src/main/kotlin/alice/server/commands/Expectations.kt` converted requested/actual command state values with `Json.parseToJsonElement(v.toString())` (`mapToJsonElement`). String values became unquoted tokens and lists/maps/nested structures (e.g. `rgb=[255.0,127.0,125.0]`) were not valid JSON text, throwing during response serialization (`kotlinx.serialization.json.internal.JsonDecodingException` / 500), as seen in e2e `E2E-CMD-02` (`e2e/.runs/m4-all-cmd/evidence/E2E-CMD-02/requests.jsonl`: 500 internal_error for a confirmed color command).

**What changed.** Replaced stringify-and-reparse with the existing typed converter `anyToJsonElement` from `commands/CommandExecutor.kt` (same package, `internal`): `mapToJsonElement` now returns `m.mapValues { (_, v) -> anyToJsonElement(v) }`. `toPublicCommand` unchanged in shape; numbers stay numbers, booleans booleans, strings quoted strings, lists arrays, maps objects, null stays null.

**Before/after (representative, trimmed).** Before (e2e evidence): `POST /api/v1/devices/{id}/commands` (`set_color`/brightness producing nested color state) -> HTTP 500 `{"error":{"code":"internal_error","message":"Internal server error"}}` with server-side `JsonDecodingException` while building `requestedState`/`actualState` (e.g. parsing `rgb=[255.0, 127.0, 125.0]`). After (confirmed command, types preserved): HTTP 200 with e.g. `"state":"confirmed","requestedState":{"color":{"rgb":[255,127,125]}},"actualState":{... includes typed values/arrays ...}` (no 500; nested values encoded as proper JSON). Compared against TS command response/public shape in `backend/src/modules/devices/commands/public-command.ts` / command executor flow (`backend/src/modules/devices/commands/`).

**Tests.** `server/src/test/kotlin/alice/server/commands/CommandResponseSerializationTest.kt`: (1) `toPublicCommand serializes requested and actual state with correct JSON types` (unit: string, boolean, int, double, list `rgb`, nested map, null). (2) `command HTTP response includes string and nested state values without 500` (HTTP via test app, FakeGateway+StateCache, confirmed `set_color` command asserts 200, requested/actual typed JSON).

**Demonstrated fail without fix (run).** Reverted `Expectations.mapToJsonElement` to `Json.parseToJsonElement(v.toString())` and ran `./gradlew --offline :server:test --tests alice.server.commands.CommandResponseSerializationTest --console=plain`: 2 tests, 2 failed — unit threw `kotlinx.serialization.json.internal.JsonDecodingException` (e.g. parsing `[255, 127, 125]` / unquoted tokens at `Expectations.kt:173`) and HTTP case returned 500 with `JsonDecodingException` at `mapToJsonElement`. Restored fix (and adjusted numeric assertion to tolerate JSON-emitted `255.0` as numeric content): same command -> `BUILD SUCCESSFUL`, 2 passed.

**e2e cards that should now pass (to be re-run by harness owner):** `E2E-CMD-02` (and any command card that previously 500'd due to string/nested requested/actual state serialization).

### F-021 — favorites return 500 for a non-empty list (critical, Partly)

**What was wrong.** `FavoriteRoutes` returned `FavoritesResponse(val devices: List<alice.ha.Thing>)` for GET/PUT `/api/v1/favorites`, serializing internal `Thing` objects (containing `Any`-typed capability/metadata values), which threw `SerializationException` on non-empty lists (e2e `E2E-FAV-01`: PUT/GET 500). TS returns presented device views, same shape family as `GET /devices` (`backend/src/modules/favorites/favorites.service.ts` returns `{ devices: ThingView[] }` built via `DevicesService`/`presentThing`).

**What changed.** Rewrote `server/src/main/kotlin/alice/server/routes/FavoriteRoutes.kt` to return `{"devices":[<device-view-json>...]}` (JsonObject/array). Views are built via `Presentation.presentThing` + existing DeviceRoutes helpers reused as `internal` (`deviceViewJson`, `entityViewJson`, `thingSettingsJson`) instead of duplicating view construction. Favorite/device order is preserved on read by walking saved refs in order. Removed `FavoritesResponse(List<Thing>)`; `FavoritesBody` remains. Unknown/invisible refs are dropped when resolving views; PUT still dedupes/takes 50 and drops unknown/invisible without per-id validation errors (F-022 ordering/validation/visibility differences not fully aligned).

**Callers/other routes checked.** Searched for `List<alice.ha.Thing>` / `Thing>` in serializable route responses: no other `@Serializable` route response returning `Thing` found; `GroupsService` uses `List<alice.ha.Thing>` internally only (not serialized). `DevicesResponse(val devices: List<Thing>)` in `DeviceRoutes.kt` remains declared but unused by the live routes (routes emit JsonObject arrays) — left in place, not a wire leak. `ModeRoutes`/`ThingsRoutes` were inspected as called out in NEW-39 context; no direct `Thing` serialization on the wire.

**Before/after (representative, trimmed).** Before (e2e FAV-01): non-empty `PUT/GET /api/v1/favorites` -> 500 internal_error (`SerializationException: Serializer for class 'Any' is not found` while serializing internal `Thing`). After: HTTP 200 `{"devices":[{"id":"...","name":"...","kind":"device","primary":{"entityId":"...","availability":"...","values":{...},"capabilities":[...]},"others":[],"controls":[],"facets":[],"sensors":[],"favorite":true,"settings":{...}, ...}, ...]}` in requested/favorite order (device-view shape, not raw `Thing`). Compared against TS `backend/src/modules/favorites/favorites.service.ts` and device view shape from `backend/src/modules/home-assistant/things/presentation.ts` / `backend/src/modules/devices/devices.service.ts`.

**Tests.** `F021F017ParityFixesTest`: `F-021 favorites return device views for non-empty list and preserve order` (PUT then GET with 2 devices, asserts 200 not 500, correct order, device-view keys/shape, `favorite:true`, and live availability carried through). Visibility/hidden/guest-specific cases beyond the admin populated case were not exhaustively matched to TS because F-022 behavior differs; marked Partly.

**Demonstrated fail without fix (run).** Replaced `FavoriteRoutes.kt` with a version returning `FavoritesResponse(List<Thing>)` (old internal-Thing response shape) and ran `./gradlew --offline :server:test --tests "alice.server.F021F017ParityFixesTest.F-021 favorites return device views for non-empty list and preserve order" --console=plain`: 1 test failed, request observed as `PUT /api/v1/favorites -> 500` (serialization failure path) / assertion failure due to non-view shape. Restored fixed `FavoriteRoutes.kt`: test passed.

**e2e cards that should now pass (to be re-run):** `E2E-FAV-01` (non-empty favorites no longer 500, view-shaped response). Cards still expected to differ/fail where F-022 behavior remains (ordering/validation/hidden/unknown-id semantics) or other unfixed findings apply.

### F-017 — device views never carry live Home Assistant state (critical, Fixed)

**What was wrong.** Device presentation called `Presentation.presentThing` with `lookup = { null }` in `routes/DeviceRoutes.kt`, `routes/ThingsRoutes.kt`, `routes/FavoriteRoutes.kt` (favorites view builder), `things/ThingsService.kt`, and `smart/SmartService.kt`, so `StateCache` (kept current by `HaRuntime`) was never consulted. Views reported `availability:"unknown"` and empty `values` (e2e `E2E-DEV-01`, `m3-inv`, `E2E-FAV-04/05` diffs showed TS `available` + populated values vs KT `unknown`/missing).

**What changed.** Threaded `alice.ha.StateCache` through presentation paths and passed `{ id -> stateCache?.get(id) }` to `Presentation.presentThing`:
- `DeviceRoutes.kt`: helpers/routes accept optional `stateCache`; `visibleDeviceViews` and `deviceRoutes` use cache lookup (list/detail/name/areas devices).
- `ThingsRoutes.kt`: `thingsRoutes(things, stateCache?)` uses cache lookup.
- `FavoriteRoutes.kt`: `favoriteDeviceViews`/`favoriteRoutes` accept and use `stateCache`.
- `ThingsService.kt`: optional trailing `stateCache` ctor param; `visible()` uses cache lookup.
- `SmartService.kt`: optional trailing `stateCache` ctor param; `home()` device projections use cache lookup.
- `App.kt`: resolves `StateCache` and passes it to `thingsRoutes`, `deviceRoutes`, `favoriteRoutes`.
- `ServerModule.kt`: injects `StateCache` into `ThingsService` and `SmartService`.

Checked mapping against `StateCache`/`Presentation` and TS (`backend/src/modules/home-assistant/things/presentation.ts`: `availability: p?.availability ?? "unknown"`, `values: p?.normalized ?? {}`; `available` true when main view not unavailable). Did **not** chase F-018 (empty `capabilities[].metadata` vs omitted), F-023, F-024, or other unrelated diffs.

**Callers checked.** All `Presentation.presentThing` call sites in `server/src` now use cache lookup or the injected lookup; ha tests using `{ null }`/explicit lookups unchanged and still valid for their cases. `ThingsService`/`SmartService` constructors kept backward-compatible defaults (trailing optional params) so existing tests/callers continue to compile/work.

**Before/after (representative, trimmed, vs TS).** Before (e2e DEV-01 diff): `"primary":{"availability":"unknown","values":{}}` with TS showing `"availability":"available","values":{"power":true,"hvac_mode":"heat","target_temperature":20,...}`. After (from F-017 tests, cache populated): device `primary.availability` becomes `"available"` (or `"unavailable"` when cache state unavailable), `available` reflects reachability, and `values` populated from normalized state (e.g. light `power:true`, brightness present; lock/climate values present per normalized projection) — matching TS behavior of joining live cache state (`backend/src/modules/home-assistant/things/presentation.ts` + `backend/src/modules/devices/devices.service.ts`). Absent-from-cache entity: `availability:"unknown"` and empty `values` (consistent with TS `p?.availability ?? "unknown"` / `p?.normalized ?? {}`).

**Existing tests changed.** None edited. Existing tests either did not assert live values or run with empty/unpopulated state where `unknown`/empty remains correct when absent from cache.

**Tests.** `F021F017ParityFixesTest`: (1) `F-017 device views expose live availability and values from cache` (populated cache: `/devices` and `/things` show `available`/`availability:"available"` and populated normalized values incl. light power/brightness and lock state; favorites carry through in F-021 test). (2) `F-017 unavailable and absent cache states are reported correctly` (unavailable in cache -> `unavailable`/`available:false`; absent from cache -> `unknown` and empty values per TS).

**Demonstrated fail without fix (run).** Replaced presentation lookups with `{ null }` in `DeviceRoutes`, `ThingsRoutes`, `FavoriteRoutes`, `ThingsService`, and `SmartService` (keeping signatures/wiring) and ran `./gradlew --offline :server:test --tests "alice.server.F021F017ParityFixesTest.F-017 device views expose live availability and values from cache" --tests "alice.server.F021F017ParityFixesTest.F-017 unavailable and absent cache states are reported correctly" --tests "alice.server.F021F017ParityFixesTest.F-021 favorites return device views for non-empty list and preserve order" --console=plain`: 3 tests completed, 3 failed (assertions saw `unknown`/empty/missing live values). Restored fixed files: tests passed.

**e2e cards that should now pass (to be re-run):** the live-state portions of `E2E-DEV-01` (and related DEV device-view cards), `/things`-equivalent views, and favorites device views such as `E2E-FAV-04`/`E2E-FAV-05` where the remaining diff was availability/values being unknown/empty. Cards may still fail for unrelated reasons (F-018 `capabilities[].metadata` `{}` vs omitted, F-023/F-024 ordering/shape/name diffs, hidden/includeHidden semantics F-023, etc.) — **seen, not fixed**.

**Not changed / not verified.** Group list endpoint `/api/v1/groups` returns `GroupDevice(id,name,available)` derived from thing structure, not a full live device view payload; it was not changed to carry per-entity values/availability in the device-view shape. `SmartService`/other projections now receive cache when available via DI; behavior in paths not exercised by tests was not manually verified. No real Home Assistant.

### F-040 — Ask Alice guest visibility (optional, Not done)

Not attempted in this tranche to avoid rushing security-sensitive changes; deferred per instructions. `server/src/main/kotlin/alice/server/ai/AskAliceService.kt` / routes still require filtering proposals by caller visibility.

### Contract effects / notes

- Favorites response shape changed from internal `Thing` serialization to presented device-view JSON objects under `{"devices":[...]}` (aligns with TS device-view shape family); `favorite` and `settings` included as in device views.
- Command `requestedState`/`actualState` now serialize typed JSON values correctly (strings quoted, arrays/objects/nested preserved) instead of crashing or being malformed.
- Device/thing/favorites views now include live `availability` and normalized `values` when `StateCache` has state (previously `unknown`/empty). Capability `metadata` emission and other unrelated field-order/shape details were not normalized to TS.

### Found but not fixed (outside scope / noted)

- F-022: favorites unknown-id validation errors, exact hidden/visibility semantics and other ordering/edge behaviors vs TS not fully aligned (only crash/view-shape and ref-order preservation addressed). `e2e/FINDINGS.md`.
- F-018/F-023/F-024: capability metadata `{}` vs omitted, hidden/includeHidden/admin view differences, area/name ordering differences — seen, not fixed.
- `DeviceRoutes.kt`: unused `@Serializable data class DevicesResponse(val devices: List<Thing>)` remains (not on wire). Low.
- `GroupsService` group devices expose structural availability, not live cache-backed device-view values. Medium/low, depends on TS contract.

### 54a. What review of the tranche 43 work found and changed

The delegated work (F-026, F-021, F-017) was checked against the tree: the counts it reported were right, and I re-ran the whole suite. Gaps found and closed:
- **Hidden devices in favorites.** The TypeScript favorites service drops a hidden device from the list (its own test says so: "a hidden device drops out of the list"); the new Kotlin view code did not, so a hidden device, which for a non-admin is not meant to appear, stayed in favorites. It now drops out and comes back when shown again.
- **Tests the brief asked for were missing.** There was no test for hidden favorites, none for a guest seeing only what a rule allows, and none for `/things` carrying live state. Three were added (in `RouteFixesTest`, which can populate a home and cache): hidden drops out and returns with the order kept; a guest's saved favorites show only the lamp a rule allows, with live availability and brightness (180 of 255 is shown as 71); `/things` carries live availability and values. The hidden-device test was shown failing without the fix and passing with it; three forced re-runs passed.
- **Totals were not recomputed.** The agent changed NEW-39 (Not done to Partly) without updating the summary tables; they are now recomputed from the item rows by script (Fixed 73, Partly 52, Not done 173, Moot 6 = 304; the list of high and critical items not fully fixed matches the table, 17 rows). The "As of" line now names every row changed since the first snapshot.
- The agent also ran Gradle runs in parallel once, which corrupted build state until it re-ran them one after the other; worth saying in the next brief (never run Gradle concurrently in this tree).
Still true: F-021 is Partly (an unknown id on `PUT /favorites` is dropped silently where TypeScript answers 404, F-022); `/groups` still returns the small `GroupDevice` summary; F-040 not done; nothing verified against a real Home Assistant.
Suite now: core 20, ha 42 (2 skipped), server 254 (4 skipped), worker 22 (1 skipped); no failures. Left for the e2e owner to re-run: E2E-CMD-02, E2E-FAV-01, E2E-DEV-01 and the favorites and device cards that differed only in live state.

## 55. Fix status (tranche 44: sync and connection items)

Fixes for audit items SYN-3, SYN-4, SYN-5, SYN-6 and SYN-7, plus an investigation of SYN-2. Work in `backend-kt` only. The e2e harness was not run and nothing under `e2e/` was edited. Nothing was verified against a real Home Assistant.

**Baseline (before changes):** core 20, ha 42 (2 skipped), server 254 (4 skipped), worker 22 (1 skipped), 0 failures. **Final:** core 20, ha 42 (2 skipped), server 264 (4 skipped), worker 22 (1 skipped), 0 failures. Added tests: 4 classes / 10 tests in server (`ConfigJobApplierSyn3Test`, `ConfigSyncServiceSyn6Syn7Test`, `HaConnectionAdminServiceSyn4Syn6Test`, `HaRuntimeSyn5Test`). Existing `RouteFixesTest` was updated for the two behaviour changes below. Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with only the 3 pre-existing Yubico deprecation warnings. New tests were run 3 times with `--rerun-tasks` (all passed).

### SYN-3 — `applyPending(null)` and `running` jobs (Fixed)
- `server/src/main/kotlin/alice/server/sync/ConfigJobApplier.kt` (`applyPending`): a job whose status is `running` is now filtered out and never applied by this class (the worker owns it). `applyPending(null)` now applies every household that needs the in-process fallback (connections without an admin token) instead of doing nothing. Direct calls with a household id keep the previous per-household behaviour, minus `running` jobs.
- `server/src/main/kotlin/alice/server/sync/HaEventBridge.kt` (polling block): now calls `applier.applyPending(null)` once instead of looping households and gating on `admin_token_enc == null`; the gate lives inside `applyPending`.
- Tests: running job left alone; pending job applied once and marked done; second call does not apply it again; `null` applies no-admin-token households only. Demonstrated failing without the fix (running job was applied and marked done; `null` returned 0).

### SYN-4 — `testConnection` and `putConnection` (Fixed)
- `server/src/main/kotlin/alice/server/ha/HaConnectionAdminService.kt` (`testConnection`): now `suspend` and performs the `HttpURLConnection` call inside `withContext(Dispatchers.IO)` (5 s timeouts retained). HTTP 401 returns `ok=false`, `reachable=true`, `status=401`, `error="Home Assistant rejected the access token"`. 2xx returns `ok=true` with no error; 5xx returns `ok=false`, `reachable=false`, `status=<code>`, `error="Home Assistant returned HTTP <code>"`; connection failures return `ok=false`, `status=null`, `reachable=false`, `error=<message>`. The four JSON keys `ok`, `status`, `reachable`, `error` are kept; no new key.
- `putConnection`: only `http`/`https` URLs with a non-blank host are accepted; `file:`, `ftp:`, `javascript:`, schemeless and hostless URLs throw a 400 validation error. `testConnection` never opens a non-http(s) URL (it returns the invalid-URL result before opening).
- Tests: local `com.sun.net.httpserver.HttpServer` on port 0 answering 200/401/500, connection refused, scheme/host validation, and `ok` per case.

### SYN-6 — `resyncConnection` and `verifyAll()` (Fixed)
- `HaConnectionAdminService.resyncConnection`: returns `ok=true` only when `ConfigSyncService.verify` actually ran and returned true; otherwise `ok=false`, `triggered=false`, and an `error` text (verification threw or could not be queued). Cancellation propagates (`runCatchingNonCancellation`).
- `ConfigSyncService.verifyAll`: each household is verified in its own try/catch (cancellation rethrown), failures are logged with the household id, and one failing household does not stop the others.
- Tests: two households where the first throws and the second is still verified; `resyncConnection` with no sync service returns `ok=false` with an error. `RouteFixesTest` updated to expect `ok=false` for the no-admin-token case.

### SYN-7 — `reconcileScenes` (Fixed)
- `ConfigSyncService.reconcileScenes`: now `suspend`, no `runBlocking`, and keeps the `things.Caller` type its siblings already use for their own caller types (no conversion needed at the boundary because each method's caller type matches its service).
- Test: a call from a coroutine returns the reconciled count.

### SYN-5 — entities and syncedAt (Fixed)
- `HaRuntime`: records `lastSyncedAt` (ISO-8601 from `time.now()`) when the cache is filled on connect; cleared on stop. Exposed as `lastSyncedAt`.
- `HaConnectionAdminService`: optional trailing `StateCache` constructor parameter; `status()` now sets `entities = stateCache?.size` and `syncedAt = runtime?.lastSyncedAt`. Wired in `di/ServerModule.kt`.
- Tests: before connect reports 0 entities and null syncedAt; after connect with a fake gateway holding 2 states reports 2 and a timestamp.

### SYN-2 — investigation only (no change)
Trace:
1. `server/src/main/kotlin/alice/server/modes/ModeMirrorService.kt:45-55` (`ensureHelper`) calls `configJobs.enqueue(..., "helper.ensure_mode_select", ...)` only when `jobs.status(householdId)` is `connected && adminTokenSet`.
2. `server/src/main/kotlin/alice/server/things/ThingsService.kt:278-290` (`updateSettings`) calls `configJobs.enqueue(..., "voice.expose", ...)` only when `configJobs != null` and `st.connected && st.adminTokenSet`.
3. `server/src/main/kotlin/alice/server/sync/HaEventBridge.kt:97-112` (polling block) applies pending jobs only for households where `conn != null && conn.admin_token_enc == null`.
Conclusion: the two operations are enqueued only when an admin token is present, while the in-process applier polls only connections without one. Therefore the in-process applier never sees these jobs in normal operation; it can only handle them after an admin token is removed or if jobs are seeded manually. The external worker (which requires an admin token) is the intended executor. No code was changed for SYN-2.

**Not changed:** SYN-1 (optional second phase not attempted), HA-8, DOM-3 beyond the SYN-3 block, SRV-3, CORE-3, worker module, and any public route/JSON key other than the documented behaviour changes.

### 55a. What review of the tranche 44 work found

Verified: the whole suite re-run from scratch (core 20, ha 42 (2 skipped), server 264 (4 skipped), worker 22 (1 skipped)), the status tables recomputed from the rows (Fixed 78, Partly 51, Not done 169, Moot 6 = 304; the high and critical list matches the table), and the changed code read by the line numbers the agent gave. The fixes for SYN-3, SYN-4, SYN-5, SYN-6 and SYN-7 are sound and each test was shown failing without its fix. Things to know, and one small change made in review:
- **Response keys of `POST /ha/connection/test`.** An unreachable server now answers `status: null` and a successful one `error: null`, where before the key was absent. The four keys are the same; a client that distinguishes missing from null would notice. The route test was renamed from "the same JSON as before", which was no longer true.
- **`POST /ha/connection/resync` now says `ok: false` when nothing could be verified**, which is the case for every home with no admin token (verification needs the worker and a stored admin token). That is honest for the audit item (SYN-6), but it is not what the TypeScript backend's resync means: there it re-reads the live connection's state (and answers 409 `not_connected` when there is none). Aligning the meaning is parity work (finding F-020) and was left alone.
- `ConfigSyncService` and `verify` were made `open` only so a test can subclass them; harmless, but a fake collaborator would be tidier.
- The bridge's polling loop wrapped the cancellation-safe helper in a plain `runCatching`, which swallowed cancellation again (the next `delay` ended the loop, so it was harmless); the outer wrapper is gone.
- SYN-2 stays Not done: the trace (enqueue only with an admin token, in-process applier only without one) shows the applier is reachable only after a token is removed or for jobs seeded by hand; nothing was changed. Whether to remove it is a decision for later.
- SYN-1 (merging the copies of the sync-state update) was not attempted.

## 56. Fix status (tranche 45: core module items)

Fixes for CORE-2, CORE-6, CORE-7, CORE-8 and CORE-9, plus an investigation of CORE-11. No schema change was made; one new query was added to the existing `rate_limits` table. Nothing was verified against a real Home Assistant.

**Baseline (before changes):** core 20, ha 42 (2 skipped), server 264 (4 skipped), worker 22 (1 skipped), 0 failures. **Final:** core 27, ha 42 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), 0 failures. Added tests: 3 core classes / 7 tests plus new tests in `ConfigJobServiceTest`, `ThingsServiceTest` and `AdminServiceCORE9Test`. Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with only the 3 pre-existing Yubico deprecation warnings. New tests were run 3 times with `--rerun-tasks`.

### CORE-2 — deciding new vs existing databases (Fixed)
- `DatabaseFactory.open` now treats a database as new only when `sqlite_master` contains no tables. A 0-byte file that already existed is still initialised, but logs a WARNING naming the file. A non-empty file SQLite cannot read fails with an `IllegalStateException` naming the file; the driver is closed and the bytes are left untouched. `PRAGMA foreign_keys = ON` is set before `Schema.create`, so creation is subject to it.
- Tests: new/existing empty file warning and schema creation; random bytes fail without changing the file; `PRAGMA foreign_keys` returns 1; existing data and newer-schema tests keep passing.

### CORE-7 — observable event drops and per-subscriber isolation (Fixed)
- `InProcessEventBus` now keeps one bounded `Channel` per active collector (capacity is a constructor parameter, default 512, `BufferOverflow.DROP_OLDEST`). `publish` is still non-suspending and non-blocking (`trySend`). Dropped elements are counted in `droppedEvents`, warned at most once per second per subscriber, and a fast collector has its own queue so one slow collector cannot make it miss events. `subscriberCount` is exposed for tests. The public `EventBus` interface is unchanged.
- Consumers checked: `ThingsService.kt:102` and `RealtimeHub.kt:115` (both collect `bus.events` and keep working).
- Tests: a slow collector drops while a fast one receives every event in order; 100 subscribe/cancel cycles leave zero subscribers; publishing with no subscribers is harmless. The concurrency test loops 20 rounds.

### CORE-6 — atomic SQLite rate-limit counters (Fixed)
- Added one query, `hitRateLimit`, to the existing `rate_limits` table in `Core.sq`: an upsert that resets the count when the window has passed, otherwise increments it, returning the resulting row. `SqliteBucketStore.hit` runs it via `Database.write`; `MemoryBucketStore.hit` uses `ConcurrentHashMap.compute`; `RateLimiter.hit` no longer needs the read-modify-write under its JVM lock (the lock now only guards the periodic sweep). The KDoc says the counters are shared across processes.
- Tests: 20 threads against one key allow exactly the limit (20 rounds); the window resets after `windowMs`; different keys do not affect each other; `reset` clears a key.

### CORE-8 — ids through `Ids` (Fixed)
- `ConfigJobService.enqueue` uses `Ids.next("cfg")`; `ThingsService` thing overrides use `Ids.next("tov")`. Searches found no code that parses those formats: the only `cfg_`/`tov_` mentions were these two producers, the audit/docs, and e2e logs (which already show `cfg_<ULID>` from the TypeScript side). Existing ids are still accepted because they are plain strings.
- Tests: 2,000 enqueues in a loop are distinct and are `cfg_` + a 26-character ULID; a rename gets a `tov_` + ULID id and a second rename keeps it. The installed clock is also checked there for CORE-9.

### CORE-9 — clock injection in the four files (Fixed)
- `ConfigJobService`, `ThingsService` and `ConfigJobApplier` take an optional trailing `TimeProvider` defaulting to `SystemTimeProvider`; `AdminService` already had one and now uses it for `startedAt` and uptime. `ServerModule` passes the real provider. Before: 31 direct `System.currentTimeMillis()` calls in `*/src/main` (the four files contributed 6+6+7+2). After: 10 remain, all outside the four files or default parameters/own implementations: `Audit.kt:24,37`, `TimeProvider.kt:9`, `RestoreApply.kt:44`, `Expectations.kt:157`, `SessionCookie.kt:21`, `FcmProvider.kt:25`, `UpdateSources.kt:127,159`, `ConfigWorker.kt:26`.
- Tests: a rename stores the fixed clock as `updated_at`; an enqueued job's `created_at` and `run_after` come from the clock; applying a job stamps `started_at`/`completed_at` from the clock; `AdminService.health` uptime follows the injected clock.

### CORE-11 — investigation only (unused)
- `jobs` is defined at `core/src/main/sqldelight/alice/core/db/Core.sq:32`; `insertJob` at `Core.sq:117-119`; `countPendingJobs` at `Core.sq:121-122`. No Kotlin or test code calls `insertJob`, `countPendingJobs`, `selectJob*`, or any other query on the table. Conclusion: unused (schema/queries only); the table was left in place.

**Not changed:** CORE-3 (global database lock), CORE-4, CORE-5 (optional AES-GCM consolidation not attempted), CORE-10, and all other modules.

### 56a. What review of the tranche 45 work found

Verified: the whole suite re-run from scratch (core 27, ha 42 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), no failures, no new warnings), the status tables recomputed from the rows, and the changed code read by the reported line numbers (database open, rate limiter and its new query, event bus, constructor wiring). The fixes for CORE-2, CORE-6, CORE-7 and CORE-8 are sound. Corrections and notes:
- **CORE-9 is Partly, not Fixed.** Direct `System.currentTimeMillis()` calls in main code went from 31 to 10, and the four busiest files now use the injected clock, but the audit item is about the code base calling the clock directly: one real use remains in `UpdateSources.kt:127` (manifest freshness check), the worker has its own private `now()`, and five server files keep it as a default parameter value. The totals were recomputed after the change (Fixed 82, Partly 52).
- **Event bus drop counter can over-count by a little.** A publisher that is iterating the subscriber list just as a collector is closing can send to a channel that has been closed; the channel's undelivered-element callback counts that as a drop. Rare and harmless to delivery, but `droppedEvents` is an upper bound. The warning also prints the bus-wide total, not the one subscriber's count.
- **An existing empty database file is still re-initialised** (with a warning), as the brief allowed: a truncated-to-zero live database therefore becomes an empty one, now visibly. A non-empty file that is not a database makes startup fail and is left untouched.
- A database whose schema creation was interrupted part-way (some tables present) is still treated as existing; unchanged from before.
Still open from this group: CORE-3 (global lock), CORE-5 (three AES-GCM copies; golden tests first), CORE-10 (hand-written env merge), CORE-11 (investigated: unused).

## 57. Fix status (tranche 46: ha module domain code)

Clean-up and hardening of the thing-building, capability and name-cleaning code. Thing ids, refs, role classification and wire output were not changed; the golden files below prove that. Nothing was verified against a real Home Assistant.

**Baseline (before changes):** core 27, ha 42 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), 0 failures. **Final:** core 27, ha 53 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), 0 failures. Added tests: 5 ha classes (4 golden groups + robustness), plus NameCleaner tests; golden resources under `ha/src/test/resources/golden/`. Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with only the 3 pre-existing Yubico warnings. New tests were run 3 times with `--rerun-tasks`.

**Characterization first.** Golden tests were written and the goldens generated by running the unchanged code with `GOLDEN_WRITE=1`, before any main file was edited: `things-home.txt` (7,921 bytes, 9 lines), `things-large.txt` (208,098 bytes, 327 lines), `capabilities.txt` (18,266 bytes, 288 lines), `names.txt` (2,961 bytes, 65 lines), `states.txt` (1,250 bytes, 26 lines). Afterwards every golden still passes byte for byte.

### HAD-12 — regexes compiled per call (Fixed)
All `NameCleaner` regexes moved to file-level `private val` constants (`WHITESPACE`, `PREFIX_SEPARATOR`, `LEADING_SEPARATORS`, `NONE_WORD`, `TRAILING_NUMBER`, `SHORT_TRAILING_NUMBER`). `names.txt` is unchanged. Added a 100,000-call timing test and a source-reading check that no `Regex(` remains inside a function.

### HAD-7 — magic `supported_features` numbers (Fixed)
Added private `FanFeature` (SET_SPEED=1, OSCILLATE=2, DIRECTION=4, PRESET_MODE=8), `ClimateFeature` (TARGET_TEMPERATURE=1, FAN_MODE=8, PRESET_MODE=16, SWING_MODE=32), `CoverFeature` (OPEN=1, CLOSE=2, SET_POSITION=4, STOP=8) and `LockFeature` (OPEN=1), named from Home Assistant's entity features. `capabilities.txt` is unchanged.

### HAD-3 — thing-building hot paths (Fixed)
- `hasChildren` now checks precomputed `parentDeviceIds` instead of rebuilding a device-id list for every thing.
- `UnionFind.find` is iterative with path compression.
- The two `looseEntity!!` uses were replaced by a null-safe branch.
- `Thing.hubThingId` is now `val`; hub links are applied with `copy` after all things are built. Searches found no assignment outside `ThingBuilder.kt`; server code only reads or copies `ThingView`.
Tests: a 20,000-device merge chain no longer overflows; 3,000 devices on 3,000 hubs; 12,000 devices on 12,000 hubs under a generous bound.
Indicative timing on this machine (5 runs, median): 1,000 devices **before 80 ms, after 8 ms**; 3,000 hubs before 821 ms, after 44 ms; 12,000 hubs before 6,510 ms, after 289 ms. These are local measurements, not a benchmark.

### HAD-1 — dead incremental cache (Fixed)
Removed `lastInventoryHash` and `lastThings` (old lines 39–40) and `buildThingsIncremental` (old lines 212–218). A search over `*/src/main`, `*/src/test` and `docs/` found no callers other than the audit text; the only live use was inside the removed function.

### HAD-9 — jammed locks (investigated, no change)
The TS oracle maps locks as `lock: (s) => ({ lock: s })` with `jammed` listed as a normal state (`backend/src/modules/home-assistant/capabilities/state-normalizer.ts:46`); it has no special case. Kotlin already matches this. `states.txt` includes `lock|jammed` and is unchanged.

### HAD-8 — capability gaps (investigated, no change)
The TS oracle also gives `media_player` only power, has no `alarm_control_panel` or `valve` detector, and has no `climate` power operation. Adding these would diverge from the oracle, so no change was made.

### Investigations
- **HAD-2:** favorites and group members store refs (`Identity.sq:590-596`, `Identity.sq:713-719`; producers at `FavoriteRoutes.kt:90` and `GroupsService.kt:109,129`); thing overrides store refs (`Identity.sq:787-799`, `ThingsService.kt:170`); entity overrides store entity ids (`Identity.sq:815-828`, `ThingsService.kt:264`); interaction stats and action defaults store thing ids (`Identity.sq:336-349`, `SmartService.kt:80,86`); home order stores a JSON list of thing ids (`Identity.sq:379-386`, `SmartService.kt:186,190`). A merge/split changes a thing id, so usage stats, defaults and saved order entries can be orphaned; favorites/groups/thing overrides keyed by ref may still resolve through ref matching. Recommendation: keep ids stable (or add an id alias map) before changing merge/split semantics.
- **HAD-4:** `Normalizer` is called only by `NormalizerTest` (`ha/src/test/.../NormalizerTest.kt:17,30,38`). `HaAppEvent` has no consumers. `EntityStateChangedEvent`, `EntityRemovedEvent`, `EntityAvailabilityChangedEvent` and `RegistryUpdatedEvent` are read by `RealtimeHub.kt:328-334`; `EntityAttributesChangedEvent` has no consumer. The file is not wholly dead, but the `Normalizer` object and the two placeholder functions are.
- **HAD-6:** no encode path currently serializes `Thing`, `ThingEntity` or `DeviceCapability`: routes build JSON manually, `DevicesResponse`/`CapabilitiesResponse` in `DeviceRoutes.kt:398-399` are unused, and no `encodeToString` target is one of these classes. A future responder using `CapabilitiesResponse` could still fail on the `@Contextual Any?` metadata.
- **HAD-10:** the TS inventory builder also iterates `raw.states` only (`backend/.../discovery/inventory.ts:61-98`), has `name`/`sourceName` the same, and uses `new Date()` as the sync timestamp. Kotlin matches it; entities with no state (disabled, never reported) are omitted by both.
- **HAD-11:** `FakeGateway` is used by `server/src/main/.../ServerModule.kt:78,81` and many server test classes (command, HA runtime, notifications, routes, smart, sync, things tests). No ha tests use it. `java-test-fixtures` (built into Gradle, offline-safe) could host it, but that needs build-file changes plus `testFixtures(project(":ha"))` in server; out of scope here.

**Not changed:** HAD-2 changes, thing-id/ref format, role classification, `Presentation.kt`, `Inventory.kt`, `Normalizer.kt`, and all server code.

### 57a. What review of the tranche 46 work found

Verified: the whole suite re-run from scratch (core 27, ha 53 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), no failures, no new warnings), the status tables recomputed from the rows (Fixed 86, Partly 51, Not done 161, Moot 6 = 304; high list matches), every changed region read by its reported line numbers, and both "no change" verdicts checked against the oracle (the TypeScript media-player detector is power only and has no alarm, valve or climate-power handling; its lock normaliser passes `jammed` through as-is). The refactors are sound: the iterative union-find is correct for chains and for a root, no number is left in the feature-bit checks, and a deliberately broken feature bit makes the capabilities golden fail (checked again in review, then restored).
One change made in review: the golden helper rewrote a golden file and then let the test pass when the environment variable `GOLDEN_WRITE=1` was set, so a CI that set it by accident would have kept green while silently replacing the pinned output. Rewriting now fails the test with a message asking for the diff to be reviewed.
Notes: the goldens were produced by the unchanged code before any edit, as required, and are the real safety net for later work on `ThingBuilder`, `CapabilityDetector`, `NameCleaner` and `StateNormalizer`. `Normalizer` and two of its placeholder functions are dead apart from their own test (HAD-4, left in place). HAD-2 (thing ids derived from refs) is still open and needs a decision before merge or split semantics change: favorites, groups and thing overrides store refs and mostly survive, but usage statistics, action defaults and the saved home order store thing ids and are orphaned.

## 58. Fix status (tranche 47: server boot and HTTP edge)

Fixes for SRV-10, SRV-11, SRV-12, the cancellation half of SRV-8, SRV-7, SRV-6 and the `getOrNull` part of SRV-3. SRV-9 and SRV-5 were investigated only. The 400/422 validation behaviour and CORS responses were not changed. Nothing was verified against a real Home Assistant.

**Baseline (before changes):** core 27, ha 53 (2 skipped), server 268 (4 skipped), worker 22 (1 skipped), 0 failures. **Final:** core 27, ha 53 (2 skipped), server 283 (4 skipped), worker 22 (1 skipped), 0 failures. Added 8 server test classes / 15 tests. Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with only the 3 pre-existing Yubico warnings. New tests were run 3 times with `--rerun-tasks`; lifecycle tests loop 20 rounds inside one run.

### SRV-10 — request ids (Fixed)
`normalizeRequestId` accepts a client value only when it is 1–64 characters of `A-Za-z0-9._:-`; otherwise it generates a UUID. The bad value is neither logged nor echoed. `RequestIdPlugin` uses the same function for the call attribute and the response header. Tests cover a valid id, 65 characters, spaces, `<script>`, newline/control characters, empty and absent ids.

### SRV-11 — session cookie helper (Fixed)
The ignored `secure` parameter is gone; the extensions map is constant and the `Secure` flag remains on `Cookie`. Cookie output is unchanged and tested for secure true/false, HttpOnly, Path, SameSite=Lax, Secure and Max-Age.

### SRV-12 — SessionPlugin startup validation (Fixed)
`SessionConfig.requireConfigured()` is called when the plugin is installed and names `auth` and/or `households` when missing. Tests show installing without them fails at startup and an `/api/v1/` request still works when both are set.

### SRV-8 — cancellation (Partly; cancellation half Fixed)
`exception<Throwable>` rethrows `CancellationException` before logging or responding; other throwables still get the ERROR log and 500 envelope. The 422/400 `BadRequestException` half is untouched parity work (F-012). The Ktor test host still terminates a cancelled call with a fallback status, so the test asserts no ERROR log and no “Internal server error” envelope rather than a non-500 status.

### SRV-7 — first-run setup code (Fixed)
`announceSetupCode` in `Lifecycle.kt` generates the code only for production with no configured code and no users, writes the same operator text once through a supplied writer, and returns the code. `Main` passes `System.err::println`; it is not logged. `docs/PARITY.md` updated. The e2e harness supplies `SETUP_CODE` itself (`e2e/env/stack.ts:228`), so it does not read this line.

### SRV-6 — background lifecycle (Fixed)
`BackgroundServices` owns one `SupervisorJob + Dispatchers.Default` scope, named components with start/stop, `startAll()` (reports failures by name, rethrows cancellation, carries on) and `stopAll()` (reverse order, started only, tolerates failing stops, idempotent, then cancels the scope). `Main` uses the list from `serverBackgroundServices(koin, lifecycle)`, logs `started N of M background services[; failed: …]`, and the shutdown hook calls `stopAll()` before the hub/server/database shutdown. The update loop and config-verify loop are coroutine jobs; config verification uses `runInterruptible(Dispatchers.IO)`. `HaEventBridge.stop()` and `RoutinesService.stop()` cancel their own scopes.

| Component | Start | Stop | What stop does | Fatal if start fails? |
|---|---|---|---|---|
| routine-recovery | `RoutinesService.resumeInterrupted()` | `RoutinesService.stop()` | cancels routine jobs’ scope | No |
| command-recovery | `CommandExecutor.recoverInterrupted()` | none | nothing (one-shot recovery) | No |
| ha-runtime | `HaRuntime.start()` | `HaRuntime.close()` | stops socket loop and cancels scope | No |
| ha-event-bridge | `HaEventBridge.start()` | `HaEventBridge.stop()` | cancels event collectors/loops | No |
| config-job-scheduler | `ConfigJobService.startScheduler()` | `stopScheduler()` | sets stop flag; daemon thread wakes/exits | No |
| retention | `Retention.start()` | `Retention.stop()` | cancels scope | No |
| housekeeping | `HousekeepingScheduler.start()` | `stop()` | cancels scope | No |
| backup-scheduler | `BackupService.startScheduler()` | `stopScheduler()` | sets stop flag; daemon thread wakes/exits | No |
| update-check | `UpdateService.tick()` loop | loop job cancel | cancels coroutine | No |
| config-verify | `ConfigSyncService.verifyAll()` loop | loop job cancel | interruptible IO job cancelled | No |

Recommendation: HA runtime and event bridge failures are worth surfacing prominently, but not fatal: the API can still serve local data. The schedulers and recovery jobs are background conveniences.

### SRV-3 — required wiring (Partly)
All **39** `getOrNull`/`getOrNull<T>()` in `ServerModule.kt` became `get()` or `lazy { get<T>() }` because every type is registered unconditionally. A new wiring test resolves 56 registered types and the push-provider list. It immediately found a real latent cycle: `single<CredentialRepository> { get() }` resolved itself recursively; it is now `get<SqlCredentialRepository>()`. Remaining `getOrNull` count: **0**. Positional multi-argument wiring remains; the module was not rewritten.

### SRV-9 and SRV-5 (investigated, no change)
- **SRV-9:** `Cors.kt:35-63` matches `@elysiajs/cors` for allowed origins, credentials and preflight cache; TS uses `cors({ origin: env.corsOrigins, credentials: true })` (`backend/src/app.ts:14`). `Allow-Credentials: true` without `Allow-Origin` has no browser effect. A denied preflight still returns 405 because the OPTIONS handler only runs after an allowed origin; TS answers 204 without granting CORS (F-012). The Ktor CORS artifact is **not** in the offline cache (`find ~/.gradle/... -name ktor-server-cors` empty), so this stays as-is.
- **SRV-5:** `configure` has 47 service lookups (`App.kt:106-152`) and 31 route registrations (`App.kt:224-254`), with about 100 import lines. Proposal: split into feature installers (auth, household, devices/things, realtime, smart, admin/ops, AI) under `routes/`, each taking `Koin` or explicit dependencies, then a short `routing { featureRoutes(...) }`. Not done.

**Not changed:** 400/422 behaviour, CORS/Date headers, SRV-1, SRV-2, SRV-4, CORE-3, route/service logic, and schema/data.

### 58a. What review of the tranche 47 work found, and a flaw in my earlier cancellation helper

Verified: the whole suite re-run from scratch (core 29, ha 53 (2 skipped), server 285 (4 skipped), worker 22 (1 skipped), no failures, no new warnings), the status tables recomputed (Fixed 91, Partly 52, Not done 155, Moot 6 = 304; high list matches), every changed region read by its reported lines, and the real server started by hand: `started 10 of 10 background services`, `/health` answered, a bad `X-Request-Id` was replaced by a generated one and a good one echoed, SIGTERM logged "stopping alice server" and exited with 143, nothing left running. The request-id, session-cookie, session-plugin, setup-code, lifecycle and wiring changes are sound.

**The flaw.** The new `exception<Throwable>` handler rethrew every `CancellationException`. An expired `withTimeout` is also a `CancellationException` (`TimeoutCancellationException`), and every call to Home Assistant through the gateway ends in one when Home Assistant does not answer within 30 seconds (`HaWebSocketGateway.sendCommand`, `withTimeout(30_000)`). So an unanswered history, energy or state request would have been rethrown instead of answered with the 500 envelope. Looking for the same mistake elsewhere found it in two more places:
- the new background-loop runner (`Lifecycle.loop`) would have ended a loop (update check, config verify) the first time its work timed out, silently;
- **my own `runCatchingNonCancellation` (section 35)** rethrew timeouts too. It wraps 42 calls that reach Home Assistant, among them the housekeeping loop's alert sweep and the Home Assistant runtime's config read, so one unanswered call could have stopped the housekeeping loop or ended the connection runtime for good (it would never have reconnected). The tranche 42 worker fix was the same bug in one place.
Fixed in the shared places: the helper now returns an expired timeout as a failure and still passes on a real cancellation; the request handler and the loop runner do the same. Three tests, each shown failing on the old code and passing on the fix: the helper (timeout becomes a failure; a real cancellation still stops the coroutine), a request whose `withTimeout` expires gets the 500 envelope, and a loop whose work times out every run keeps looping and still stops on `stopAll`.
Not changed, recommended: have `HaWebSocketGateway.sendCommand` turn its timeout into an ordinary exception type, as the worker's `HaAdminApi` now does (`HaTimeout`); every caller is then safe without knowing this rule. It could not be tested here without a websocket server, so it was left.
Lesson for later briefs: any code that rethrows `CancellationException` must say what it does with `TimeoutCancellationException`, and must have a test for it.

Notes on the delegated work: SRV-6 is marked Fixed although `BackupService` and `ConfigJobService` still run their own daemon threads with `Thread.sleep` (their `stop` only sets a flag and the thread ends after its wake-up; they are daemon threads so shutdown is not held up). SRV-8 stays Partly: the 422/400 split is parity work and untouched. The CORS denied-preflight difference (405 in Kotlin, 204 in TypeScript, finding F-012) is recorded under SRV-9 for the parity phase.

## 59. Fix status (tranche 48: validation and authorization gaps)

Input-validation and ownership fixes for policies, backup destinations/records, push tokens, automation triggers/actions and manual runs. Everything uses the existing 400 validation envelope; no response keys were renamed. Nothing was verified against a real Home Assistant.

**Baseline (before changes):** core 29, ha 53 (2 skipped), server 285 (4 skipped), worker 22 (1 skipped), 0 failures. **Final:** core 29, ha 53 (2 skipped), server 300 (4 skipped), worker 22 (1 skipped), 0 failures. Added 4 test classes / 15 tests. Compile: `./gradlew --offline compileKotlin compileTestKotlin --rerun-tasks` succeeded with only the 3 pre-existing Yubico warnings. New tests were run 3 times with `--rerun-tasks`; the push concurrency test loops 20 rounds.

### PRM-3 — policy validation (Fixed)
`createPolicy` now requires the app connection id, a current non-expired member of the same household for `member` policies, a non-blank entity target of at most 200 characters using the target forms (`entity:`, `device:`, raw entity ids, thing ids), and operations that are 1–50 unique lower-case names of at most 64 characters matching `^[a-z_]+$`. An empty operations list is treated like null and stored as no restriction, matching the old effective behaviour. Entity existence is deliberately not required: a policy may be prepared before a device is discovered. The operation-name vocabulary is not enforced because the capability/executor verbs are not a single reliable list; the shape is enforced instead.

### BKP-5 — backup destinations (Fixed)
`updateSettings` canonicalises the NAS path with `File.canonicalFile`, rejects roots, `/etc`, `/proc`, `/sys`, `/dev`, `/boot`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/usr`, `/root`, `/run`, `/var/run`, the live database's own directory (the default sibling `backups` folder remains allowed), non-directories and non-writable directories. The canonical path is stored, and the check runs again in `destinationDir` when a backup is written. A symlink/tampered setting pointing at a protected directory therefore fails the backup with `destination_unavailable` and writes nothing.

### BKP-3 — backup record lookup (Fixed)
Added `selectBackupRecordByIdOnly`. `findRecordById` is one query, and `onJob` reads the job's `household_id` from `config_jobs` and ignores a record belonging to another household with a WARN before touching it. The normal same-household path is unchanged.

### PSH-3 — push subscription ownership and limit (Fixed)
`PushService.upsert` now performs the limit check, update/insert and reassignment in one `db.write`. A new query deletes every other user's row for the same `(platform, token)`; when that happens an audit row `push.device_reassigned` is written with no token. Tests cover reassignment, duplicate registration, delivery to the previous owner reaching nobody, and 20 concurrent registrations over 20 rounds staying at or below the limit.

### AUT-2 — arrival trigger `userId` (Fixed)
A present `userId` must be a non-blank JSON string of at most 100 characters, and at save/preview/run time it must be a current member of the caller's household (400 "That person is not in this home"). A malformed number/object/empty/101-character value and another home's member are refused.

### AUT-4 — scene and routine actions (Fixed)
`checkActions` now requires the scene or routine to exist in the caller's household, with a 400 naming the scene/routine. `HaCompile.compileAction` and the routine scene loop throw `IllegalArgumentException` on a missing id instead of emitting `script.alice_scene_`.

### AUT-5 — manual runs (Fixed)
Each action runs in `runCatchingNonCancellation`; a failure is recorded as `{index,type,error}` and the next action runs, except a device action throwing `AppException` 403/404, which records and stops. `executed` counts only actions that actually ran; missing optional services increment `skipped`. The response keeps `ok`/`executed` and adds `failed`/`skipped`; the run is still recorded as `manual`.

Before (`POST /automations/{id}/run`, all-success):
```json
{"ok":true,"executed":1}
```
After:
```json
{"ok":true,"executed":1,"skipped":0,"failed":[]}
```
Failure sample:
```json
{"ok":false,"executed":2,"skipped":0,"failed":[{"index":1,"type":"mode","error":"Unknown mode"}]}
```

### Optional items
- **BKP-4 (Fixed):** retention sorts by `created_at` descending, then id, before `drop(keep)`; a test inserts rows out of order.
- **PRM-4 (Fixed):** one `defaultsSwitchedOff` filter and the unused `val changed` removed; the sensitivity output test is unchanged.
- **PRM-2 (Moot):** only the top-level `ReplaceResult` exists; the duplicate was already gone.

### Investigations
- **PRM-6:** every literal used by `Guards.requirePermission` is listed below: `ConfigSyncRoutes.kt:17,31,35`, `FavoriteRoutes.kt:73,78`, `GroupRoutes.kt:23,27,32,37,43,49`, `HaConnectionRoutes.kt:23,27,33,38,44,50`, `ModeRoutes.kt:42`, `SceneRoutes.kt:22,26,31,36,42,48`. All match `Permission.wire` entries (`Permissions.kt:7-29`); no typo or unmatched literal. Recommendation: replace them mechanically with `Permission.*.wire` in a separate tranche; no behaviour change.
- **BKP-1:** `BackupService.kt:85` reads `BACKUP_ENCRYPTION_KEY` and `:96` reads `BACKUP_ENCRYPTION_KEYS` from `System.getenv` (injectable via the constructor for tests). Moving them to `AppConfig` touches `AppConfig`, `ConfigLoaderFactory` env mapping, `ServerModule` wiring and backup tests, with no behaviour change. Recommendation: do it with the next config pass.

**Not changed:** F-037/F-041 response shapes, 400/422 parity, and all other audit items.
