# Bringing the Kotlin backend to parity

This is the build map: what "parity" means, which TypeScript module each Kotlin
module replaces, what lands in which phase, how each phase is proven, how the
cutover happens, and the disposition of every known limitation in
`backend/docs/LIMITATIONS.md`.

Companion docs: [SMART.md](SMART.md) (interaction-level UX built alongside
parity), [LIMITATIONS.md](LIMITATIONS.md) (new Kotlin-only caveats),
`backend/docs/API.md` (the wire contract).

---

## 1. What parity means

Parity is **contract parity, not source parity**.

| Dimension | Rule |
|---|---|
| HTTP | Same paths, methods, status codes, headers (cookies, `Idempotency-Key`, `Retry-After`), and JSON shape/field names. `null` fields are omitted; defaults are included. |
| WebSocket | Same `/ws` message types and payload fields, same subscription grammar, same per-person filtering. |
| Semantics | Same permission outcomes, same command lifecycle, same undo window, same step-up rules, same rate-limit outcomes. |
| Time and ids | Unix milliseconds; type-prefixed ULIDs. |
| Database | Same tables/columns conceptually, but a **fresh Kotlin database**. The schema is ported from the Drizzle `0013` shape; migrations are append-only from phase 1. No dual-write, no data import. |
| Errors | `{"error":{"code","message","details"?}}`, `snake_case` codes, no raw Home Assistant text. |
| Additions | New endpoints/fields are allowed only where they cannot change existing client behaviour (e.g. `GET /home` is additive). Anything else waits for a frontend change. |

The TypeScript backend stays runnable during the whole migration and is the
**oracle**: where the docs are ambiguous, its actual response wins.

---

## 2. Module mapping

| TypeScript (`backend/src`) | Kotlin | Notes |
|---|---|---|
| `core/` (config, db, events, ids, errors, http) | `core/` | same responsibilities; SQLDelight replaces Drizzle |
| `modules/home-assistant/` | `ha/` | the only place that speaks HA REST/WS |
| `modules/authentication/` | `server/…/auth` | passkeys via Yubico `webauthn-server-core` 2.10.1 behind a `PasskeyEngine` interface (Jackson never on the wire path) |
| `modules/households/`, `permissions/` | `server/…/households`, `…/permissions` | roles, invitations, policies, sensitivity rules |
| `modules/things/`, `devices/`, `areas/`, `commands/` | `server/…/things`, `…/devices`, `…/commands` | domain services + routes, same split |
| `modules/realtime/` | `server/…/realtime` | `/ws` hub |
| `modules/scenes/`, `routines/`, `automations/`, `modes/` | `server/…/automation` | one package; these share the action compiler |
| `modules/notifications/`, `push/`, `alerts/`, `activity/`, `insights/` | `server/…/notifications`, `…/activity` | push providers behind interfaces |
| `modules/history/`, `energy/`, `admin/`, `backups/`, `updates/`, `support/`, `ai/` | `server/…` matching packages | |
| `worker/` | `worker/` | separate process, same WAL database |
| `frontend/` | unchanged | talks to either backend |
| `frontend/e2e` | unchanged | final acceptance suite |

---

## 3. Phase plan

Each phase exits only when its **gate** is met: unit tests, route/contract
tests, and (where applicable) the captured fixture replay from section 6.

### Phase 0 — Foundation ✅ done

Gradle multi-module workspace, config, logging, monotonic ULIDs, error
envelope, in-process event bus, SQLite driver with `foreign_keys`/WAL, health
route, worker stub, test harness.

**Gate:** `./gradlew build` green; `/health` matches the TS shape; worker and
server share one database file.

### Phase 1 — Identity and passkey auth

Deliverables:

- WebAuthn via Yubico `webauthn-server-core` 2.10.1, isolated behind the
  `PasskeyEngine` interface: CBOR/COSE parsing, authenticator-data flags,
  client-data JSON validation, RP ID hash and origin checks, challenge store,
  signature verification (ES256/EdDSA/RSA), credential storage. The library's
  Jackson-backed `toJson`/`parse*Json` are never called; all DTOs are
  kotlinx-serialization and all credential objects are built from raw bytes.
- Registration (first user is admin, `SETUP_CODE` gate), login, step-up
  (user-verification required), add passkey, recovery codes, restricted
  recovery sessions.
