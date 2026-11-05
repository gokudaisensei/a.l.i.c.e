# Alice Backend — Known limitations and caveats

A living file. After every working run, add a **Run log** entry at the bottom (what was built, what was verified, what was not) and update the **Open items** table (add new rows, change status, never silently delete). We revisit this file as we build.

Status values: `open`, `partial`, `mitigated`, `resolved`, `accepted` (known and deliberately left).

## Open items

| ID | Area | Limitation / caveat | Impact | Planned fix | Status | Since |
|---|---|---|---|---|---|---|
| L01 | Facets | A bare "Camera shutter" binary sensor (no `device_class`, no polarity word in its name) cannot be interpreted: HA only says on/off. | Facet reports `ambiguous: true` with an On/Off label until resolved | Admin sets `onMeans` per facet (override, implemented as data); the suggestion layer should propose it from device class/model once built; consider a per-integration polarity table (e.g. ESPHome) once we see real devices | partial | Run 4 |
| L02 | Facets | Polarity from name tokens is English-only and regex-based (`shutter closed`, `muted`, `open`…). | Non-English or unusual names fall through to ambiguous | Locale-aware token tables, or LLM suggestion | accepted (for now) | Run 4 |
| L03 | Facets | `onMeans` is stored as plain data in `ThingOverrides` only; there is no table or endpoint yet. | Overrides are lost on restart | `entity_overrides` table plus `PUT /entities/:id/role` (documented) with the identity work | open | Run 4 |
| L04 | Persistence | Inventory, state cache and Things are in memory only; nothing is stored in the DB yet (`ha_*` tables are not created). | Restart re-discovers everything; no fast startup | Add `ha_*` and override tables with the Drizzle schema pass | open | Run 1 |
| L05 | Persistence | Only `device_commands` exists in the DB schema; docs name it `commands` and plan `command_attempts`. | Table needs renaming before real use | Rename in the schema pass | open | Run 1 |
| L06 | Security | `GET /api/home-assistant/connections` is unauthenticated and temporary. | Leaks connection status/ids if exposed | Move behind admin auth when identity lands | open | Run 1 |
| L07 | Security | HA tokens are read from env/config in plain text; encryption at rest and the two-token model (operational vs admin) are designed but not built. The config-worker process does not exist. | No separation of HA privileges yet | Encrypted token storage; config-worker process | open | Run 1 |
| L08 | Commands | Executor, lifecycle, timeouts and desired-state verification now exist (Run 5), but nothing exposes them yet: no HTTP route, no `/ws` stream, no Thing-level endpoint. | No device control through the app's API | Devices API with the identity work | partial | Run 1 |
| L09 | Events | Attribute-only updates are published as `entity.state_changed` (same type as real state changes). Chatty entities (power sensors) can produce many events. | Possible noise for activity/notifications/WS | Per-consumer throttling or an `entity.attributes_changed` type | open | Run 1 |
| L10 | Events | The in-process bus drops events if the process dies mid-handling; there is no replay. | Missed events after a crash or restart | Resync from HA on start (already done); durable log only if a consumer needs it | accepted | Run 1 |
| L11 | Events | `context.userId` is the HA user of the token, not an Alice user. | Cannot attribute changes by Alice user from the event alone | Correlate `context.id` with `commands.ha_context_id` (test exists) | partial | Run 1 |
| L12 | Normalizer | `normalizeState` maps lights, fans, climate, covers, locks, sensors and binary sensors. `media_player` only reports `power`; `camera`, `update`, `vacuum`, `humidifier`, `water_heater`, `valve`, `alarm_control_panel` return an empty view. | UI gets no app-level values for those | Add per-domain maps as the UI needs them | open | Run 2 |
| L13 | Normalizer | Command parameters use app-level values (`brightness_pct`) via `resolveOperation`, but read/write units are only round-trip tested for brightness. | Possible off-by-one on other scales | Add round-trip tests per capability | open | Run 2 |
| L14 | Capabilities | Capabilities come from `supported_features` bit masks as of HA 2026.10; HA can change flags between versions. | Wrong operations offered after an HA upgrade | Pin and test against HA versions in CI | accepted | Run 1 |
| L15 | Things | The name cleaner strips the area prefix, so "Kitchen Echo" in the Kitchen shows as "Echo". Context is kept in aliases. | Bare names in cross-room lists | UI always shows area next to the name; make stripping configurable if confusing | accepted | Run 3 |
| L16 | Things | Role classification is heuristic (domains, `entity_category`, device class, name tokens such as "connected", "version", "restart"). It can misfile an entity (e.g. a real sensor called "Connected devices" becomes diagnostic). | Wrong card layout for some devices | User overrides (data only, see L03); suggestion layer | partial | Run 3 |
| L17 | Things | A device with no primary-class entity promotes switch, then binary sensor, then sensor. A device whose best entity is a sensor can show as a "sensor card" even when a human would call it something else. | Occasional odd primary | Overrides; review against real devices | accepted | Run 3 |
| L18 | Things | Devices merge only when they share an identifier or connection tuple (e.g. same MAC). Two integrations that expose the same hardware without a shared tuple will not merge. | Duplicate cards for one device | Manual merge override; suggestion layer ("merge?") | partial | Run 3 |
| L19 | Things | Hub/child links (`hubThingId`) only point at hubs that have at least one entity; a hub with no entities has no Thing to point to. | Child shows no hub | Create entity-less hub Things on demand if the UI needs it | accepted | Run 3 |
| L20 | Things | Smart layer is not built: no suggestions table, no alias index store, no fuzzy resolver, no LLM job. Aliases are generated but not indexed or used. | Search/voice/AI cannot resolve names yet | Alias index plus resolver with the Things API; LLM suggestions with the AI module | open | Run 3 |
| L21 | Things | Name cleaning and synonyms are English only; title-casing assumes Latin text. | Poor names in other languages | Locale support if needed | accepted | Run 3 |
| L22 | Things | `buildThings` is computed on demand from the inventory; it is not cached and not rebuilt incrementally on events. | Wasted work on big homes | Cache per sync, invalidate on `inventory.synced` / overrides change | open | Run 3 |
| L23 | Testing | Integration tests run against a persistent mock HA (port 8123) that keeps state between runs; one test already failed once because a light was at the target value. | Order- and history-dependent failures possible | Tests must not assume start state; `ha:down` then `ha:up` + bootstrap resets | mitigated | Run 3 |
| L24 | Testing | The mock HA uses the `demo` integration: simple devices, few real-world quirks (no ESPHome, no shared MAC, no facets). Those cases are covered only by hand-written fixtures. | Heuristics untested on real hardware | Run against the user's real HA (read-only) and capture anonymised fixtures | open | Run 3 |
| L25 | Operations | HA is assumed reachable by URL + token (HAOS, Container, Core). Supervisor-only features (HA backups via Supervisor, add-ons) are not used. | Backups to the HA host rely on HA's backup WebSocket commands, not yet built | Build `BackupDestination` (`ha`, `nas`, `upload`) | open | Run 1 |
| L26 | Operations | Auto-update setting, nightly window and emergency deploy (`DEPLOY` + reason + step-up) are specified in docs only. | Not implemented | Updates module | open | Run 1 |
| L27 | Commands | `InMemoryCommandStore` only: commands are lost on restart, and a command in flight at restart is neither resumed nor timed out. | No command history across restarts; stuck in-flight state is impossible but unrecorded | Drizzle-backed store (also resolves L05); on startup mark leftover non-terminal commands as `failed` | open | Run 5 |
| L28 | Commands | One attempt per command; `command_attempts` and retries are not implemented. | A transient HA error fails the command | Retry policy for idempotent operations | open | Run 5 |
| L29 | Commands | Authorizer is an allow-all stub. Step-up is a boolean the caller sets, not checked against a real passkey assertion. Sensitive operations are a fixed list (lock `unlock` and `open`); alarm disarm, garage-door covers and similar are not flagged and admins cannot change the list yet. | No real access control or step-up enforcement | Permissions module and passkey step-up; admin-configurable `SensitivityPolicy` (defaults unlock/open; `sensitive_operation_rules` table and `/admin/security/sensitive-operations`, designed in the docs) | open | Run 5 |
| L30 | Commands | Confirmation tolerances absorb HA rounding (brightness ±1%, colour ±4, colour temperature ±60 K, target temperature ±0.5, cover position ±2, fan speed ±34). Fan speed in particular is coarse. Transitional states (`opening`, `locking`) do not confirm. | A near-miss can confirm; slow covers over 60 s time out | Per-device tolerances from `percentage_step` etc.; tune timeouts with real hardware | open | Run 5 |
| L31 | Commands | No per-entity queueing. Concurrent commands on one entity race, and one state change can satisfy both (confirmation is by desired state, by design). | Ambiguous attribution under contention | Serialize per entity if it matters in practice | accepted | Run 5 |
| L32 | Commands | `timed_out` does not cancel anything in HA; the device may still change later. `actualState` is only a snapshot at timeout. | A "timed out" command can succeed afterwards | Late-confirmation note on the command, or keep watching briefly | open | Run 5 |
| L33 | Commands | Scenes, scripts and `stop` have no observable state, so they confirm when HA accepts; the effect is not verified. Undo (compensating command) and group fan-out are not built. | "Confirmed" means "accepted" for those | Verify scene targets individually; build undo and group commands | open | Run 5 |
| L34 | Commands | `device_unavailable` fails fast from the cached availability, so a stale cache can reject a device that just came back. | Rare spurious failure | Resync-check before failing | accepted | Run 5 |
| L35 | Commands | `failure.message` can carry HA's raw error text. Command events carry the full command, including parameters. | Internal details could reach clients | Sanitize at the API; filter `/ws` command events by permission | open | Run 5 |
| L36 | IDs | ULIDs are time-ordered only to the millisecond; two ids created in the same ms are not ordered. The command store breaks ties by insertion order; a DB-backed store must do the same (e.g. a sequence column). | Wrong "newest first" order for same-ms commands | Monotonic ULIDs or a sequence column in the Drizzle store | open | Run 5 |

