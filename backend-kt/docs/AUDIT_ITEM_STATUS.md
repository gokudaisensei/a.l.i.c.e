# Status of every itemised finding in AUDIT_REPORT.md

As of 2026-11-12 (tranche 48: validation/authorization items PRM-3, BKP-3/4/5, PSH-3, AUT-2/4/5, PRM-2/4, investigations PRM-6/BKP-1; tranche 47 server boot/HTTP edge; tranche 46 ha domain; tranche 45 core; tranche 44 sync/HA connection; tranche 43 e2e defects). Rows updated since the 14:34 snapshot: NEW-10, NEW-7, LOG-3, DOM-1, DOM-12, RT-1, NEW-8, AND-3, DOM-8, LOG-13, SEC-7, AUT-3, TST-10, ADM-1, SQL-2, SUP-2, WRK-2, WRK-3, NEW-39, SYN-2, SYN-3, SYN-4, SYN-5, SYN-6, SYN-7, CORE-2, CORE-6, CORE-7, CORE-8, CORE-9, CORE-11, HAD-1, HAD-2, HAD-3, HAD-4, HAD-6, HAD-7, HAD-8, HAD-9, HAD-10, HAD-11, HAD-12, SRV-3, SRV-5, SRV-6, SRV-7, SRV-8, SRV-9, SRV-10, SRV-11, SRV-12, PRM-2, PRM-3, PRM-4, PRM-6, BKP-1, BKP-3, BKP-4, BKP-5, PSH-3, AUT-2, AUT-4, AUT-5. The tree was still being edited by another session while this was written, so treat a status as true at that time. Nothing here has been verified against a real Home Assistant.

**How this was made.** The report has 304 rows with an ID (`NEW-1`, `SQL-7`, `TST-4` and so on). Each was given one of four states:
- **Fixed**: the finding no longer applies in the code.
- **Partly**: some of it is fixed; the note says what remains.
- **Not done**: nothing was changed for it. This includes items never looked at again after the audit.
- **Moot**: the code it described was deleted or the finding turned out not to matter.

**How far each status was checked.** For about 35 items I re-read the current code or ran a search just now (for example NEW-6, NEW-7, NEW-8, NEW-10, NEW-15, NEW-20, NEW-24, NEW-26, NEW-30, NEW-36, NEW-38 to NEW-43, LOG-11 to LOG-16, SQL-2, SQL-13, TST-2, TST-12, SRV-8, SRV-10, SRV-11, CORE-2, ADM-4). The rest rely on my record of which changes were made in this work; for "Not done" that means "nothing in the fix log touches it", not a fresh reading of the code. "Fixed" items were each covered by a test or a compile/run check when the fix was made (the section number points to it); none was tried against a real Home Assistant, phone or container image.

**Where** is the section of `AUDIT_REPORT.md` (12 to 45) that records the change. A dash means no change was made.

## Totals

| State | Items |
|---|---|
| Fixed | 100 |
| Partly | 52 |
| Not done | 145 |
| Moot | 7 |
| **All** | **304** |

By severity in the report (C critical, H high, M medium, L low):

| Severity | Fixed | Partly | Not done | Moot | Total |
|---|---|---|---|---|---|
| C | 10 | 1 | 0 | 0 | 11 |
| H | 39 | 13 | 2 | 1 | 55 |
| M | 35 | 33 | 72 | 2 | 142 |
| L | 16 | 5 | 71 | 4 | 96 |

## High and critical items that are not fully fixed

| ID | State | What remains |
|---|---|---|
| CORE-3 | Not done | One lock still serialises all database work |
| HA-8 | Not done | Domain logic still in ha/, job ids and prune() unchanged (only the dedupe scoping changed) |
| SRV-3 | Partly | All 39 `getOrNull` dependencies are now required `get()`/`lazy { get() }`; positional multi-argument wiring and the hand-wired locator remain |
| SRV-4 | Partly | Hot paths in the hub and alerts are suspend; about ten runBlocking remain |
| NEW-8 | Partly | Ping, timeout and frame limits added; a client that cannot take a message within 5 s is dropped and `bufferedAmount()` now reports bytes in flight; the cookie name is still hardcoded |
| DOM-1 | Partly | Idempotency persisted, sleeping replaced by delay, per-entity lanes now serialise and coalesce; `cancel` still cannot stop an in-flight command, `command_attempts` is unused, the activity-feed text is still a long `when` |
| NEW-9 | Partly | The 30 s inventory cache removes the N-inventories cost; per-member and per-entity loops in groups, actions and energy are unchanged |
| DOM-4 | Partly | GlobalContext gone; remove() can still orphan HA scripts and steps are still raw JSON |
| DOM-3 | Partly | Bridge uses the connection's household and injected services; still polls every 2 s, still queries per event and logs failures at debug |
| WRK-2 | Partly | `ha/ConfigOps.validateOperation` tightened to worker-level rules (services, templates, triggers/conditions, entity ids, bounds) and a parity test asserts the same verdicts on shared cases; the two validators and APIs are still separate and worker still uses its own (left in place) |
| LOG-4 | Partly | Key collision fixed and keys persisted; check-then-record is still two steps |
| LOG-10 | Partly | Thread.sleep replaced by delay; the duplicated late-confirmation loop remains |
| LOG-7 | Partly | Bridge uses the connection's household, but still assumes one connection |
| SQL-8 | Partly | entity_settings, thing_overrides, entity_overrides and thing links are household-scoped; no foreign key to ha_connections and conn-1 is kept deliberately |
| AND-2 | Partly | Revocation sweep and persisted idempotency done; the other contract points were not individually checked |
| AND-3 | Partly | Ping, idle timeout, frame limit and dropping of stuck clients added; the cap of 10 sockets per user remains (its check-then-act race is fixed) |

## Every item

### CORE

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| CORE-1 | C | Fixed | `Schema.migrate(driver, 0, version)` sits in `try/catch { }`, then `PRAGMA user_version` is stamped curre… | Version-aware open, .sqm migrations, failures stop startup, version stamped after success | 12, 14 |
| CORE-2 | M | Fixed | `isNewFile` is `file.length() == 0`, so a truncated DB silently becomes a fresh schema. `PRAGMA foreign_k… | New/existing is decided from sqlite_master; existing empty files warn; unreadable files fail without being replaced; foreign_keys is on before schema creation. | 56 |
| CORE-3 | H | Not done | One `ReentrantLock` serializes every `read` and `write`, which defeats WAL and `busy_timeout`. With `runB… | One lock still serialises all database work | - |
| CORE-4 | M | Partly | Nested writes give nested transactions. Many callers do `read {}` then `write {}` for read-modify-write, … | Backup settings now read-modify-write in one transaction; other read-then-write callers remain | 45 |
| CORE-5 | M | Not done | Three AES-GCM implementations, each splitting `ciphertext‖tag` by hand; default-charset string conversion… | Three AES-GCM implementations remain (a fourth user, TokenVault, reuses Secrets); optional phase not attempted | - |
| CORE-6 | M | Fixed | Read-modify-write under a JVM `synchronized`; KDoc claims the worker can share counters, but the lock doe… | SQLite store has an atomic upsert/increment with a window reset; memory store uses atomic compute; the KDoc now reflects cross-process sharing. | 56 |
| CORE-7 | M | Fixed | `tryEmit` result ignored with `DROP_OLDEST`, so slow subscribers silently lose events. | Each collector gets a bounded channel; drops are counted, warned at most once a second, and a slow subscriber no longer affects a fast one. | 56 |
| CORE-8 | L | Fixed | Stringly prefix; other code bypasses it with `UUID` and `"cfg_${millis}_${random}"`. | Config jobs and thing overrides use Ids.next("cfg")/Ids.next("tov"); existing ids remain valid strings. | 56 |
| CORE-9 | M | Partly | 13 server files still call `System.currentTimeMillis()` directly. | ConfigJobService, ThingsService, ConfigJobApplier and AdminService use the injected TimeProvider (direct calls in main code went from 31 to 10); what remains: default parameter values (`Audit.kt`, `RestoreApply.kt`, `Expectations.kt`, `SessionCookie.kt`, `FcmProvider.kt`), the clock's own implementation, the worker's private `now()` (`ConfigWorker.kt:26`) and one real use in `UpdateSources.kt:127` (manifest freshness check) | 56 |
| CORE-10 | M | Not done | Hoplite loads the file, then about 150 lines hand-merge env vars with `copy()`; every new field needs edi… | Env merge is still hand-written (SECRETS_KEY and WEBAUTHN_EXTRA_ORIGINS were added by hand) | - |
| CORE-11 | L | Not done | `jobs` table has no apparent callers. | Investigated only: the table and its two queries have no callers in main or test code. | 56 |