- DB sessions with hashed opaque tokens, sliding expiry (half-life refresh,
  90-day cap), `Secure` cookie when the origin is https, `SameSite=Lax`,
  origin/`X-Requested-With` CSRF check, revoke-all sessions on credential
  change.
- Rate limits in SQLite: per-client and global caps, `Retry-After`, per-account
  lockout, strict code-guessing limits.
- Attestation policy: verify `none` **and** accept-listed AAGUIDs; require UV
  at login when the household policy says so (addresses L39).

TS reference: Run 7. Fixes: L37–L41, L48, L114.

### Phase 2 — Households, roles, invitations, permissions ✅ done (phase 2 core)

- First-user bootstrap, memberships, invitations (member/guest, expiring),
  last-admin guard, role matrix.
- Permission guard + a **single shared visibility helper** used by every
  listing (`/ws`, favorites, groups, scenes, activity) — the failure mode
  called out in L43.
- Sensitivity rules with scope columns (domain/action/device_class now; Thing
  scope reserved), step-up checking against the last passkey assertion.
- Add `interaction_stats` and `action_defaults` tables here (see SMART.md):
  cheap while the schema is being written, painful later.

TS reference: Runs 7–8. Fixes: L29 (policies at Thing level in phase 9),
L42 accepted, L43, L44, L72 auto-link groundwork.

### Phase 3 — Home Assistant gateway and projection ✅ done (core)

- `ha/`: WebSocket client (auth, id sequencing, reconnect with backoff+jitter,
  no retry on bad token), REST client, connection manager, discovery,
  capability detection from `supported_features`, state cache, subscriptions,
  `getHistory`/`getStatistics`, service calls.
- Normalizer: lights, fans, climate, covers, locks, sensors, binary sensors,
  `media_player` power, plus per-domain maps for camera/update/vacuum/
  humidifier/water_heater/valve/alarm (L12) as clients need them.
- Event pipeline: `entity.state_changed` vs `entity.attributes_changed`
  (L09), per-consumer throttling.
- **Persist the `ha_*` projection** so restart is fast (L04 fix).
- One HA connection per household enforced by a unique index, not just the
  service (L49).
- Test doubles: controllable-delay fake HA and restart test (L54), reset
  endpoints for a deterministic mock (L23), anonymised fixtures (L24).

TS reference: Runs 1–2, 8. Fixes: L04, L09, L10 seam, L14 (version-pinned CI),
L23, L24, L49, L54, L71.

### Phase 4 — Things model and facets

- Registry extension, grouping (`buildThings`), name cleaner, role classifier,
  primary-class promotion, hub/child links, merge/split with overrides.
- Entity-less hub Things on demand (L19).
- `DELETE`/unmerge endpoint and link compaction (L51).
- Facets: device-class table, name-token polarity (English for now),
  `onMeans` override, ambiguity reporting.
- Incremental rebuild hook for large inventories (L22) if fixtures show it
  matters.

TS reference: Runs 3–4, 8. Keeps: L15–L18, L21. Fixes: L19, L51. L01/L02 get a
suggestion path in phase 8 / SMART.

### Phase 5 — Commands, undo, regret

- Executor: validate → authorize → step-up → dispatch → accept → confirm by
  desired state → timeout → cancel.
- Expectations with per-capability round-trip tests and **per-device
  tolerances** (`percentage_step`, etc.) — L13, L30.
- **Per-entity serialization** with a bounded queue (L31) and coalescing of
  superseded intents (L57 is the push side).
- `command_attempts` table and a retry policy for idempotent operations
  (L05, L28).
- Interrupted-command recovery on boot (`interrupted`) — L27.
- Late confirmation: keep watching briefly after `timed_out` and annotate —
  L32.
- Pre-dispatch availability resync check instead of failing on a stale cache —
  L34.
- Idempotency keys (8–80 chars, 24 h), `Idempotent-Replay`, 422 on reused key
  with a different body (L52).
- Undo for single-device, scene, routine and group actions; group commands
  carry one group id and undo as a unit (L08, L33).
- Public command form for REST and WS; HA error text never leaves the server
  (L35).
- Command events carry a `requestedState` and lifecycle transitions designed
  for optimistic clients (SMART feature 3).