## Run log

### Run 1 — HA module (committed `e19c688`)
- Built: gateway interface, WebSocket gateway, connection manager (backoff + jitter, no retry on bad token, resync after reconnect), discovery/inventory, state cache, capability detector, event normalizer, in-process bus, `core/` restructure.
- Verified: 32 unit tests and 3 integration tests against the mock HA, typecheck clean.
- Not verified / not built: see L04–L11, L14, L25, L26.

### Run 2 — Capability-aware state normalizer (committed in `e19c688`)
- Built: `normalizeState`, `normalized` on events and cached entities.
- Verified: unit tests including brightness round-trip (1–100%), live test (30% set, observed 30%).
- Caveats recorded: L12, L13.

### Run 3 — Things model (committed `637406d`)
- Built: registry field extension, role classifier, name cleaner, grouping (`buildThings`) with overrides, fixtures incl. an Echo-style ESPHome device.
- Verified: 64 tests passing; live run over the mock HA's 128 entities produced 115 Things (97 visible).
- Found and fixed: integration test depended on the light's starting brightness (L23).
- Caveats recorded: L15–L24.

### Run 4 — Facet values (committed `637406d`)
- Built: `facet-values.ts` (`describeFacet`, `describeThingFacets`): polarity from `device_class` (fixed HA semantics), then name tokens, then user override `onMeans`; unknown/unavailable never guessed; `deviceClass` added to `ThingEntity`.
- Verified: 49 tests in `things/` (device-class table, name-token cases, "unmuted" is not "muted", ambiguity reporting, override and derived opposite, enum sensors, unavailable states, Echo example end to end).
- Result for the Echo example: with no polarity information the shutter facet is `ambiguous` (On/Off) rather than wrongly labelled; once `onMeans: "closed"` is set it reads Closed/Open. A fully automatic answer is not possible from HA data alone (L01).
- Caveats recorded: L01–L03.