### AUD

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| AUD-1 | M | Partly | `Audit.write` takes a raw `AliceDb` and defaults `now` to `System.currentTimeMillis()`; cannot take the i… | Audit.write now has an overload that goes through the Database lock; the default clock is still System.currentTimeMillis | 45 |

### HA

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| HA-1 | C | Fixed | Unreferenced from `server`/`worker` main code: `HaProjectionStore`, `ConnectionService`, `ConnectionManag… | The eight unused classes were deleted; the gateway is now used by HaRuntime | 13, 36 |
| HA-2 | H | Fixed | Auth failure throws `IllegalStateException`, never `HaAuthError`, so every "don't retry a bad token" bran… | auth_invalid raises HaAuthError, which is not retried | 13 |
| HA-3 | H | Fixed | `pending` is a plain map, never cleaned, and not failed when the socket drops (callers wait 30 s). | Pending calls are removed after use and failed when the socket drops | 13 |
| HA-4 | H | Fixed | `baseUrl.replace("http","ws")` replaces every occurrence; no disconnect handling or reconnect; callback s… | replaceFirst, disconnect detection, reconnect through HaRuntime, concurrent callback sets | 13 |
| HA-5 | M | Partly | `getConfig()`/`getServices()` return `emptyMap()`; `callService` falls back to `"ctx"`; two near-identica… | getConfig now works and the two sendCommand overloads were merged; getServices still returns an empty map and callService can still answer "ctx" | 13, 17 |
| HA-6 | H | Moot | `callService` ignores status and body, always returns `"ctx-rest"`, stringifies values, posts `body.toStr… | HaRestClient was deleted | 36 |
| HA-7 | H | Fixed | Backed by non-thread-safe `linkedMapOf` read and written from different threads. | StateCache synchronized | 13 |
| HA-8 | H | Not done | Domain sync logic living in `ha/` with a `Database` dependency; job ids `"cfg_${millis}_${random}"`; `pru… | Domain logic still in ha/, job ids and prune() unchanged (only the dedupe scoping changed) | 16 |
| HA-9 | M | Fixed | Each declares its own `ConnectionConfig`; `ConnectionService` is a third connection holder. | ConnectionManager, ManagedConnection and ConnectionService were deleted | 36 |
| HA-10 | M | Moot | `save` writes `attributes = null`; `load` returns empty attributes. | HaProjectionStore was deleted | 36 |
| HA-11 | M | Not done | `typealias HaStatisticsPeriod = String`; snake_case property names throughout; gateway returns `Map<Strin… | HaTypes unchanged | - |
| HA-12 | M | Not done | Mixes production calls with test hooks (`emitState`, `emitEvent`); `prev!!` default; `sendRawCommand` lea… | emitState and emitEvent are still on the production interface | - |
| HA-13 | L | Fixed | Compiler-proven dead branches (3x "cast can never succeed"). | The three impossible casts now read JSON values | 37 |

### HAD

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| HAD-1 | M | Fixed | An `object` with mutable `lastInventoryHash`/`lastThings`; `buildThingsIncremental` caches by `inv.hashCo… | Removed the two mutable caches and `buildThingsIncremental`; no callers found. | 57 |
| HAD-2 | M | Not done | `thingId = SHA-1(connection:ref)` truncated to 16 hex characters; a merge or split changes the ref and th… | Investigated only: favorites/groups/overrides store refs; interaction/action-default stats and home order store thing ids, which are orphaned by a ref change. | 57 |
| HAD-3 | L | Fixed | `hasChildren` rebuilds a list per iteration (O(n²·m)); `Thing.hubThingId` is a `var` while all else is `v… | Iterative union-find with path compression, precomputed parent device ids, no `looseEntity!!`, and immutable `hubThingId`; large-home timings improved (see 57). | 57 |
| HAD-4 | M | Partly | Two functions always `return null` ("placeholder") after computing unused locals; their `as? String` cast… | Investigated only: `Normalizer` and two of the five classes have no main callers; `EntityStateChangedEvent`, `EntityRemovedEvent`, `EntityAvailabilityChangedEvent` and `RegistryUpdatedEvent` are read by RealtimeHub. | 57 |
| HAD-5 | L | Not done | `val type: String = "…"` is an overridable constructor parameter. | Unchanged | - |
| HAD-6 | M | Not done | `DeviceCapability` is `@Serializable` with `Map<String, @Contextual Any?>` and no registered serializer; … | Investigated only: no current encode path serializes Thing/ThingEntity/DeviceCapability; `CapabilitiesResponse` is unused. | 57 |
| HAD-7 | M | Fixed | `supported_features` bits are magic numbers (1, 2, 4, 8, 16, 32). | Named Fan/Climate/Cover/Lock feature constants; golden capabilities output unchanged. | 57 |
| HAD-8 | M | Not done | No `play`/`pause`/volume for `media_player` (yet the executor has verbs for them); `alarm_control_panel` … | Investigated only: the TS oracle has the same gaps (media_player power only, no alarm/valve detector, no climate power); no change made. | 57 |
| HAD-9 | L | Not done | `Map<String, Any?>` result; no "jammed" for locks; redundant helper. | Investigated only: TS maps lock state through unchanged (including jammed); golden covers jammed; no change made. | 57 |
| HAD-10 | L | Not done | `name` and `sourceName` always identical; `Instant.now()` default; only entities with a state are include… | Investigated only: TS inventory also iterates states only and has the same name/sourceName and clock behavior; no divergence changed. | 57 |
| HAD-11 | L | Not done | Test double in `ha/src/main` with public mutable state and its own `Triple`/`Quad`. | Investigated only: used by server main DI and server tests; `java-test-fixtures` could host it but the build change is outside scope. | 57 |
| HAD-12 | L | Fixed | Elvis and `!!` on non-null (compiler warnings); regexes compiled per call. | All NameCleaner regexes are file-level constants; golden names unchanged and a 100k-call timing test passes. | 57 |