TS reference: Runs 5, 7–9. Fixes: L05, L08, L13, L27, L28, L30–L36, L52, L33.

### Phase 6 — Devices, entities, areas HTTP

- `GET /devices`, `GET /devices/:id`, `GET /entities/:id`, areas, device
  settings, rename/hide, per-caller pruning through the phase-2 helper.
- Blocking a main entity hides the whole device; strip `hubThingId` when the
  hub is invisible (L50).
- Command routes, entity role route (`PUT /entities/:entityId/role`).

TS reference: Run 8. Fixes: L43 enforcement per route, L50.

### Phase 7 — Realtime `/ws`

- Hub: subscriptions (devices, device, area, command, household health),
  per-person filtering on every push, role recheck, session sweep, connection/
  message/buffer limits, graceful close (`1001`).
- Push session revocation immediately; cache policies invalidated by
  `things.changed` (L56).
- Per-entity coalescing/throttle and a bounded per-connection queue with
  coalescing instead of disconnect-on-1 MB (L57).
- Protocol version in the connect/subscribe handshake and optional bearer
  token in addition to the cookie (L59).
- `devices.changed`, `entity.updated`, `command.*`, `things.changed`,
  `household.mode_changed`, `presence.changed`, notification/activity/alert
  message types.

TS reference: Run 9. Fixes: L55 (adapter seam kept), L56, L57, L59.

### Phase 8 — Smart serving (additive)

**No TypeScript equivalent.** Everything here is read-only and additive, so it
cannot regress the existing frontend. Full design in [SMART.md](SMART.md).

- `interaction_stats` fed from command/view/undo events.
- `GET /home`: one composite round trip (room, ordered devices, alert count,
  scene chips, `generation`).
- `order=smart` with hysteresis and never reorder while a screen is open.
- Device hints: `confirmIntent` from the per-action regret rate,
  `defaultParams` from remembered defaults.
- Search: alias index, trigram typo tolerance, recency/hour ranking,
  zero-query "usual at this hour".
- Time-windowed scene chips.
- Facet polarity suggestions for ambiguous entities (L01) from device class /
  model.

Fixes: L20 (alias index + fuzzy resolver), L01 suggestion, L70 input.

### Phase 9 — Favorites, groups, device settings, scenes, modes

- Favorites (personal, ordered, resolved by HA reference), groups with
  per-device first-visible-supporting-entity selection and `target: "all"`,
  device settings (power limit, voice exposure).
- Scenes validated on save, step-up for sensitive actions, activation as the
  activator, guest visibility.
- Household modes with two-way HA helper mirror and deterministic suggestions.
- Thing-level policies (L29); dynamic groups and re-link on re-pair (L63) if
  cheap.
- `ActionService`: one place that validates and starts actions as a person,
  reused by scenes, groups and routines.

TS reference: Runs 10–11. Fixes: L29, L53, L60, L63, L64.

### Phase 10 — Routines, automations, presence

- Routines: ordered device/scene/mode/delay steps, `continue`/`stop`, cancel,
  persisted runs and resume after restart, per-step access re-check, **overall
  run timeout** (L62), HA script mirroring.
- Automations: versioned definitions, plain-language summary, compilation to
  HA automations, dry run, enable/disable, run recording, recompilation when
  people/links/inventory change, sensitive-action approval + urgent notice.
- Presence: link members to HA people, arrivals/departures over `/ws`,
  auto-link by email/HA user id when unambiguous (L72).
- "Run now" for non-sensitive automations (L68) if the frontend can surface it.

TS reference: Runs 11–12. Fixes: L60–L62, L64, L68, L72.

### Phase 11 — Config-worker

- Sealed admin token (RSA/EC hybrid: server encrypts, worker decrypts), fixed
  validated operations, job table with retries/dedupe/heartbeat, HA allow-list
  of services/templates/events.
- Scene/routine/automation/mode mirroring, drift detection with canonical
  comparison, admin notification, resync restore, optional auto-restore
  (L67), smaller drift batches (L74).
- **Every HA call has a 30 s limit** (120 s restore, no retry), stale
  `running` jobs reset on worker start, shutdown drains the in-flight job,
  applied jobs pruned daily (L115, L65).