### Run 5 — Command executor (uncommitted when written)
- Built: `CommandExecutor` (validate, authorize, step-up for sensitive operations, dispatch, accept, desired-state confirmation, timeout, cancel), expectations with tolerances and parameter validation, in-memory store, allow-all authorizer, `command.*` events on the bus, `resolveThingTarget`, ULID ids.
- Verified: 29 new unit tests (fake gateway: happy paths, already-true, unobservable, physical-press confirmation, unrelated change times out, late confirmation, HA rejection, pre-dispatch failures, household scoping, denied/step-up, cancel) plus 6 live tests against the mock HA (switch on/off, toggle, brightness in percent, step-up unlock/lock of a real demo lock, HA-rejected value, event order). Live tests passed twice in a row.
- Fixed in passing: finished runs were kept in memory forever; now dropped once settled. A flaky ordering test exposed that same-millisecond commands could list in the wrong order; the store now breaks ties by insertion order (L36).
- Caveats recorded: L08 (now partial), L27–L36.

### Run 6 — Plan update: configurable sensitive operations (docs only)
- Decision (from the user): admins can choose which device operations need step-up, with lock `unlock` and `open` as defaults. Recorded in ARCHITECTURE.md (security model, build order step 4), DATABASE.md (`sensitive_operation_rules`) and API.md (`/admin/security/sensitive-operations`). To be built with the permissions module; the executor will take a `SensitivityPolicy` in place of the fixed `isSensitiveOperation`.
- Caveats: L29 updated. Not built or tested yet.