### CMP

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| CMP-1 | M | Not done | The Jinja templates are duplicated as exact-match constants; the worker rejects any other template, with … | Unchanged | - |
| CMP-2 | M | Not done | `power_over_limit` fires at `limitW * 0.9` (hidden constant) with no debounce. (H) | Unchanged | - |
| CMP-3 | M | Not done | Missing fields default silently (empty ids, mode `"home"`, `"00:00"`); non-object conditions/actions are … | Unchanged | - |
| CMP-4 | M | Not done | Object ids are `alice_scene_<ULID>` (upper-case); HA ids are normally lower-case slugs; `.replace("-", "_… | Unchanged | - |
| CMP-5 | L | Not done | Another copy of the any-to-JSON helpers. | Unchanged | - |

### SRV

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SRV-1 | C | Fixed | `single { FakeGateway() }` and `single<HomeAssistantGateway> { FakeGateway() }` are two separate instance… | One shared gateway behind SwitchableGateway; HaRuntime points it at the real Home Assistant | 13 |
| SRV-2 | H | Fixed | `InMemoryCommandStore` is registered twice as two different instances (once per type). | One command store, bound once | 12, 14 |
| SRV-3 | H | Partly | Positional `get()` wiring (up to 9 args); many `getOrNull()` deps turn wiring mistakes into silent featur… | All 39 `getOrNull` deps are now required `get()`/`lazy { get() }` and the recursive CredentialRepository binding is fixed; positional multi-argument wiring remains. | 58 |
| SRV-4 | C | Partly | 34 `runBlocking` calls (`RealtimeHub` 7, `AlertsService` 7, others) block engine/Default threads and can … | Hot paths in the hub and alerts are suspend; about ten runBlocking remain | 33 |
| SRV-5 | M | Not done | `configure(koin)` is a 40-service locator hand-wiring 30 route functions; about 60 import lines (one dupl… | Investigated only: 47 service lookups and 31 route registrations; splitting by feature needs a design pass. | 58 |
| SRV-6 | H | Fixed | Boot is a pile of `runCatching { … start() }` that discard failures, a raw daemon thread with `Thread.sle… | BackgroundServices names every component, reports failed starts, runs update/verify as coroutines, and stops all in reverse on shutdown; HaEventBridge and RoutinesService have stop(). | 58 |
| SRV-7 | M | Fixed | First-run setup code logged in plaintext at WARN. | The setup code is announced once on stderr through a testable function, never through logging; docs updated. | 58 |
| SRV-8 | M | Partly | All `BadRequestException`s return 422 (contradicting the comment); `exception<Throwable>` catches `Cancel… | Cancellation exceptions are rethrown and not logged; the 422/400 validation half is untouched parity work. | 58 |
| SRV-9 | M | Not done | Reimplements Ktor `CORS`; `Allow-Credentials: true` on every response; echoes the request method. | Investigated only: Ktor cors artifact is not in the offline cache; denied preflight still differs from TS (F-012). | 58 |
| SRV-10 | M | Fixed | Trusts a client-supplied `X-Request-Id` with no length or charset limit. | Only 1–64 characters of `A-Za-z0-9._:-` are accepted; anything else becomes a generated UUID. | 58 |
| SRV-11 | L | Fixed | `sessionCookieAttributes(secure)` ignores its parameter. | The unused parameter is gone; cookie output is unchanged and tested. | 58 |
| SRV-12 | L | Fixed | `lateinit var` config fails at first request. | SessionPlugin validates auth and households at install time with a message naming what is missing. | 58 |

### NEW

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| NEW-20 | M | Not done | `getSession` runs on every API request inside `database.write {}` (a write transaction on the global lock… | getSession still runs inside a write transaction on every request | - |
| NEW-21 | M | Partly | No request body size limit anywhere, including unauthenticated auth endpoints. (V, grep) | Declared body size capped at 1 MB; chunked bodies are not capped | 16 |
| NEW-22 | M | Fixed | With `trustProxy` on, the first `X-Forwarded-For` entry is used, which clients control; per-IP rate limit… | Last X-Forwarded-For entry is used | 16 |
| NEW-8 | H | Partly | `bufferedAmount()` is hardcoded `0`, so the slow-consumer check never fires; `install(WebSockets)` sets n… | Ping, timeout and frame limits added; a client that cannot take a message within 5 s is dropped and `bufferedAmount()` now reports bytes in flight; the cookie name is still hardcoded | 12, 49 |
| NEW-14 | H | Fixed | Only `sweep()` checks `isSessionActive`, and nothing calls it. A logged-out or revoked session keeps its … | Periodic sweep drops revoked sessions; tested | 12, 33 |
| NEW-15 | M | Not done | Activity and alert events are sent to broadly-permitted clients without the per-device visibility check u… | Activity and alert events still go to clients without the per-device visibility check | - |
| NEW-9 | H | Partly | `EnergyService.meters()` calls `visible()` per thing, so N things cost N inventories. `GroupsService.crea… | The 30 s inventory cache removes the N-inventories cost; per-member and per-entity loops in groups, actions and energy are unchanged | 32 |
| NEW-10 | H | Fixed | The read path writes: it re-links stale refs by deleting every member and re-inserting inside the loop. T… | Reading a group no longer writes: stale refs resolve on the fly. Repair is `relinkStaleMembers`, one transaction per group, run by the housekeeping scheduler | 46 |
| NEW-28 | M | Not done | `ScenesService.view` returns the full action list (entity ids and parameters) to non-guest members even f… | ScenesService.view still returns the full action list for denied entities | - |
| NEW-27 | M | Not done | `updateScene/updateRoutine/updateAutomation` rewrite every column from a stale snapshot; `activate` and `… | Updates of scenes, routines and automations still rewrite every column from a stale snapshot | - |
| NEW-18 | H | Fixed | (a) `NotificationsService.notify` calls `runBlocking { hook(...) }`, which runs `push.deliver` with block… | (a) push runs off the request, (b) FCM and (c) WebPush result handling fixed; (d) blocking http.send inside suspend and (e) the unused library object remain | 16, 18 |
| NEW-24 | M | Not done | Quiet hours are stored without validating `from`/`to`; `inQuietHours` calls `toInt()` and a malformed val… | Quiet hours still not validated | - |
| NEW-16 | H | Fixed | (a) Backups are written to `user.dir/data/backups`, not next to the DB; in the shipped Docker setup that … | (a)(b)(c)(e)(f)(g) fixed; (d) whole-DB snapshot is moot while an install has one household | 19, 29, 42 |
| NEW-25 | M | Partly | Update state is per household but the operation is server-wide (one binary, one marker file); each househ… | The settings read-modify-write race is fixed (backup settings atomic); per-household update state, blocking backup I/O in start() and runCatching around tick remain | 45 |
| NEW-13 | H | Fixed | The HA long-lived token is stored in plaintext in `operational_token_enc`; `Secrets.encryptSecret/decrypt… | HA token encrypted with TokenVault | 15 |
| NEW-17 | H | Fixed | `deleteConfigJobsByDedupeKey` deletes pending jobs by key only (no household filter); `"verify"`, `"helpe… | Dedupe key now scoped by household | 16 |
| NEW-23 | M | Fixed | Recovery codes (about 50 bits) and invitation codes are stored as unsalted SHA-256; if a DB or unencrypte… | Recovery and invitation codes stored as keyed HMAC; old hashes still accepted | 28 |
| NEW-11 | C | Fixed | No code publishes entity state, availability, removed or registry events (only the uncalled `Normalizer` … | HaRuntime feeds the state cache and publishes entity events | 13 |
| NEW-12 | C | Fixed | Every command with an expectation waits 5 s and ends `TIMED_OUT`; undo has no `previousState`; history al… | HaRuntime connects the gateway, reconnects and records status | 13 |
| NEW-1 | C | Fixed | Most likely a silent no-op: current Home Assistant treats an entity call with no target as an empty targe… | Dispatch now sends the entity as a target; CommandDispatchTest checks the payload | 12 |
| NEW-2 | C | Fixed | `hvac_mode`, `preset_mode`, `fan_mode`, `swing_mode`, `direction` reach HA in literal quotes; numbers bec… | JsonElements converted properly (anyToJsonElement); no quoted strings | 12 |
| NEW-3 | H | Fixed | Toggling an "on" device does nothing; the expectation wants the opposite state, so it times out. | toggle maps to toggle | 12 |
| NEW-4 | C | Fixed | `sensitivityPolicy()`/`resolveSensitivity()` have zero callers; step-up uses a hardcoded `setOf("unlock",… | One sensitivity policy used by executor, actions and automations; rules enforced | 12 |
| NEW-5 | C | Fixed | `POST /devices/{id}/commands` takes `entityId` from the body and checks `vis.canSee(entityId)`, which bui… | Entity must belong to the thing in the URL (404 otherwise); RouteFixesTest | 12 |
| NEW-6 | H | Fixed | `p["rgb"] as List<*>` succeeds for `JsonArray`, then elements are cast to `Number`, which fails for `Json… | set_color expectation and normalized colour fixed; covered in CommandDispatchTest | 12 |
| NEW-7 | H | Fixed | Calls `execute()` as the original user without re-checking policies. (R) | `CommandExecutor.undo` (now `suspend`) checks the device rules for the person who made the original command and refuses (404) if they are denied, no longer a member, or the device is gone; the route still checks the person asking | 12, 47 |
| NEW-30 | M | Partly | No callers for `RealtimeHub.sweep`, `ThingsService.favoriteList` (also compares ids with refs), `ModeMirr… | The unused HA classes were deleted; favoriteList, consumePushEcho, helperState, buildThingsIncremental, the Normalizer object, Plan and PresenceService.persons are still unused | 36 |
| NEW-26 | M | Fixed | `Audit.write(db.raw …)` at 24 sites bypasses the lock and transactions. (V) | Audit.write goes through the Database lock at all sites | 45 |
| NEW-31 | C | Fixed | These handlers pass a `Map` with values of different types to `call.respond`. Ktor then cannot pick a ser… | Typed responses for notifications and rollback, JsonObject for operator devices; 54-endpoint read sweep | 12, 26 |
| NEW-32 | H | Fixed | `start()` launches the run coroutine on `Dispatchers.Default` and only afterwards stores `live[runRow.id]… | Run is registered before it starts; race test | 12, 25 |
| NEW-33 | M | Partly | (a) Per NEW-12, every device or scene step waits 5 s for confirmation and ends `TIMED_OUT`, which the rou… | (a) fixed by the runtime; (b) pruning still runs only at startup; (c) no handler for routine.finished; (d)(e)(f) unchanged | 13 |
| NEW-34 | M | Fixed | `ChallengeData(inviteCode = …)` is stored as JSON in `webauthn_challenges.data_`, so invitation codes sit… | Challenge keeps the invitation id, not the code; expired challenges purged | 27, 21 |
| NEW-35 | H | Fixed | The "reference" supervisor stops the service, does not download or verify anything (the download and `sha… | Supervisor downloads, verifies and rolls back; CI jobs can fail | 22 |
| NEW-36 | M | Not done | `generateBackup` swallows every error and returns `backupId = backup_job_id ?: ""` with `sizeBytes = 0`, … | Worker generateBackup still swallows errors and reports an empty id | - |
| NEW-37 | M | Fixed | `PATCH /household` always returns `mode = "home"`. `PATCH /members/{id}` passes `body.expiresAt` (null wh… | Real mode returned, expiry kept, bad role is 400 | 12 |
| NEW-38 | M | Partly | PATCH "provided or null" semantics are inconsistent. `GroupRoutes` treats the icon as provided whenever a… | Group icon fixed; routine and scene PATCH still treat icon != null as provided | 12 |
| NEW-39 | M | Partly | `FavoritesResponse(val devices: List<alice.ha.Thing>)` puts the internal domain `Thing` on the wire (enti… | GET/PUT favorites now return presented device views (same shape family as GET /devices) instead of the internal Thing, so non-empty lists no longer 500 on serialization; unknown/invisible ids are still dropped without per-id validation/errors and ordering/visibility edge cases vs TS (e2e F-022) were not fully aligned | 54 |
| NEW-40 | L | Not done | `BackupListResponse` is declared twice (service file and route file). `POST /updates/{id}/rollback` turns… | BackupListResponse still declared twice; malformed rollback body still silently becomes restoreData=false | - |
| NEW-41 | L | Partly | `InvalidTransitionException` is never thrown. `FailureCode.UNKNOWN_ENTITY`, `HA_REJECTED` and `NOT_CONFIR… | The command store now purges old rows; unused failure codes and InvalidTransitionException remain | 14 |
| NEW-42 | L | Not done | `AuthenticatorSelection` defaults (`residentKey = "preferred"`, `requireResidentKey = true` with `EncodeD… | Passkey model defaults still disagree with the engine | - |
| NEW-43 | M | Not done | The preflight answer sets `Access-Control-Allow-Methods` and `Max-Age` but never `Access-Control-Allow-He… | CORS preflight still sends no Access-Control-Allow-Headers | - |
| NEW-44 | H | Fixed | The Kotlin port diverges from the TS oracle on step-up. TS: default sensitive operations are only `lock.u… | Step-up only for lock.unlock/lock.open by default, rules enforced, most specific wins | 12 |

### RT

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| RT-1 | M | Fixed | Per-user limit of 10 is a check-then-act race. | Counting and registering are one step under a lock; 40 simultaneous connects for one user accept exactly 10 | 49 |
| RT-2 | M | Not done | Collector and flush loops start in `init` and are never cancelled. | Unchanged | - |
| RT-3 | M | Not done | Handles both event families (`ha` and `core`) because both exist (HAD-4). | Unchanged | - |
| RT-4 | L | Not done | Message types and resources are bare strings. | Unchanged | - |
| RT-5 | M | Not done | `canClientSeeEntity` reloads all policies per client per event. | Unchanged | - |

### DOM

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| DOM-12 | H | Fixed | `messageLimiter` lists are not thread-safe; `enqueue` claims to drop "non-critical" but drops the oldest … | Rate-limit list accessed under a lock; over the queue limit, replaceable snapshots are dropped before notifications, activity items or command results; `stop()` closes every socket and stops the loops | 49 |
| DOM-1 | H | Partly | `entityQueues`/`entityLocks` are never drained or removed, so there is no real per-entity serialization o… | Idempotency persisted, sleeping replaced by delay, per-entity lanes now serialise and coalesce; `cancel` still cannot stop an in-flight command, `command_attempts` is unused, the activity-feed text is still a long `when` | 14, 48 |
| DOM-2 | H | Fixed | Every `things()`/`find`/`findEntity` rebuilds the full inventory (four gateway calls) and runs `ThingBuil… | Inventory cached; overrides, merges and splits per household | 24, 32 |
| DOM-14 | M | Not done | A typed `Permission` enum exists but guards take strings (see PRM-6). | Guards still take strings | - |
| DOM-4 | H | Partly | `RoutinesService`: steps are raw `JsonObject` with string `type`; states are strings; `remove()` deletes … | GlobalContext gone; remove() can still orphan HA scripts and steps are still raw JSON | 31 |
| DOM-5 | M | Not done | Scene, routine and automation sync code is the same logic three times (the `alice_*` id formulas appear 1… | Scene, routine and automation sync still triplicated | - |
| DOM-7 | M | Partly | `ManifestUpdateSource.latest()` is `suspend` but calls blocking `HttpClient.send`; hand-rolled semver com… | The update marker is built with serialization; blocking send, string pre-release compare and hand-rolled Ed25519 remain | 22 |
| DOM-8 | H | Fixed | `RestoreApply` moves the live DB aside then moves the pending file in; no rollback if the second move fai… | Staged file is re-checked at start (integrity, schema not newer than this build, required tables, at least one user and household); the live database and its write-ahead log are moved aside together and put back if the swap fails; staging is written then renamed | 50 |
| DOM-9 | M | Not done | `BackupService`: `System.arraycopy` with offsets 5/17/33, `catch (_: Throwable) {}` per key, `Thread.slee… | Offsets, per-key catch, sleeping scheduler and own SHA-256 unchanged | - |
| DOM-3 | H | Partly | `HaEventBridge` uses `households.firstOrNull()`, queries all households on every state change, polls ever… | Bridge uses the connection's household and injected services; still polls every 2 s, still queries per event and logs failures at debug | 17, 30 |
| DOM-13 | L | Not done | `AuthService`/`AuthRoutes`: best code; lockout response reveals the credential exists; five failures can … | Lockout behaviour unchanged | - |
| DOM-10 | M | Not done | `AskAliceService`/`AnthropicInterpreter` builds request JSON with a `StringBuilder` and hand-written esca… | AskAlice request JSON still hand-built | - |

### GRP

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| GRP-1 | M | Not done | `GroupDevice.available = thing.primary != null` means "has a primary", not "online". | Unchanged | - |
| GRP-2 | L | Partly | `target: String = "first"` string option; hardcoded `"conn-1"`; compiler warnings at lines 60, 61, 82. | The three compiler warnings are gone and conn-1 is a constant; the string target option remains | 37, 41 |

### FAV

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| FAV-1 | M | Not done | Favorites are stored by `ref`; merge/split changes refs (HAD-2), so favorites disappear. Defaults to `"co… | Favorites still keyed by ref, which merges and splits change | - |

### SYN

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SYN-1 | M | Not done | `ConfigJobApplier` is a third copy of the sync-state update (with `ConfigJobService.postApply` and the th… | Unchanged | - |
| SYN-2 | M | Not done | The in-process applier handles only `helper.ensure_mode_select` and `voice.expose` and is polled only for… | Investigated only (no change): jobs are enqueued only when an admin token is set, while the in-process applier polls connections without one, so it is normally unreachable (reachable only after token removal or manually seeded jobs). | 55 |
| SYN-3 | L | Fixed | `applyPending(null)` does nothing; it also selects `running` jobs, so it could re-run a job the worker is… | `applyPending` now skips `running` jobs; `null` applies every household needing the in-process fallback (connections without an admin token), and HaEventBridge calls it once. | 55 |
| SYN-4 | M | Fixed | `testConnection` uses blocking `HttpURLConnection` in a route; reports `ok = true` for HTTP 401; `putConn… | `testConnection` is suspend/off the request thread; 401 is `ok=false`, `reachable=true` with a clear error; `putConnection` accepts only http/https URLs with a host. | 55 |
| SYN-5 | M | Fixed | `updateHaConnectionStatus` has no callers, so status, version, last-connected and last-error never update… | HaRuntime writes status, version, last connected, last error, and now cache entity count and syncedAt; HaConnectionView exposes both. | 13, 55 |
| SYN-6 | L | Fixed | `resyncConnection` swallows errors and always returns `ok: true`; `verifyAll()` has no per-household try/… | `resyncConnection` returns `ok=false` with an error when verification throws or cannot run; `verifyAll` handles each household separately and logs failures. | 55 |
| SYN-7 | L | Fixed | `reconcileScenes` uses `runBlocking` and a different `Caller` type than its siblings. | `reconcileScenes` is suspend with no `runBlocking`; `verifyAll` is per-household. | 55 |

### AUT

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| AUT-1 | M | Not done | Automation definitions parsed and validated as raw `JsonObject`s (about 150 manual lines). | Unchanged | - |
| AUT-2 | M | Fixed | `validateTrigger`: `t["userId"]!!.jsonPrimitive.content` evaluates and discards, so a malformed `userId` … | `userId` must be a non-blank string of at most 100 characters and a current member of the caller's household at save time. | 59 |
| AUT-3 | H | Fixed | `notify` actions accept any `userIds` with no check that they are members. | Saving an automation whose notify action names a non-member is refused (400); at run time, and for ids carried by a Home Assistant `alice_notification` event, `notifyUsers` skips anyone who is not a current recipient in the home | 51 |
| AUT-4 | M | Fixed | Scene and routine ids in actions are not checked for existence; `compileAction` emits `script.alice_scene… | Save-time checks require a scene/routine in the caller's household; compilation now throws on a missing id instead of emitting an empty script name. | 59 |
| AUT-5 | M | Fixed | `runNow` applies actions in sequence with no failure handling; `executed++` counts actions skipped becaus… | Each action is isolated and reported; failures continue except device 403/404, skipped services are counted separately, and the response adds `failed`/`skipped`. | 59 |
| AUT-6 | L | Not done | Third copy of the mode list. | Unchanged | - |
| AUT-7 | M | Partly | `compileContext()` uses `GlobalContext`, `runBlocking` and `"conn-1"`. | GlobalContext removed and conn-1 centralised; runBlocking remains | 31, 41 |
| AUT-8 | L | Not done | Several non-atomic writes per operation. | Unchanged | - |
| AUT-9 | L | Not done | Four `Caller` types (`things`, `routines`, `automations`, `AccessCaller`) converted by hand. | Unchanged | - |
| AUT-10 | L | Not done | `describe()` builds user-facing English strings in the service. | Unchanged | - |

### SCN

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SCN-1 | L | Partly | `activate` runs actions one at a time, each waiting up to 5 s for confirmation (and always timing out, NE… | No longer always timing out, now that the runtime confirms commands; actions still run one at a time | 13 |

### SMT

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SMT-1 | M | Not done | `sceneChips` builds `HomeSceneChip(it.first, it.first, …)`: the scene name is its id. | Unchanged | - |
| SMT-2 | M | Partly | `home()` makes two DB queries per device; builds the inventory twice; runs `canSee` per entity. | Inventory is cached, so building it twice is cheap; the per-device queries and canSee loop remain | 32 |
| SMT-3 | M | Not done | Usage counters read then write in separate transactions (lost updates); many queries filter in Kotlin. | Unchanged | - |
| SMT-4 | L | Not done | `"%.2f".format(...)` is locale-dependent. | Unchanged | - |
| SMT-5 | L | Not done | `tz` defaults to `"UTC"` here while energy reads the household timezone. | Unchanged | - |
| SMT-6 | L | Not done | Alert level uses `it.data.toString().contains("tamper")`. | Unchanged | - |
| SMT-7 | L | Not done | Regexes compiled per call; trigrams recomputed per search. | Unchanged | - |
| SMT-8 | L | Not done | Feature flags checked inline in about ten places. | Unchanged | - |

### ENG

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| ENG-1 | M | Not done | Unknown units are treated as kWh/W; `GJ` uses an approximation. | Unchanged | - |
| ENG-2 | M | Not done | `parseTimeEnergy` treats any 10+ digit number as milliseconds; a 10-digit epoch in seconds becomes Januar… | Unchanged | - |
| ENG-3 | M | Not done | `pattern()` subtracts fixed 24-hour days, wrong across DST. | Unchanged | - |
| ENG-4 | M | Not done | `consumption()` swallows every error and reports "unavailable". | Unchanged | - |
| ENG-5 | L | Not done | `pattern()` makes up to 9 sequential queries, no cache. | Unchanged | - |
| ENG-6 | L | Not done | Invalid `resolution` becomes `"hour"`; invalid timezone becomes UTC. | Unchanged | - |
| ENG-7 | L | Not done | `mapToJsonObject` exists only to bridge the untyped gateway result. | Unchanged | - |
| ENG-8 | L | Not done | Uses the `HomeAssistantGateway` singleton and `"conn-1"`. | Unchanged | - |

### HST

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| HST-1 | M | Not done | `parseTime` is a copy of `parseTimeEnergy`, with the same epoch bug. | Unchanged | - |
| HST-2 | M | Not done | HA errors swallowed (`getOrDefault(emptyList())`), so an outage looks like no data. | Unchanged | - |
| HST-3 | L | Not done | Quadratic attribute-log merge; the only `@Suppress` in the project; redundant `!!`. | Unchanged | - |
| HST-4 | L | Not done | `recordAttributes` is another inline converter and swallows write errors. | Unchanged | - |

### NTF

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| NTF-1 | M | Not done | `onCreated` is a `var` wired in `App.configure`, not in DI. | onCreated is still a var set in App (it now delivers asynchronously) | 16 |
| NTF-2 | L | Not done | `notifyAdmins` calls `listMembers` twice. | Unchanged | - |

### ACT

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| ACT-1 | M | Not done | `record` dedupes by scanning recent rows with a check/insert race; `list()` paging logic is convoluted. | Unchanged | - |
| ACT-2 | L | Not done | `ActivityService.prune()` returns a real count (via `RETURNING`); `AdminService.pruneAudit` and `ConfigJo… | Unchanged | - |

### ALR

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| ALR-1 | M | Not done | `AlertsService.toWatts` is a third copy; thresholds hardcoded. | Unchanged | - |
| ALR-2 | L | Partly | `sweepLeftOpen` uses `"conn-1"` and `runBlocking`. | runBlocking removed; the conn-1 constant is shared, not removed | 33, 41 |
| ALR-3 | L | Not done | `evaluatePower` does the cheap `device_class` check last. | Unchanged | - |

### PSH

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| PSH-1 | L | Not done | `PushResult`, `EntityRole`, `ThingKind`, `TimeOfDay` use lower-case enum entries. | Unchanged | - |
| PSH-2 | L | Not done | `rate` map grows per user; per-user lists are unsynchronized. | Unchanged | - |
| PSH-3 | L | Fixed | `upsert` count-then-insert is racy; one device token registered by two users pushes to both. | Limit and insert are one transaction; a newly registered platform/token is removed from every other user and audited without the token. | 59 |
| PSH-4 | L | Not done | `parseKeys` tries four formats and hides every failure. | Unchanged | - |
| PSH-5 | L | Not done | FCM `accessToken` does a blocking call under `@Synchronized`. | Unchanged | - |

### BKP

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| BKP-1 | M | Not done | Reads `BACKUP_ENCRYPTION_KEY(S)` straight from `System.getenv`. | Investigated only: two env reads remain in BackupService; moving them to AppConfig touches config, DI and tests. | 59 |
| BKP-3 | M | Fixed | `findRecordById` queries every household. | `findRecordById` is one id query and a job whose record belongs to another household is ignored with a WARN. | 59 |
| BKP-4 | L | Fixed | `retain()` assumes newest-first ordering. | Retention sorts newest-first by created_at then id; tested with out-of-order rows. | 59 |
| BKP-5 | M | Fixed | `nasPath` blocks only `..`; any writable absolute directory is accepted. | Canonical NAS paths reject roots, protected system dirs, the live DB folder, files, unwritable dirs and are re-checked when writing. | 59 |
| BKP-6 | L | Not done | One full-database copy per household per scheduled run; all held in memory. | Unchanged | - |
| BKP-7 | L | Not done | `verify` decompresses synchronously in a request thread. | Unchanged | - |

### UPD

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| UPD-1 | L | Not done | `nextWindowStart` is an hour off across DST. | Unchanged | - |
| UPD-2 | L | Not done | `triedBefore` stops auto-update retrying a failed version forever. | Unchanged | - |
| UPD-3 | L | Not done | `check()` catches `Throwable`, recording cancellation as an error. | Unchanged | - |
| UPD-4 | L | Not done | Status values are strings. | Unchanged | - |

### ADM

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| ADM-1 | H | Fixed | `audit()` loads the latest 2000 audit rows for all households and filters in memory; `audit_log` is index… | One query per page for the home, with an optional action prefix and a (time, id) cursor, backed by a new index on (household, time, id); actor names are looked up once per distinct person | 52 |
| ADM-2 | M | Not done | `pruneAudit`/`pruneAttributeLog` always return 0 and prune globally. | Unchanged | - |
| ADM-3 | M | Not done | `diagnostics()` loads full tables just to count, queries per member, uses `runBlocking`; `metrics()` repe… | Unchanged | - |
| ADM-4 | L | Not done | `operationalTokenEncryption` is hardcoded `false`. | Still hardcoded false, which is now wrong: the Home Assistant token is encrypted | 15 |
| ADM-5 | L | Not done | `startedAt` is service-construction time; hand-built JSON. | Unchanged | - |

### SUP

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SUP-1 | M | Fixed | `expireSupportSessions` (a write) runs at the start of almost every method, including read paths. | Active-session read no longer writes; history derives expiry from the end time | 27 |
| SUP-2 | M | Fixed | `householdLog`/`operatorTrail` read the latest 500 audit rows across households and filter in memory. | Both read their own home's rows with a query (by action prefix, and by actor type) | 52 |
| SUP-3 | L | Not done | `"support.expired"` log text exists but nothing writes that audit action. | Unchanged | - |
| SUP-4 | M | Partly | `OperatorService.devicesOf` calls `things.visible` per thing; `authenticate` writes `last_seen` every cal… | Inventory is cached; authenticate still writes last_seen on every call | 32 |

### INS

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| INS-1 | M | Not done | `list()` does a `runBlocking` presence count (inventory plus all states) each time; `tick()`/`dismiss()` … | Unchanged | - |

### PRS

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| PRS-1 | M | Partly | Every presence query builds the inventory and fetches all states; sync `persons()`/`people()` are stubs; … | Inventory is cached so presence queries are cheap; the sync stubs remain | 32 |

### MOD

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| MOD-1 | M | Partly | `ModesService.set` audits via `database.raw`, uses `GlobalContext`, calls `runBlocking { mirror?.push }` … | Audit goes through the lock and GlobalContext is gone; runBlocking around mirror.push and the swallowed failure remain | 31, 45 |
| MOD-2 | M | Not done | The mode list exists in about six places; `MODE_HELPER_ENTITY` is defined three times. | Unchanged | - |
| MOD-3 | M | Not done | `ModeMirrorService` fetches all HA states to read one entity; when the helper changes, the bridge sets th… | The bridge still sets the mode for every household | - |

### USR

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| USR-1 | L | Not done | `UserService`: `locale` unvalidated, `time` unused, `getPreferences` writes on GET, unbounded `extra` JSO… | Unchanged | - |

### PRM

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| PRM-1 | H | Fixed | `resolveSensitivity` returns the first match in list order, so a generic rule listed first overrides a mo… | A device-class match beats a generic rule whatever the order | 12 |
| PRM-2 | L | Moot | `ReplaceResult` is declared twice (nested and top level). | Only one top-level declaration remains; no duplicate to merge. | 59 |
| PRM-3 | M | Fixed | `createPolicy` does not check that the connection or entity exists, that a `member` subject belongs to th… | Connection, member membership, entity-target shape and operation shape/count/duplicates are validated; entity existence is intentionally not required. | 59 |
| PRM-4 | L | Fixed | `defaultsSwitchedOff` uses a redundant double filter; unused `val changed`. | One filter remains and the unused `val changed` was removed; sensitivity output test still passes. | 59 |
| PRM-5 | L | Not done | `sensitivityPolicy()` reloads rules from the DB on each call. | Unchanged | - |
| PRM-6 | M | Not done | The `Permission` enum is ignored by routes that use literals (`"scene.run"`, `"device.view"`, `"ha.manage… | Investigated only: every literal used by `requirePermission` matches an enum `.wire`; the remaining work is mechanical replacement. | 59 |
| PRM-7 | L | Not done | Policies match on string `subjectType`/`effect`. | Unchanged | - |

### HHD

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| HHD-1 | M | Partly | `Role.fromWire` throws on an unknown role inside `lookupMembership`, so one bad row gives that user a 500… | New bad roles are refused by the database; a legacy bad row would still give that user a 500 | 39 |
| HHD-2 | M | Fixed | `updateMember` always replaces `expires_at`, so a role change passing null clears a guest's expiry. | Role change keeps the expiry | 12 |
| HHD-3 | M | Not done | `removeMember` leaves sessions, push subscriptions, person links and favorites. | Unchanged | - |
| HHD-4 | L | Fixed | "One household per user" is encoded in `selectMembershipByUser`, but code elsewhere assumes `householdId`… | Stated: one household per install (only the first registration creates one) | 42 |
| HHD-5 | L | Fixed | Household timezone is stored without validation. | Timezone validated on PATCH /household | 12 |
| HHD-6 | L | Not done | `HOUR_MS`/`DAY_MS`/`MINUTE_MS` are defined in several files. | Unchanged | - |

### AUTH

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| AUTH-1 | L | Not done | Stale comment in `regenerateRecoveryCodes`. | Unchanged | - |
| AUTH-2 | L | Not done | `secretsGlobal` uses one key `"all"`: an attacker can exhaust it and block legitimate invite and recovery… | Unchanged | - |

### PSK

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| PSK-1 | M | Not done | Both passkey finish methods catch `Exception` and log at debug, so real faults look like a wrong passkey. | Unchanged | - |
| PSK-2 | H | Fixed | `.origins(setOf(config.webauthn.origin))` allows exactly one origin. The Android app will sign in with pa… | WEBAUTHN_EXTRA_ORIGINS | 12 |
| PSK-3 | L | Not done | `finishRegistration` rebuilds the options instead of using the stored request. | Unchanged | - |
| PSK-4 | L | Not done | The user handle is `usr_<ULID>`, exposing creation time in a value WebAuthn wants opaque. | Unchanged | - |
| PSK-5 | L | Partly | Duplicated algorithm list; encode-then-decode round trip; `%02x` again; 6 deprecation warnings. | Deprecation warnings went from 6 to 3; the rest of the finding is unchanged | 38 |
| PSK-6 | L | Not done | `SqlCredentialRepository.lookup` accepts an empty user handle. | Unchanged | - |

### AI

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| AI-1 | M | Not done | The text interpreter is regex heuristics with global tables and no tests; `Regex(...)` compiled per call. | Unchanged | - |
| AI-2 | L | Not done | The sealed `Plan` interface is unused (suggestions use a raw `JsonObject`); about 60 fully-qualified `kot… | Unchanged | - |
| AI-3 | M | Not done | `validateProposals` flags only `unlock` as sensitive and accepts `toggle` (NEW-3); otherwise it validates… | Only unlock is flagged sensitive (toggle itself now maps correctly) | 12 |

### SEC

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SEC-9 | L | Not done | The Anthropic call sends household device names to a third party. | Unchanged | - |
| SEC-1 | M | Not done | First-run setup code logged in plaintext (SRV-7). | Still logged at WARN (by design) | - |
| SEC-2 | H | Fixed | `docker-compose.yml` sets `ADMIN_SEAL_PRIVATE_KEY`; the worker reads `CONFIG_WORKER_PRIVATE_KEY(_FILE)`. … | Compose uses CONFIG_WORKER_PRIVATE_KEY | 34 |
| SEC-3 | H | Fixed | Compose mentions `HA_URL`/`HA_TOKEN`; nothing reads them. | HA_URL and HA_TOKEN removed | 34 |
| SEC-4 | M | Partly | `Dockerfile` runs as root, no `HEALTHCHECK`, copies a prebuilt dir; the compose healthcheck uses `bash -l… | Non-root user and a curl-free HEALTHCHECK added (healthcheck command tried by hand); still copies a prebuilt dir and the image was not built | 34 |
| SEC-5 | M | Fixed | `trustProxy` trusts `X-Forwarded-For` blindly; the first entry is used (NEW-22). | Last X-Forwarded-For entry used | 16 |
| SEC-6 | M | Not done | `X-Request-Id` echoed unvalidated. | Unchanged | - |
| SEC-7 | H | Fixed | Restore has no rollback and no schema check (DOM-8). | Rollback and schema check added (see DOM-8) | 50 |
| SEC-8 | M | Partly | `allowUnsigned` switch; marker JSON hand-built. The reference `scripts/update-supervisor.sh` does not ver… | Supervisor now downloads, verifies and rolls back, and the marker is built safely; the allowUnsigned switch remains | 22 |
| SEC-10 | L | Not done | `SecureRandom()` per call; default-charset string conversions. | Unchanged | - |
| SEC-11 | M | Not done | `BackupService.unpack` swallows `Throwable` per key, hiding I/O errors. | Unchanged | - |
| SEC-12 | L | Not done | Lockout can be forced by anyone holding a credential id and discloses account existence. | Unchanged | - |

### WRK

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| WRK-1 | M | Not done | `HaAdminApi` is a third HA client (with `HaTimeout`, `HaConfigHttpError`). | Unchanged | - |
| WRK-2 | H | Partly | `worker/ConfigOps` (217 lines) and `ha/ConfigOps` (87 lines) are two different implementations; only one … | `ha/ConfigOps` now validates to the same rule set as the worker on covered operations and a cross-validator test guards the verdicts; implementations/APIs remain separate and worker still uses `worker/ConfigOps` (left in place, can delegate later) | 53 |
| WRK-3 | H | Fixed | `tick()` catches `Exception` around suspend code (swallows cancellation); `perform()` uses `payload["obje… | Cancellation is rethrown, required payload keys are read via helpers that throw `ConfigOpError` naming the key (permanent, no retry), and suspend `catch`/`runCatching` in worker files no longer swallow cancellation; a job cancelled mid-perform is left `running` (recovered to `pending` on restart); a Home Assistant timeout is a failed job (permanent, not retried) and does not stop the worker (found and fixed in review) | 53 |
| WRK-4 | L | Not done | `recoverInterrupted()` always returns 0; heartbeat JSON is interpolated. | Unchanged | - |
| WRK-5 | M | Not done | `Main.kt` reads four env vars directly from `System.getenv`. | Unchanged | - |
| WRK-6 | L | Not done | Separate `Database` lock per process; heartbeat freshness uses each process's clock. | Unchanged | - |

### RTE

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| RTE-1 | M | Not done | `split` does not check entity ids belong to the thing; `PUT /entities/{entityId}/role` does not validate … | Unchanged | - |
| RTE-2 | M | Not done | `AutomationRoutes` requires `AUTOMATION_WRITE` for every endpoint including reads; no run permission. | Unchanged | - |
| RTE-3 | M | Not done | `ThingsRoutes` and `DeviceRoutes.toViewJson` hand-build near-identical device JSON. | Unchanged | - |
| RTE-4 | L | Not done | `PreferencesPatchBody` cannot distinguish null from absent; `POST …/push-subscriptions/test` wraps `suspe… | Unchanged | - |
| RTE-5 | L | Fixed | `HaConnectionRoutes`/`BackupRoutes` copy an inline any-to-JSON converter four times because services retu… | The four copies are one helper, toJsonObject() | 42 |
| RTE-6 | L | Not done | `BackupRoutes` builds an untyped `Map<String, Any?>` patch. | Unchanged | - |
| RTE-7 | L | Not done | Seven route files rebuild the same `Caller` by hand. | Unchanged | - |
| RTE-8 | L | Not done | `InsightsRoutes` and alert routes borrow `MODE_CHANGE`/`NOTIFICATION_RECEIVE`; health uses a separate upt… | Unchanged | - |
| RTE-9 | L | Not done | `AskAliceRoutes` turns a malformed body into defaults via `runCatching`. | Unchanged | - |

### SQL

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| SQL-1 | M | Partly | No `CHECK` constraints anywhere; status and enum-like columns are free text. (V) | Triggers check 11 enum-like columns; others remain free text | 39, 40 |
| SQL-2 | M | Fixed | `audit_log` has only a `created_at` index although audits filter by household. | New index on (household_id, created_at, id) (migration 4.sqm, schema version 5) | 52 |
| SQL-3 | M | Fixed | `deleteExpiredChallenges` has no caller; no query purges expired sessions. (V, grep) | Retention job purges challenges and sessions | 21 |
| SQL-4 | L | Not done | 72 `SELECT *` queries; several unbounded per-request reads (`selectAllHouseholds`, `selectAllPersonLinks`… | SELECT * and unbounded reads unchanged | - |
| SQL-5 | L | Moot | `ha_connections` is `UNIQUE (household_id)` (one connection per household), conflicting with `ConnectionM… | ConnectionManager was deleted; one connection per household and the conn-1 id are deliberate | 41 |
| SQL-6 | L | Not done | Some `created_by`/`updated_by` columns reference `users(id)` with no `ON DELETE` rule. | created_by/updated_by foreign keys still have no ON DELETE rule | - |
| SQL-7 | M | Partly | Tables that only grow. There is no delete query, or none with a caller, for: `notifications`, `alerts` (c… | notifications, alerts, automation runs, sessions, invitations, challenges, commands and idempotency keys are pruned; used recovery codes, query_history, insight_dismissals, backup_records and update_records are not | 21 |
| SQL-8 | H | Partly | Per-connection tables are not household-scoped and do not reference the connection. `entity_settings` has… | entity_settings, thing_overrides, entity_overrides and thing links are household-scoped; no foreign key to ha_connections and conn-1 is kept deliberately | 20, 24, 41 |
| SQL-9 | M | Partly | Schema and model disagree. The `commands` table has no `group_id` column although `DeviceCommand.groupId`… | commands.group_id added; backup_records.schema_version is still always null and data_ naming remains | 14 |
| SQL-10 | M | Fixed | Missing indexes. `groups`, `thing_overrides` and `entity_overrides` are queried by `household_id` with no… | Indexes added for groups, config_jobs, operators and sessions; the override tables are covered by their household-led keys | 21 |
| SQL-11 | M | Fixed | `selectActiveSupportSession` filters on `ended_at IS NULL` but not on `ends_at`, so every reader must fir… | Active support session filters on ends_at; reads no longer write | 27 |
| SQL-12 | L | Not done | `backup_records`, `support_sessions`, `entity_attribute_log` and `operators`-related tables have no forei… | Missing foreign keys unchanged | - |
| SQL-13 | L | Not done | `insertHousehold` has no timezone parameter, so a new household is `UTC` until an admin patches it. Backu… | insertHousehold still has no timezone | - |
| SQL-14 | L | Not done | `jobs` with `insertJob`/`countPendingJobs`, and the test-only queries `selectAuditLogByAction` and `selec… | Unused jobs and test-only queries still in the schema | - |
| SQL-15 | L | Not done | `selectAllAutomations` and `selectAllPersonLinks` are unfiltered and used by `HaEventBridge`, so a person… | selectAllAutomations and selectAllPersonLinks still unfiltered in the bridge | - |

### LOG

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| LOG-3 | H | Fixed | No real serialization or coalescing (DOM-1). | One command at a time per entity (a coroutine mutex per entity, freed when idle); a waiting `set_*`/on/off/lock/open/close command is dropped (`cancelled`) when a newer one for the same entity and action arrives; toggles and undos are never merged | 48 |
| LOG-4 | H | Partly | Duplicate execution on retry storms; theoretical cross-user collision. | Key collision fixed and keys persisted; check-then-record is still two steps | 14 |
| LOG-5 | M | Fixed | Hash over `params.toString()`, in memory. | Idempotency is stored in the database, so it survives a restart | 14 |
| LOG-10 | H | Partly | Re-reads cache, polls with `Thread.sleep(50)`, "late confirmation" duplicates the loop body. | Thread.sleep replaced by delay; the duplicated late-confirmation loop remains | 12 |
| LOG-6 | H | Fixed | Cross-household leakage of merges, hides and renames. | Overrides are per household | 24 |
| LOG-7 | H | Partly | Events attributed to the wrong or only the first home. | Bridge uses the connection's household, but still assumes one connection | 17 |
| LOG-8 | H | Fixed | `HaAuthError` never thrown. | HaAuthError is thrown and not retried | 13 |
| LOG-9 | H | Fixed | Memory growth, 30 s hangs after disconnect. | Pending calls are cleared and failed on disconnect | 13 |
| LOG-17 | H | Fixed | Torn reads or `ConcurrentModificationException`. | StateCache synchronized | 13 |
| LOG-18 | M | Moot | Restored state loses brightness and colors. | HaProjectionStore was deleted | 36 |
| LOG-19 | M | Not done | "Critical" events can be dropped. | Realtime queue still drops oldest unconditionally | - |
| LOG-11 | M | Not done | Deletes row even if the HA delete job wasn't queued. | RoutinesService.remove still deletes the row even if the HA delete job was not queued | - |
| LOG-12 | L | Not done | `ConfigJobService.prune`/`recoverInterrupted`, `AdminService.prune*` | prune and pruneAudit still return 0 | - |
| LOG-13 | H | Fixed | Possible total DB loss on I/O failure. | A failed swap puts the old database and its log back; the previous log is no longer deleted | 50 |
| LOG-14 | M | Not done | Wrong update decisions for `rc.N`. | isNewer pre-release comparison unchanged | - |
| LOG-15 | M | Fixed | Duplicate maintenance loops. | Scheduler start is idempotent and no longer started from App | 12 |
| LOG-16 | M | Not done | Contradicts its comment and likely the API contract. | BadRequestException still answers 422 for all cases | - |
| LOG-20 | M | Fixed | `GroupsService:60-61`, `AskAliceService:214,218`, `PermissionService:116`, `HistoryService:95` | Dead guarded branches removed | 37 |
| LOG-21 | L | Fixed | Redundant `else` in exhaustive `when`. | Redundant else removed | 37 |

### TST

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| TST-1 | H | Fixed | The six "live HA" tests (`HaIntegrationTest`, `HaHistoryIntegrationTest`, `HaDevicesIntegrationTest`, `Ha… | Live tests skip when Home Assistant is absent | 12 |
| TST-2 | M | Not done | `HaCommandIntegrationTest` calls the gateway directly, never `CommandExecutor`, prints the context id and… | HaCommandIntegrationTest still calls the gateway directly and asserts nothing about the result | - |
| TST-3 | M | Partly | Weak assertions: `turn_on succeeds` accepts `CONFIRMED`, `TIMED_OUT` or `ACCEPTED`; `recoverInterrupted` … | recoverInterrupted asserts exact counts now; turn_on still accepts three states and cancel only asserts non-null | 12 |
| TST-4 | M | Not done | `runTest` used 0 times despite the dependency; 80 `runBlocking` blocks and about 25 real `delay` calls (5… | runBlocking and real delays still dominate the tests | - |
| TST-5 | M | Not done | Test setup repeated in about 34 places; `HealthTest` and others use the full production `serverModule()`,… | Setup is still repeated; new tests added their own helpers | - |
| TST-6 | M | Partly | No test names: `BackupService`, `UpdateService`, `EnergyService`, `HistoryService`, `AlertsService`, `Act… | Now tested: BackupService, RestoreApply, AlertsService, command store, retention, token vault, HA runtime; still no direct tests for UpdateService (beyond manifests), EnergyService, HistoryService, AdminService, InsightsService, OperatorService, AskAliceService, ConfigJobApplier, ConfigSyncService | 19, 29, 33, 50 |
| TST-7 | M | Partly | No test file contains `api/v1/activity`, `/alerts`, `/insights`, `/ai/interpret`, `/permissions` or `/not… | Notifications, activity and a read sweep of all GET routes are covered; alerts, insights, ai/interpret and permissions mutations are not | 12, 26, 30 |
| TST-8 | L | Moot | About 4,500 test lines against about 20,000 main lines; core has 3 tests. | A size ratio, not a defect; counts went from 3, 43, 135, 13 to 19, 41, 215, 13 | - |
| TST-9 | M | Partly | Server tests cannot detect the unwired runtime (SRV-1, NEW-11, NEW-12) because they use `FakeGateway`; no… | Executor with real JSON parameters and a dispatch target, and the runtime, are tested; deny-rule and guest paths only partly | 12, 13 |
| TST-10 | H | Fixed | Two tests never run. In `HaCompileTest.kt` the class closes at line 55, but `compiles arrive and leave tr… | The two HaCompile tests are inside the class. Four more tests were found never to run for a different reason (a `runBlocking` body ending in a value makes JUnit skip the method); fixed, and every module now has `EveryTestRunsTest`, which fails if any test method returns a value | 12, 51 |
| TST-11 | M | Partly | Tautologies: five `ThingsServiceTest` tests (`rename`, `setHidden`, `merge`, `split`, `setEntity`) end wi… | Four ThingsServiceTest tautologies and the undo one replaced; setEntity stores override still ends in assertTrue(true) | 23 |
| TST-12 | M | Fixed | `Phase14RoutesTest` "updates settings require step up and validate window" sends the PUT with a cookie bu… | The test now sends an Origin header so the window validation is reached | 12 |
| TST-13 | M | Fixed | `PermissionsTest` is named "denies guests without an allow…" but only tests a guest with an allow and a m… | SensitivityTest covers the no-allow denial and resolveSensitivity | 12 |
| TST-14 | M | Partly | Tests that mask production defects: `HaRealtimeIntegrationTest` publishes the `EntityStateChangedEvent` i… | The runtime now publishes entity events (HaRuntimeTest); the old tests that publish them themselves are unchanged | 13 |
| TST-15 | M | Partly | `PushServiceTest` only covers registration; `deliver` (suppression, quiet hours, rate limit, removal of g… | Provider result mapping is tested; deliver (suppression, quiet hours, rate limit) and account lockout are not | 18 |
| TST-16 | M | Not done | `HaLiveIntegrationTest` (worker): the fallback reads `File("../backend/.env.test")`, which from the modul… | Worker live test still reads ../backend/.env.test | - |
| TST-17 | M | Partly | Routes with no test at all by URL: notifications (a likely-always-500 route, NEW-31), activity, alerts, i… | Notifications, activity, connection and backup routes have tests; groups, scenes, routines, favorites and household routes mostly do not | 12, 26, 42 |
| TST-18 | L | Not done | `registerCookie`/`registerAndCookie` is copied in five test classes (and inlined three times in `AuthRout… | registerCookie still copied across test classes | - |
| TST-19 | L | Not done | Duplicate tests: `HaDevicesIntegrationTest` and `HaPhase6IntegrationTest` do the same thing, and `HaPhase… | Duplicate and empty live tests remain (one renamed) | 43 |
| TST-20 | L | Moot | Worker tests are the best in the project: they cover retry versus permanent failure, claiming, and recove… | An observation that the worker tests are good; the two weak spots are unchanged | - |

### AND

| ID | Sev | State | Finding (start) | What is true now | Where |
|---|---|---|---|---|---|
| AND-1 | H | Fixed | Passkeys cannot work from Android as configured. The engine accepts one origin (`webauthn.origin`, defaul… | WEBAUTHN_EXTRA_ORIGINS accepts the Android apk-key-hash origin; the real HTTPS domain and assetlinks.json are a deployment step on your side | 12 |
| AND-2 | H | Partly | Contract points the app relies on that the backend does not honor: sockets are "closed server-side on rev… | Revocation sweep and persisted idempotency done; the other contract points were not individually checked | 12, 14 |
| AND-3 | H | Partly | Mobile networks and `/ws`: the server sets no ping period, idle timeout or frame limit (NEW-8) and counts… | Ping, idle timeout, frame limit and dropping of stuck clients added; the cap of 10 sockets per user remains (its check-then-act race is fixed) | 12, 49 |
| AND-4 | M | Not done | Auth transport for native clients. HTTP requests are authenticated only by the `alice_session` cookie (`S… | HTTP still authenticates only by cookie | - |
| AND-5 | M | Partly | Push over FCM. `registerFcm` caps a user at 10 subscriptions, and tokens are only removed on a `gone` res… | FCM INVALID_ARGUMENT no longer deletes subscriptions; the 10-subscription cap is unchanged | 18 |
| AND-6 | H | Fixed | Repository calls that land on known backend defects: `setHvacMode`, `setFanPreset` (string parameters arr… | String parameters, colour and confirmation fixed on the backend (NEW-2, NEW-6) | 12 |
| AND-7 | M | Not done | Parity is unverified. The doc assumes the Kotlin backend has the same REST surface, `/ws` protocol and co… | No contract tests against the TypeScript backend | - |
| AND-8 | L | Not done | `GET /api/v1/home` supports ETag and 304, which suits an offline-first app; the other list endpoints do n… | ETag only on /home | - |

## End-to-end findings (F-xxx, from e2e/FINDINGS.md)

| ID | Sev | State | What is true now | Where |
|---|---|---|---|---|
| F-026 | critical | Fixed | `Expectations.mapToJsonElement` no longer stringifies-and-reparses state values; it uses `anyToJsonElement` so strings, booleans, numbers, arrays/lists (e.g. rgb), maps/nested objects and null serialize with correct JSON types in command responses. | 54 |
| F-021 | critical | Partly | Favorites GET/PUT return `{"devices":[<device-view-json>...]}` (presented device views) instead of internal `Thing` serialization, so non-empty lists no longer 500 and empty lists remain `{"devices":[]}`. Favorite order is preserved on read. A hidden device now drops out of favorites (as in the TypeScript service) and comes back when shown again; a guest sees only the favorites a rule allows (tests added in review). Visibility/validation/ordering differences noted in F-022 (unknown ids, hidden handling, exact TS policy) were not fully aligned. | 54 |
| F-017 | critical | Fixed | Device presentation now reads live state from `StateCache` (`lookup` passed to `Presentation.presentThing`) in device routes (`/devices`, `/devices/{id}`, areas device lists), `/things`, favorites device views, and `ThingsService`/`SmartService` projections; availability and normalized `values` are populated when cached (unavailable/absent handled per projection). Unrelated diffs (F-018 metadata, F-023/F-024 ordering/shape details) not changed. Group list endpoint (`/groups`) still exposes `GroupDevice.available` from thing structure, not the same live device-view payload. | 54 |