- Backup key rotation with a key id in the file header (L79) — shared with
  phase 13.

TS reference: Runs 11–12, 40. Fixes: L07 rotation, L65–L67, L74, L79, L115.

### Phase 12 — Notifications, push, alerts, activity, insights

**Status: implemented in backend (best-effort parity; end-to-end/real-device validation remains environment-dependent).**

- In-app notifications, `/ws` delivery (event types supported), per-person preferences and quiet
  hours: schema/services/routes added (`/api/v1/notifications`, mark read/all, user preferences/push subscriptions/test).
- Web Push (VAPID) and FCM with configurable push-service allow-list
  (L73): subscription register/unregister/list/test APIs, validation/limits/rate-limit/quiet-hours/suppression and dropped-device cleanup implemented; push platform/vapid info exposed. Env/config wiring (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FCM_SERVICE_ACCOUNT`, `WEB_PUSH_HOST_ALLOWLIST`) and provider implementations added (WebPush via `com.interaso:webpush`, FCM HTTP v1 with service-account OAuth/JWT). **End-to-end delivery parity depends on runtime credentials/network and real push-client behavior.**
- Power-limit alerts with hysteresis and left-open alerts (L94): alert storage/list/ack, notification emission and `/home` alert counts implemented; per-device left-open threshold persisted (`entity_settings.left_open_after_ms`), state-aware evaluation/clear on HA state changes, and periodic sweep via `Phase12Coordinator` using current HA states (default 10 minutes when unset).
- Activity timeline and backfill (L77, L69): storage/list/seen APIs, permissions/visibility-aware filtering, retention/prune primitives and periodic pruning added. Event-driven hooks wired for confirmed user/AI commands, scene activations, routine completion/failure, mode changes, automation manual runs/HA trigger events and `alice_notification`, presence updates, lock changes, and alert creation paths. HA gateway logbook fetch and best-effort backfill-on-connect/reconnect added with dedupe windows and device-name/automation-name attribution improvements. **Visibility/"hide details" semantics follow enforced permission/device visibility in current implementation; exhaustive TS-equivalent parity for every edge case/origin and external logbook completeness is not fully proven here.**
- Insights (mode suggestions) on demand and on presence/mode/automation-trigger events;
  "not now" per mode and time of day: `InsightsService` + `/api/v1/insights` and household-mode suggestion integration implemented with periodic and event-driven ticks.

TS reference: Runs 11–13, 16. Fixes: L69, L73, L77, L94 (implemented in code; runtime/e2e validation caveats remain).

### Phase 13 — History, energy, admin, audit, backups

- **History:** `GET /api/v1/history/devices/{id}` implemented with range parsing
  (default 24h, ≤31 days), entity selection, maxPoints clamping/downsampling,
  HA history fetch/normalization, permission-aware visibility, and Alice-side
  attribute log capture/merge for HA-unrecorded attributes (e.g. brightness/color,
  temperature/position/fan speed) via `entity_attribute_log` (L75, best-effort).
- **Energy:** `/api/v1/energy/summary|history|pattern|devices` implemented with
  HA statistics aggregation, timezone-aware day boundaries, device meters/limits,
  hourly/daily history and pattern baselines (best-effort parity).
- **Admin/Audit/Support:** `/api/v1/admin/health|diagnostics|audit|metrics`
  implemented with basic checks/diagnostics, cursor-paged audit listing, metrics,
  and audit/attribute-log prune helpers; `/api/v1/admin/support` (state/grant/
  extend/end) and operator read API (`/api/v1/operator/homes`, health/devices)
  implemented with scope checks and audit trails (best-effort parity).
- **Backups:** `backup_records` schema plus `/api/v1/backups` APIs for settings,
  list, create (app/HA enqueue), verify, download, delete and staged restore;
  local/basic NAS handling, gzip + optional AES-256-GCM packing (with multi-key
  decrypt compatibility), snapshot/inspect, HA job result handling callbacks,
  retention, scheduled tick/catch-up, and startup restore-apply for staged backups
  implemented (best-effort parity).

TS reference: Runs 13–14. Fixes: L25, L46, L75–L82 (implemented with caveats).
**Caveats:** not fully TS-identical in all edge cases (backup key-id/header
rotation format, upload destination, free-space checks, dry-boot restore test
process parity, exhaustive HA backup verify/restore semantics, audit retention
policy/scheduling and filter parity, metrics/detail completeness, attribute-log
coverage/retention tuning, operator lifecycle endpoints, and dedicated Phase 13
e2e/real-HA test coverage).

### Phase 14 — Updates, support, Ask Alice, hardening

**Status: implemented in `backend-kt` (best-effort parity; Run 43).**

- **Updates:** `update_records` schema/queries plus `/api/v1/updates` routes for
  status/check/history, settings (auto-update + nightly window), schedule/install,
  emergency deploy (reason + `DEPLOY` + step-up), rollback (optional staged data
  restore) and cancel. Manifest source with optional Ed25519 signature verification
  (supports multiple configured publisher keys for rotation), basic `publishedAt`
  freshness/expiry sanity checks, `isNewer` semver/pre-release comparison,
  unsigned-install opt-in, safety backups (app always, HA when available with
  wait/timeout handling best-effort), marker-file installer (`update-requested.json`,
  reference supervisor handoff), periodic tick (check/schedule/install/timeout/
  auto-schedule), audit + admin notifications.
- **Support access hardening:** admin support grant/extend/end with scopes/expiry and
  audit trail retained; operator read-only API (`/api/v1/operator/homes|.../health|.../devices`)
  with Bearer token auth, scope checks and action audit; admin operator lifecycle
  endpoints added (`POST/DELETE /api/v1/admin/operators`, step-up + `security.manage`)
  for create/revoke best-effort parity.
- **Ask Alice:** rules-first interpreter over visible inventory (devices/areas/
  scenes/routines/modes) with proposal-only output; optional model provider
  interface (Anthropic Messages + forced `propose_actions` tool) with strict
  validation/clamping to allowed ids/actions/ranges and unlock marked sensitive.
  Per-household AI settings (`enabled`, `dailyModelCallLimit`) persisted in
  household settings with `GET/PUT /api/v1/ai/settings`, plus global AI
  enable/key/model config (`AI_ENABLED`, `AI_API_KEY`, `AI_MODEL`). Enforces
  per-user minute rate cap and per-household daily model-call cost guard
  (persisted in household settings for restart survival, best-effort semantics).
  `/api/v1/ai/interpret` never executes actions.
- **GraalVM/native/CI and deploy references (in-repo scaffolding):** existing
  Linux x64 native-image notes/build guidance retained; CI workflow
  (`.github/workflows/backend-kt.yml`, incl. `workflow_dispatch`) runs
  `backend-kt` build+test+installDist, a best-effort Linux x64 GraalVM
  native-image smoke job, a frontend surface check (best-effort), and a
  contract/e2e reference placeholder. Added reference artifacts:
  `backend-kt/scripts/update-supervisor.sh` (marker handoff/install-rollback
  contract), `backend-kt/scripts/native-smoke.sh`, `backend-kt/server/Dockerfile`,
  `backend-kt/docker-compose.yml` (server+worker reference), and
  `backend-kt/scripts/contract-e2e-env.md` (guide for running contract/frontend
  e2e and HA/provider validation against Kotlin backend).

TS reference: Runs 15–17, 40. Fixes: L78, L83–L85, L92, L93, L98.
**Caveats (require external execution/environments):** actually running verified
artifact install/rollback on real target hosts/supervisors, real HA
backup/restore/update end-to-end behavior against live HA, live model/provider
e2e and exhaustive proposal/visibility parity proof, full frontend
contract/e2e execution against a running Kotlin backend stack, and production
arm64/container/native packaging and CI matrix validation on target infra.

**Run 44 (continuation, audit follow-up, uncommitted):** addressed additional parity audit gaps in `backend-kt`:
- **Visibility/security:** per-caller policy filtering applied to device/thing/area/favorite listings and command target checks; command get/cancel/undo restricted to household + requester-or-admin.
- **Routes/wire (best-effort):** `GET /api/v1/backups/{id}` added; device unmerge implemented; `GET /api/v1/devices?favorite=true` honored; areas return `{id,name,deviceCount}`; devices/things/capabilities responses reshaped toward ThingView/decorated contract with visibility pruning and settings/favorites metadata (contract/e2e parity still requires TS-oracle validation).
- **Commands:** `Idempotency-Key` validated/wired (in-memory replay/fingerprint guard), command IDs switched to ULIDs; command store/idempotency persistence remains in-memory (DB tables not authoritative yet).
- **HA connection:** `/api/v1/ha/connection` now supports GET, PUT, POST `/test`, POST `/resync`, DELETE, and PUT `/admin-token` with service/query support (best-effort semantics).
- **Overrides persistence:** added `entity_overrides` schema/queries and persisted/loaded entity overrides and `thing_links` (merge/split/unmerge) in `ThingsService`; thing overrides persisted for rename/hide; override mutations emit audit records and best-effort `things.changed` events. Full TS parity for entity/thing override lifecycles, cache invalidation semantics, and all audit/event details remains incomplete.
- **Admin/AI:** diagnostics unread notification count now computed; Ask Alice settings endpoints guarded by `security.manage`.
- **Verification:** `cd backend-kt && ./gradlew build` **BUILD SUCCESSFUL** (tests green). Remaining gaps: DB-backed command/idempotency stores and full executor per-entity policy enforcement, exact TS wire/contract parity across all clients, complete realtime broadcast semantics (facets/devices.changed filtering/activity.created fallback), exhaustive HA/gateway/supervisor/provider/frontend e2e validation, and any TS-only edge behaviors not yet covered.

---

## 4. Cross-cutting rules

1. **The route table is the contract.** Every route added must update the
   parity manifest (and `backend/docs/API.md` only when a change is intended
   for both backends).
2. **One visibility helper.** Any listing that can return devices, entities,
   areas, scenes, notifications or activity calls the phase-2 helper; a test
   per module asserts a guest cannot see a denied device.
3. **No raw Home Assistant text** in any response, WS message or notification;
   it stays in logs and the database (`last_error_internal`).
4. **Every command is attributable**: actor, household, idempotency key,
   attempts, lifecycle timestamps.
5. **Migrations are append-only** once phase 1 lands; schema changes come with
   a SQLDelight `.sqm` migration and a test that opens an old file.
6. **Time is injected** (`java.time.Clock`), never `System.currentTimeMillis`
   in domain code, so tests can control windows, quiet hours and retention.

---

## 5. Definition of done per phase

- Unit tests for pure logic (golden fixtures for normalization, classification,
  expectations, compilation).
- Route tests with `testApplication` for status, headers, JSON shape and
  permission outcomes.
- Integration test against the mock HA for anything that touches it.
- `./gradlew build` green, no skipped tests.
- `docs/LIMITATIONS.md` updated with new caveats and the run log entry.

---

## 6. Verification strategy

Three rings, cheapest first:

### Ring 1 — unit and route tests

Fast, in-memory SQLite, fake HA. Runs on every change.

### Ring 2 — contract fixtures captured from the TypeScript backend

A separate harness (`tools/contract/`, not part of `backend/`) runs against the
TypeScript backend and records:

- `request → status, headers, body` pairs for every route family, with
  volatile fields normalized (`uptime`, ids, timestamps, cookies, signatures);
- WebSocket transcripts (subscribe → messages) by message type;
- error cases (401/403/404/409/422/429) and rate-limit headers.

The same requests are replayed against Kotlin; a structural diff fails the
build. Fixtures are generated, not hand-written, so they cannot drift from the
reference.

What is **not** compared: internal ids, ordering within the same millisecond,
generated secrets, HA-internal error text. Those are asserted by shape instead.

### Ring 3 — the existing frontend e2e suite

`frontend/e2e` is the acceptance test: it starts its own backend, worker and
mock HA and drives the real UI. Point its backend start command at the Kotlin
`server`/`worker` (environment/entrypoint only, no product code change) and it
becomes the parity suite for the cutover. It covers sign-in, home, rooms,
commands, undo, scenes, routines, automations, admin and push registration.

A differential run (both backends, two mock HA instances on 8123/8124, same
seed, same script, JSON diff) is used before each cutover stage for routes the
e2e suite does not touch (backups, updates, support, Ask Alice).

---

## 7. Cutover

1. **Shadow** — Kotlin runs against its own mock HA; contract fixtures and the
   e2e suite run nightly. No client traffic. Fix diffs until green twice.
2. **Canary** — a reverse proxy sends a small cohort (header/cookie) to
   Kotlin. Start read-only (`/health`, devices, areas, things), then commands,
   then `/ws`, then admin. Both backends run side by side; each has its own
   database and HA connection.
3. **Full** — all traffic to Kotlin. TypeScript stays runnable for rollback for
   one release.

Because the Kotlin backend uses a fresh database, cutover is a **new install**:
users re-register passkeys (or use an invitation) and devices are re-discovered
from Home Assistant. That is acceptable while there is no production data. If
that changes before cutover, add a one-time exporter/importer (identity,
household, overrides, scenes, routines, automations) — explicitly out of scope
now.

---

## 8. Disposition of `backend/docs/LIMITATIONS.md`

Legend: **fix** = solved at first implementation; **port** = same behaviour;
**later** = parity now, improvement after cutover; **keep** = accepted
permanently; **n/a** = not this backend.

### Facets

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L01 | partial | keep override; SMART suggests polarity from device class/model | 8 |
| L02 | accepted | keep English token table; locale tables later | 13 |
| L03 | resolved | port (overrides survive resync) | 4 |

### Persistence, ids, events

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L04 | partial | **fix**: persist the `ha_*` projection | 3 |
| L05 | resolved (rename) | **fix**: create `command_attempts` | 5 |
| L09 | open | **fix**: `entity.attributes_changed` + per-consumer throttle | 3 |
| L10 | accepted | keep in-process bus, keep adapter seam; resync on start | 3 |
| L11 | partial | port: correlate `context.id` ↔ `commands.ha_context_id` | 5 |
| L22 | mitigated | port; incremental rebuild only if fixtures demand it | 4 |
| L36 | mitigated | **fix**: monotonic ULIDs (done) | 0 |
| L47 | accepted | **fix**: append-only migrations from phase 1 | 0/1 |

### Security and auth

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L06 | resolved | port (`/api/v1/ha/connection` + permission) | 3/6 |
| L07 | mitigated | port sealed token; **fix** rotation | 11 |
| L37 | mitigated | port + per-account lockout | 1 |
| L38 | mitigated | port; **fix** revoke-all on credential change | 1 |
| L39 | accepted | **fix**: real attestation + AAGUID policy, UV at login when required | 1 |
| L40 | open | n/a backend; native clients + HTTPS domain tracked in client work | 1/client |
| L41 | open | **fix**: admin-assisted recovery + notify admins | 1/2 |
| L48 | mitigated | **fix**: per-account lockout, command/admin route limits | 1/6 |
| L114 | mitigated | port setup code, generated and printed once to stderr in production (not through logging) | 1 |

### Things and facets

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L15 | accepted | keep | 4 |
| L16 | partial | keep overrides; no classifier rewrite | 4 |
| L17 | accepted | keep | 4 |
| L18 | partial | keep tuple merge; manual merge | 4 |
| L19 | accepted | **fix**: create entity-less hub Things on demand | 4 |
| L20 | open | **fix**: alias index + fuzzy resolver | 8 |
| L21 | accepted | keep | 4 |
| L50 | mitigated | **fix**: strip invisible `hubThingId` | 6 |
| L51 | open | **fix**: unmerge endpoint + link compaction | 4 |

### Commands

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L08 | partial | **fix**: group commands undo as one unit | 5/9 |
| L27 | resolved | port interrupted-command recovery | 5 |
| L28 | open | **fix**: retries + `command_attempts` | 5 |
| L29 | partial | **fix**: Thing-level policies; automation actor identity | 2/9/10 |
| L30 | open | **fix**: per-device tolerances (`percentage_step`) | 5 |
| L31 | accepted | **fix**: per-entity serialization | 5 |
| L32 | open | **fix**: late confirmation annotation | 5 |
| L33 | open | **fix**: undo for scenes/routines/groups | 5/10 |
| L34 | accepted | **fix**: resync availability before failing | 5 |
| L35 | resolved | port public command form + masked errors | 5/7 |
| L52 | mitigated | port; clients should require keys on toggles | 5/8 |
| L53 | resolved | port favorites/settings/alerts/voice/undo | 9 |

### Realtime

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L55 | accepted | keep in-process hub behind interface; adapter later | 7 |
| L56 | open | **fix**: immediate revocation, policy cache with invalidation | 7 |
| L57 | open | **fix**: per-entity coalescing + bounded queue | 7 |
| L58 | accepted | n/a (Bun-specific) | — |
| L59 | open | **fix**: protocol version + token auth option | 7 |

### Scenes, routines, modes, groups

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L60 | mitigated | port HA script mirroring | 9/11 |
| L61 | mitigated | port persisted/resumed runs | 10 |
| L62 | open | **fix**: overall run timeout | 10 |
| L63 | mitigated | keep flat groups; dynamic/re-link later | 9 |
| L64 | mitigated | port mirror + suggestions; richer rules later | 9/12 |
| L70 | accepted | port; richer rules in SMART | 12 |

### Config-worker and HA sync

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L25 | open | port backup destinations (`ha`, `nas`, reserved `upload`) | 13 |
| L65 | open | **fix**: prune jobs, packaged supervisor unit | 11 |
| L66 | accepted | keep; dedicate a restricted HA user later | ops |
| L67 | mitigated | port drift + optional auto-restore | 11 |
| L74 | accepted | **fix**: smaller drift batches | 11 |
| L115 | resolved | **fix**: timeouts, stale-job reset, shutdown drain, pruning | 11 |

### Automations, presence, notifications

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L68 | mitigated | port; "run now" for non-sensitive later | 10 |
| L69 | partial | port; **fix** retention + "hide details" | 12 |
| L72 | mitigated | port; auto-link by email/HA user id | 10 |
| L73 | accepted | **fix**: configurable push-service allow-list | 12 |
| L77 | accepted | **fix**: logbook backfill on reconnect | 12 |
| L94 | accepted | **fix**: per-device left-open threshold | 12 |

### History, energy, admin, backups

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L75 | open | **fix**: Alice-side attribute log for brightness/colour | 13 |
| L76 | open | keep metered totals; tariff/dashboard sources later | 13 |
| L78 | open | **fix**: metrics endpoint (Prometheus) | 14 |
| L79 | accepted | **fix**: key id header + rotation | 13 |
| L80 | accepted | port; add dry-boot restore test | 13 |
| L81 | accepted | port HA backups; second location via HA agent | 13 |
| L82 | accepted | port; add free-space check | 13 |
| L95 | accepted | port + cache weekly baselines | 13 |

### Updates, support, AI, tests, frontend

| ID | TS status | Kotlin decision | Phase |
|---|---|---|---|
| L26 | mitigated | keep out-of-process; ship reference supervisor | 14 |
| L83 | accepted | port marker-file updater + reference supervisor | 14 |
| L84 | mitigated | port signed manifests + key rotation/expiry | 14 |
| L85 | mitigated | port rollback + safety backups | 14 |
| L92 | open | port rules-first Ask Alice; model behind an interface | 14 |
| L93 | accepted | port read-only support access | 14 |
| L98 | open | **fix**: CI workflow for Kotlin (build, tests, contract, e2e) | 14 |
| L86–L91 | frontend | n/a — no backend work | — |
| L96–L97 | test/push | n/a — reuse e2e; real-device push is a client task | — |
| L99–L113 | phone/visual | n/a — frontend/Compose work | — |
| L116 | setup scripts | n/a — new stack gets its own scripts; Docker names must not collide | 14 |

### Summary

- **fixed in the Kotlin build:** L04, L05, L09, L19, L20, L28, L29, L30, L31,
  L32, L33, L34, L36, L38, L39, L41, L43, L46, L48, L49, L50, L51, L56, L57,
  L59, L62, L65, L67, L68, L72–L75, L77, L78, L79, L82, L94, L95, L98, L114,
  L115
- **ported unchanged:** L03, L06, L10–L13, L14, L15–L18, L21, L25, L27, L35,
  L47, L52, L53, L55, L60, L61, L63, L64, L66, L69, L70, L76, L80, L81,
  L83–L85, L92, L93
- **kept/accepted:** L02, L16, L17, L21, L42, L44, L58, L66
- **out of backend scope:** L40, L86–L91, L96–L97, L99–L113, L116

No limitation is silently dropped: every row above has an owner phase or an
explicit `n/a`/`keep` decision.
