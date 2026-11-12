# End-to-end parity plan: `backend-kt` against the TypeScript backend, with a throwaway Home Assistant

Status: **plan only, nothing built or run yet.** Written 2026-11-12, reworked the same day to **backend only** (no UI tests) and to cover **every capability** of the backend.
**How to execute this plan, step by step, for any agent: [E2E_RUNBOOK.md](E2E_RUNBOOK.md)** (commands, task list, test-card template, schemas, rules). Companion docs: [PARITY.md](PARITY.md) (what parity means, §1; verification rings, §6; cutover, §7), [LIMITATIONS.md](LIMITATIONS.md), `backend/docs/API.md` (the wire contract), `backend/docs/LIMITATIONS.md` (L-numbers).

## 0. What this plan is for

**Scope.** The backend only: the HTTP API, the `/ws` feed, the config-worker, the database behaviour visible through the API, and everything the backend does to and with Home Assistant. **No browser, no frontend, no Playwright.** Every client is a script that speaks HTTP and WebSocket, so a failure always points at the backend, never at a screen.

**Capability-complete.** Besides comparing against the TypeScript backend, every capability a customer is promised in `FEATURES.md` and every route in `API.md` gets its own **capability test** that passes or fails on whether the backend does what the feature says, even where the TypeScript backend would do the same wrong thing (§4.0). Parity with a bug is reported as parity *and* as a capability failure.

The user wants to **confirm how far `backend-kt` reaches parity with `backend/`**, with reports that say, for every check, **what worked, what did not, and why it did not**. So the plan is built around two things:

1. **Evidence.** Every check names its oracle (what decides right from wrong) and keeps what it saw.
2. **Honest outcomes.** A check that could not run is reported as *blocked*, never as passed. A pass is only claimed for what was actually exercised, and the report lists everything that was not.

"Parity" is the definition in PARITY.md §1: contract parity (same paths, methods, status codes, headers, JSON shapes, WebSocket messages, permission outcomes, command lifecycle, undo window, step-up rules, rate-limit outcomes), not source parity. The TypeScript backend is the oracle where the docs are silent; **Home Assistant itself is the oracle for side effects** (did the light really change, does the script really exist).

## 1. Principles

| # | Principle | Consequence |
|---|---|---|
| P1 | Two oracles, never one | A Kotlin response is judged against (a) the TS backend's response to the same request and (b) the documented contract. Side effects are judged against (c) Home Assistant's own state. When (a) and (b) disagree, the report says so; it does not pick silently. |
| P2 | Same script, same seed, two stacks | The identical scenario runs against TS and Kotlin, each with **its own** throwaway HA seeded identically, so nothing one does can change what the other sees. |
| P3 | Nothing is ever "assumed passed" | Outcome set is PASS, FAIL, BLOCKED, DIFF-ACCEPTED, N/A (see §8). Anything not run is listed with the reason. |
| P4 | A failure carries a verdict on *whose fault* | Each FAIL/BLOCKED is classified (Kotlin defect, TS quirk, HA behaviour, harness defect, environment) with the evidence that supports it (§8.2). |
| P5 | The user's real setup is never touched | New compose project name, new container names, new ports, new volumes, own temp dirs. The existing `alice-ha-mock`, `alice-ha-demo` and `alice-ha` containers, `backend/.env.test`, ports 3001/3002/3010/3012/8123 and any real data are not used. Teardown removes only what the run created. |
| P6 | Deterministic first, then hostile | Functional scenarios on a calm HA first; chaos (HA restart, pause, network cut) as a separate suite so a flaky environment cannot mask a functional diff. |
| P7 | Fixtures are generated, not hand-written | Expected values come from running the TS oracle, not from memory (PARITY.md §6, ring 2). |

## 2. The throwaway environment

### 2.1 What is created (and only this)

| Thing | Name / port | Notes |
|---|---|---|
| Compose project | `alice-parity` | `docker compose -p alice-parity ...`; teardown is `down -v` on this project only |
| HA instance A (for the TS oracle) | container `alice-parity-ha-a`, host `127.0.0.1:18123` | image pinned to the repo's `ghcr.io/home-assistant/home-assistant:2026.10.4` (already pulled; no new download) |
| HA instance B (for Kotlin) | container `alice-parity-ha-b`, host `127.0.0.1:18124` | identical config and seed to A |
| TS backend + its config-worker | `127.0.0.1:3101` | fresh SQLite in a temp dir, fresh keys |
| Kotlin server + its worker | `127.0.0.1:3102` | fresh SQLite in a temp dir, fresh keys |
| Run directory | `backend-kt/e2e/.runs/<timestamp>/` (git-ignored) | databases, logs, HAR-style transcripts, reports |

A **pre-flight** step refuses to start if any of those ports or names is already taken, and prints what holds it (it never kills anything it did not start).

### 2.2 Home Assistant

- Configuration: reuse `backend/dev/ha/configuration.yaml` (demo integration, `input_boolean`, `input_number`, `scene`, `person`, `history`, `logbook`, `sun`, `backup`, `conversation`, file recorder). Add, through a separate parity pack so the shared dev config is not edited: extra `person` entries, a template door sensor, `input_select` for modes, a power-metering `sensor` set (so power-limit alerts and energy have real numbers), and the `scripts.yaml` / `automations.yaml` init container the repo already uses.
- Bootstrap: reuse `backend/dev/ha/bootstrap.ts` (onboard, mint a long-lived token) with `HA_URL` and `ENV_FILE` pointed at the parity instances (it supports both), and `seed-home.ts` (rooms, friendly names, doors locked) with `DEMO=1` for the richer set. Output goes to the run directory, never to `backend/.env.test`.
- Resets: a **snapshot** of each HA volume right after seeding (`docker run --rm -v ... tar`), restored between suites, so every suite starts from the same state without paying for a cold start. A full `down -v` and rebuild is the fallback when a snapshot restore fails, and that fact is recorded in the report.
- Control levers for tests: HA's own REST/WS (set state, call service) to cause *external* changes ("someone flips a switch on the wall"); `docker pause/unpause/restart/stop` on the instance for outage tests; `docker network disconnect/connect` for a partial network cut.
- **Time**: HA and both backends run on UTC and real time. Anything that depends on the clock (nightly backup, quiet hours, update window, session TTL, 10-minute undo, 10-minute left-open alert) is tested either through a config knob that shortens it (preferred, see §6 for which exist) or marked BLOCKED with the reason; the plan never fakes time on one side only.

### 2.3 Two backends, same inputs

- **Keys.** `bun backend/scripts/generate-keys.ts` for each run. First check (E2E-ENV-04): the seal keys, secrets key, VAPID keys and backup key it prints are accepted by Kotlin (key formats are a parity point, PARITY.md §8 / `parseKey`). If Kotlin cannot read them, that is the first reported finding, and Kotlin gets its own generator for the rest of the run.
- **Config env.** Both servers get the same logical settings (`WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID`, `CORS_ORIGINS`, `SETUP_CODE`, step-up TTL, session TTL, `BACKUP_DIR`, `UPDATE_MANIFEST_URL`, `AI_*`), mapped to each backend's variable names (Kotlin reads `DATABASE_PATH` / `DATABASE_URL`, `SERVER_PORT` / `PORT`, per `core/config`).
- **Worker.** Each stack runs its own config-worker, with `ADMIN_SEAL_PRIVATE_KEY` only in the worker's environment, as in production. A check proves the server process cannot read the admin token (the split is the security point).
- **Update manifest.** A tiny local HTTP server inside the harness serves a signed manifest (signed with a generated test key) for the updates suite; it is the only "external service" and it is the harness's own.
- **LLM and push.** No real Anthropic, Firebase or push service is contacted by default (see §9 for what that makes unprovable). Fakes are local HTTP servers owned by the harness.

## 3. Harness architecture

A new top-level folder `backend-kt/e2e/` (outside both products; the TS backend is not modified).

```
backend-kt/e2e/
  env/            compose files, HA parity pack, bootstrap/seed wrappers, snapshot/restore, preflight, teardown
  lib/            http client, ws client, software passkey authenticator, normalizer, differ, ha-truth (reads HA directly)
  scenarios/      one file per domain (auth, household, things, commands, realtime, scenes, ...); each scenario is a
                  function run against a "stack" object, so the same code runs on TS and Kotlin
  suites/         capability, api-differential, ha-truth, realtime, worker-sync, resilience, soak
  report/         result model, classifier, markdown + JSON + HTML writers, route-coverage matrix
  run.ts          the single entry: `bun e2e/run.ts --suite all|<name> --only <ids> --keep-env`
```

Language: **Bun/TypeScript** for the harness. Reasons: the oracle and the existing HA bootstrap/seed scripts are already TS/Bun, and the TS backend's own testing helpers (`backend/src/testing/http.ts` `Browser`, the passkey logic) can be reused or ported. The harness only speaks HTTP and WebSocket to both backends, so it stays implementation-agnostic.

### 3.1 The pieces that need real work

1. **Software passkey authenticator** for HTTP-level tests (ES256 keypair, `none`/`packed` attestation, signature counter, resident key, user-verification flag, step-up assertions). It is the only authenticator in the plan: there is no browser. Include the negative cases: wrong origin, wrong rpId, replayed challenge, counter regression, UV missing when required (`REQUIRE_UV_AT_LOGIN`).
2. **Normalizer** (what is *not* compared, PARITY.md §6): ids (type-prefixed ULIDs are checked by *shape*), timestamps (shape and ordering, not value), cookies (attributes compared, value not), signatures, `uptime`, HA-internal error text, ordering within the same millisecond. Everything else is compared literally, including field presence (`null` fields omitted) and status codes.
3. **Structural differ** with three result kinds: *identical*, *shape-identical* (same keys and types, values differ in normalized fields), *different* (reported with a JSON path and both values).
4. **HA-truth reader**: after an Alice command, read the entity back **from HA directly** and compare with what Alice reported ("confirmed" means HA really changed).
5. **Transcript recorder** for every request, response (status, headers, body), and WebSocket message, kept per test, so a failure report can show exactly what happened.

## 4. Test catalogue

Test IDs are `E2E-<AREA>-<nn>`. "Oracle" says what decides the verdict: **TS** = same request to the TypeScript backend, **HA** = Home Assistant's own state, **SPEC** = `API.md`/PARITY.md, **SEC** = a security property that must hold regardless. Every API-visible test also records the *error* case (401/403/404/409/422/429) of its route.

Counts are estimates; the route-coverage matrix (§7.2) is what keeps the list honest.

### 4.0 Capability traceability (what "all capabilities" means here)

Every bullet of `FEATURES.md` is a capability, and every one gets at least one **capability test**: a scenario that passes or fails on the behaviour promised, judged by SPEC and HA (and SEC where it is a safety promise), run on Kotlin and, for comparison, on TS. The report has one line per capability with its tests and outcome; a capability with no passing test is shown as **unproven**, not omitted.

| FEATURES.md capability | Test areas that prove it |
|---|---|
| One card per device: clean names, right rooms, no entity pile; rename, hide, merge, split; related settings on their device; search by name or nickname, filter by room or type, pin favorites | `DEV`, `FAV`, inventory diff |
| Controls fit the device (light, climate, fan, cover, lock, media, vacuum) | `CMD` per family: the backend offers exactly the capabilities that device has |
| "Alice checks that the device did what you asked and tells you if it didn't" | `CMD` confirm / fail / timeout / late confirmation, verified in HA |
| Undo the last change within ten minutes | `CMD` undo inside and outside the window, of a group, of an undo |
| Group devices and control them together | `FAV` groups, `CMD` group commands |
| Scenes: several devices at once | `AUT` scenes, with the script in HA |
| Routines: ordered steps, delays, call scenes, change mode | `AUT` routines |
| Automations: every trigger and condition, plain-English summary, dry-run preview | `AUT` automations |
| Everything also lives in HA and runs with Alice offline; 15-minute drift check | `AUT` offline proof, drift, config jobs |
| Household modes; Alice suggests but never changes mode on its own | `AUT` modes, `HH` presence |
| Passkey sign-in, recovery codes; fresh passkey for sensitive actions | `AUTH` |
| Roles admin/member/guest; guests only see allowed devices, no history | `HH`, `DEV`, `WS`, `NOTE` visibility checks (SEC) |
| Invite family and guests with a code | `HH` invitations |
| Audit trail of every command | `ADM` audit, `CMD` |
| Admin credential sealed, worker holds the key | `AUTH`/`ADM` seal split (SEC), log grep |
| Time-limited, read-only support access | `ADM` support and operator |
| Activity timeline, alerts (power limit, door left open), push | `NOTE` |
| Energy: live draw, today, top consumers, history, comparison, power limit | `HIST` |
| State history of any device | `HIST` |
| Ask Alice: typed request becomes a proposal, you confirm, only what you may control | `AI` |
| Voice exposure for HA's assistant | `DEV` settings, `AI` |
| Backups of Alice and HA with verification; health, updates, sync status | `ADM` |
| Live updates without refreshing | `WS` |
| Works with HA OS, Container or Core by address and token | `HA` connection tests; only the **Container** flavour can be run here (§9) |
| Reverse proxy / tunnel support, `/ws` forwarded | `X` proxy and origin checks |

### 4.1 Environment sanity (`ENV`) — 8 checks, must pass before anything else counts

| ID | Check |
|---|---|
| ENV-01 | Both HA instances reach `running`, same version, same seed (entity-by-entity state equality) |
| ENV-02 | Both backends answer `GET /health` with the same shape |
| ENV-03 | Snapshot/restore of an HA volume returns the seeded state (proves resets are real) |
| ENV-04 | Generated keys are accepted by both backends |
| ENV-05 | No resource from the user's existing containers/ports/data was touched (container list, port list, `backend/.env.test` hash before and after) |
| ENV-06 | The harness's software passkey completes a registration on the TS backend (proves the authenticator itself is right before blaming Kotlin) |
| ENV-07 | The two clocks (host, HA, backends) agree within a second |
| ENV-08 | A deliberately wrong expectation in the harness is reported as FAIL (guards against a reporter that cannot fail) |

### 4.2 Authentication and sessions (`AUTH`) — about 24

Setup code and first-user registration (household created, recovery codes returned once); invited-user registration with an invitation code (wrong, expired, reused, role honoured); login options/verify; wrong origin/rpId; challenge replay; challenge expiry; logout; `GET /auth/session`; list and revoke sessions; session TTL; cookie attributes (`HttpOnly`, `Secure` where applicable, `SameSite=Lax`); CSRF/SameSite check and `/ws` origin check (mirrors `csrf.e2e`); step-up (fresh assertion window, expiry, wrong user); add/list/delete passkeys (last passkey cannot be deleted); recovery-code sign-in (single use, then must add a passkey); per-account lockout and rate limits (outcome and `Retry-After`); revoke-all on credential change; UV-required policy. Oracle: TS + SPEC + SEC.

### 4.3 Users, household, members, invitations, permissions (`HH`) — about 28

Profile and preferences (quiet hours, push toggle); household name/timezone; members list with presence; role change (A/M/G rules, last admin cannot be demoted or removed), expiry, device visibility; remove member (sessions revoked, passkeys gone); invitations create/list/revoke (code shown once, role and expiry honoured, one-time use); person ↔ member linking (`GET/PUT /household/people`, one person per member, unlink); presence derived from HA `person` state changes made from outside; device policies allow/deny (deny beats allow; guest needs an allow; guest expiry cuts access); sensitive-operation rules. **Device visibility is also asserted on the wire**: a guest's `/devices`, `/ws` and `/activity` never contain a device they cannot see. Oracle: TS + SPEC + SEC.

### 4.4 Home Assistant connection and sync (`HA`) — about 22

`PUT /ha/connection` with good, wrong-token, wrong-URL, unreachable, and unsafe (link-local, non-http) targets; `GET` status; `POST …/test`; admin-token storage through the worker (seal round trip); resync; discovery of the seeded entities into the same Things on both backends (count, names, areas, primaries, capabilities); entity rename/area move in HA reflected after sync; entity removed in HA; new entity added in HA after the first sync (incremental rebuild); HA reconnect with backoff after a restart (chaos suite); token revoked in HA mid-run (status becomes auth-failed, no crash loop); Things model: hub Things, merge/split/unmerge, rename/hide overrides survive resync; **drift detection** (edit an Alice-created script directly in HA; the 15-minute check, or `POST /admin/config-sync/verify`, reports it). Oracle: HA + TS.

### 4.5 Things, devices, areas, capabilities (`DEV`) — about 30

`GET /devices` with `area`, `type`, `q`, `favorite`; `GET /devices/:id` with and without `include=diagnostics`; capabilities and facets per domain (light, switch, fan, climate, cover, lock, camera, sensor, binary sensor, media player, vacuum, input helpers); facet polarity; name cleaning; search over names and aliases; `PATCH …/settings` (power limit, voice, guest visibility); `PATCH …/name`; entity role route (blocking the main entity hides the device, `hubThingId` stripped); per-caller visibility pruning (404 not 403); areas list; merge/split/unmerge; hide. Every device in the seeded home is compared Thing-for-Thing between TS and Kotlin (a single "inventory diff" test with a precise report of any Thing that differs and in which field).

### 4.6 Commands, undo, idempotency (`CMD`) — about 36 (the heart of "does it really work")

For each command family (power, brightness, color temperature, color, fan speed/oscillation/preset, climate mode/target/fan mode, cover open/close/position, lock/unlock, media transport and volume, vacuum): send, assert `202` with the command, assert the lifecycle events (`pending → sent → confirmed`), and **assert HA's real state afterwards**. Then:

- Failure paths: unavailable device, value out of range (clamped or rejected exactly like TS), unsupported capability, a command HA rejects (message replaced by the fixed sentence, raw HA text never on the wire, L35), a device that never confirms (timeout, state `timed_out`), a late confirmation.
- Unlock needs step-up for everyone; guests cannot command devices without an allow; admin/member/guest matrix.
- `Idempotency-Key`: same key twice returns the same command and sends once; same key with a different body is refused; key expiry.
- Per-entity serialization and coalescing (rapid brightness drags collapse; order preserved per entity); retry attempts; interrupted-command recovery after a **Kotlin server restart** mid-flight (kill -9 between send and confirm; on boot the command is resolved, not stuck).
- **Undo** within the window (inverse command dispatched and confirmed in HA), after the window (refused), undo of an undo, undo of a group command.
- Group commands (member devices that fail do not hide the ones that worked).
- Command events delivered to the sender and admins only (L35).

Oracle: HA for the effect; TS for status codes, lifecycle events, error codes.

### 4.7 Realtime `/ws` (`WS`) — about 20

Connect (auth by cookie, origin check, unauthenticated close code); subscription grammar; `state.changed` for a change made **from outside through HA**; command events (requested/confirmed/failed/timed-out, `requestedState`); per-person filtering (guest sees only allowed devices; member does not see another person's command events); reconnect and resume (no replay by design: the client refetches; the test checks that `refresh` yields the same data as the missed events would have); ping/pong and idle timeouts; backpressure (a slow client does not stall others); message ordering per entity; hub restart. The WS transcript is recorded and diffed by message type and payload fields. Oracle: TS + SPEC + SEC.

### 4.8 Favorites, groups, device settings (`FAV`) — about 16

Favorites add/remove/reorder, max count, favorites filter; groups create/rename/members/delete, group state aggregation, group commands; per-person isolation (my favorites are not yours); guest sees only visible group members; settings persistence across restart.

### 4.9 Scenes, routines, automations, modes (`AUT`) — about 40

The worker and HA make this the most side-effect-heavy area, so each item is checked **in Alice and in HA**:

- Scenes: create → a script exists in HA (compare the generated YAML of TS-created and Kotlin-created scripts after normalizing; they need not be byte-equal but must be *behaviourally* equal: run both and compare HA state); run from Alice; edit; delete (script removed in HA); a scene referencing a device that later disappears.
- Routines: ordered steps, delays, calling a scene, setting the household mode; stop/cancel mid-run; run history (`routine_runs`); a step that fails.
- Automations: every trigger (arrive, leave, time, sunset, door opens, motion, power over limit) and every condition (dark, who is home, weekday/weekend, mode); plain-English summary text equal to TS; **dry-run preview** equal to TS; saving one that unlocks a door is refused/needs step-up; the automation exists in HA and **fires there when its trigger happens, with Alice offline** (stop the Kotlin server, trigger it in HA, assert the effect) — the "keeps running if Alice is offline" promise.
- Household modes: switch Home/Away/Night/Vacation, mode mirrored to an HA `input_select`, mode change suggested but never applied on its own, presence-driven suggestion ("Everyone has left, switch to Away?").
- Config jobs: queued → applied → verified; worker down (job stays queued, `canApply:false`), worker back (applies), apply failure (reported with a reason), drift (changed behind Alice's back, flagged, fixable).

### 4.10 Activity, notifications, alerts, push (`NOTE`) — about 22

Activity timeline entries and filtering; notification created for a power-limit crossing (raise at 90%, clear below 85%), a door/window/garage left open (10 minutes; test uses the shortened window if both backends expose one, otherwise BLOCKED with that reason), arrival/leave; read/unread; quiet hours (urgent still goes); push subscription CRUD (max 10, https and known push-service rule, tokens never returned); test push to a **harness-owned fake push endpoint** (request is well-formed: Web Push encryption headers/VAPID, FCM payload shape); dropped device (410) is forgotten; runaway-sender cap (30 per 10 min). Not provable here: delivery to a real device (§9).

### 4.11 Energy, history, insights (`HIST`) — about 20

Live power from the metering sensors; today's usage; top consumers; hourly/daily history per device; comparison sentence ("Used 20% more than usual") with the same wording and threshold as TS; power-limit setting; state history for a device (HA recorder, compared with HA's own `history` API); the attribute log for HA-unrecorded attributes (brightness/colour); empty-history and gap handling; large range and pagination.

### 4.12 Ask Alice (`AI`) — about 14

Rules-first sentences (on/off, lock/unlock, brightness, temperature, scene/routine/mode names, rooms, "all/everything") return the same proposals as TS; **nothing runs until a proposal is picked**; unlock is always marked sensitive; ids outside what the caller may see are never proposed; per-user rate cap and the per-household daily model-call cap; AI settings route; the model path against a **fake provider** (forced tool call, malformed output, clamped values, timeouts). Real-model behaviour is not provable here (§9).

### 4.13 Backups, updates, administration, support (`ADM`) — about 36

- Backups: make now (app DB + HA backup through the worker), checksum, encrypted file present, **restore test** (open as a database, check people/homes/tables), verification status, list, download, delete (needs step-up), retention (keep N), schedule on/off, include-HA toggle, HA backup listed/checked/deleted by HA. **Restore** into a scratch copy is exercised for the app database; restoring an HA backup restarts HA, so it runs only in the chaos suite against its own instance and is otherwise marked BLOCKED (not skipped silently), per L81.
- Updates: manifest fetch, signature valid / tampered / wrong key / unsigned (refused unless opted in), version comparison (semver and pre-release), freshness/expiry sanity, schedule/install/cancel, safety backup first, marker file handoff (`update-requested.json`), rollback with and without data restore, emergency deploy (reason + `DEPLOY` + step-up), history. The *installing* itself needs a supervisor on a host; the harness ships a fake supervisor (it consumes the marker file), so the check proves the handoff, not a real install (§9).
- Administration: health report (database, HA, worker, config jobs, push, backups, updates), audit log filter and paging, diagnostics, summary; who can see what (admin only).
- Support access: grant (scope, hours, ≤24 h), extend (step-up, cap), end, expiry on its own; **operator API** with bearer token: scope enforced, read-only (every write is refused), never unlocks, every action audited; operator create/revoke.

### 4.14 Cross-cutting contract (`X`) — about 18

Error envelope on every error (`{"error":{"code","message","details"?}}`, snake_case, no raw HA text); validation errors use `validation_error`; ULID and Unix-millisecond conventions; pagination (`limit`, `cursor`, `nextCursor`); OpenAPI/`/docs` presence; CORS (allowed and denied origins, preflight); `TRUST_PROXY` behaviour behind the repo's reverse-proxy setup; request size limits; content-type handling; 404 on unknown routes; method-not-allowed; response headers; structured logs include a correlation id and **never contain secrets** (token, seal, cookie, recovery code grep over both stacks' logs); additive Kotlin endpoints (`GET /home`, SMART) exist but do not change any existing response.

### 4.15 Resilience and chaos (`CH`) — about 18, separate suite

HA container paused 30 s then resumed; HA restarted (backend reconnects with backoff and jitter, state resyncs, no duplicate commands); HA token revoked; HA slow (injected delay through a small TCP proxy in front of HA, the harness's own): commands time out cleanly; backend killed with `kill -9` during a command, a backup, a config job and an update handoff, then restarted (no stuck rows, nothing half-applied); worker killed and restarted; database file locked briefly; disk-full for the backup directory (error reported, no corrupt backup left); clock jump forward on the harness-owned fake manifest server; 200 concurrent WS clients; 1,000 rapid commands to one entity (coalescing, bounded queue, no unbounded memory). Each reports both backends' behaviour; a Kotlin-only failure is a finding, a both-fail is recorded as "oracle quirk, see L-number" if known.

### 4.16 Soak (`SOAK`) — optional last phase, 2 hours

Steady mixed traffic (reads, commands, WS clients, scheduled config jobs) while a script flips HA entities; watch memory/threads/open files/db size on both backends, and error rate. Reports growth curves, not just pass/fail.

## 5. Differential method (how a Kotlin response is judged)

```
scenario(stackTS, haA)  ──►  transcript_TS  ─┐
                                              ├─► normalize ─► diff ─► classify
scenario(stackKT, haB)  ──►  transcript_KT  ─┘
                       └──► HA-A end state  vs  HA-B end state  (entity states + scripts.yaml/automations.yaml, normalized)
```

Four comparisons per scenario: **responses** (status, headers that matter, body), **WS transcript** (message types, payload fields, per-person filtering), **HA end state** (the real side effects), **database-visible behaviour** only through the API (the two databases are not compared; PARITY.md §1 says the Kotlin schema is fresh by design).

Known and intended differences are listed in a checked-in file (`e2e/expected-diffs.yaml`, each entry: route, field, reason, link to PARITY.md or a Kotlin limitation). A diff that matches an entry is DIFF-ACCEPTED and shown in the report with its reason; any other diff is a FAIL. The file starts empty and grows only through review, so "accepted" can never become a dumping ground.

## 6. Long clocks: decided (see the runbook §2.3)

> **Update 2026-11-12:** the inventory was done while writing the runbook: neither backend has an environment override for the 10-minute undo window or the 10-minute left-open alert, so those checks run at real time in a slow tier. The text below is kept for the reasoning.

Tests that depend on long clocks (10-minute undo and left-open, 15-minute drift check, nightly backup, update window, session and step-up TTLs) need a way to shorten them **on both backends** or they cannot be compared. Step one of M0 is an inventory: which of these are configurable through the environment today (Kotlin already exposes `SESSION_TTL_HOURS`, `STEP_UP_TTL_MINUTES`, `CHALLENGE_TTL_MINUTES`), and which are constants. For each constant, the plan is: (a) if both backends take an env override, use it; (b) if only one does, the check is run at real time in the soak suite or marked BLOCKED with "no way to shorten on <backend>". Adding a knob to either backend is out of scope for the plan, and is listed as a recommendation, not done silently.

## 7. Reporting

### 7.1 Outcomes (every test ends in exactly one)

| Outcome | Meaning | Counts toward parity? |
|---|---|---|
| **PASS** | Ran on both stacks (or the stack(s) it applies to); all oracles agreed | yes |
| **FAIL** | Ran; at least one oracle disagreed or an assertion failed | counts against |
| **BLOCKED** | Could not run or could not conclude (environment, missing knob, HA limitation, harness defect); carries the reason | **unproven**, neither pass nor fail |
| **DIFF-ACCEPTED** | Differs from TS, listed in `expected-diffs.yaml` with a reason | yes, shown separately |
| **N/A** | Does not apply to Kotlin by design (e.g. a TS-only internal), with the link | not counted |

A FAIL is re-run once with the same inputs to separate a real defect from a flake; the report shows both attempts, and a test that passes only on re-run is reported as **FLAKY**, never as PASS.

### 7.2 Why it failed: the classification

Every FAIL and BLOCKED gets one primary cause, plus the evidence that supports it:

| Cause | Typical evidence |
|---|---|
| **Kotlin defect** | TS and HA both match SPEC, Kotlin does not; minimal request that reproduces; both responses side by side; Kotlin log lines around it |
| **Kotlin gap** (not built) | route 404/501 or documented as open in `backend-kt/docs/LIMITATIONS.md`; link to the L-number or PARITY.md phase |
| **TS quirk** (oracle is wrong or loose) | Kotlin matches SPEC, TS does not; recorded so a decision can be made rather than copying a TS bug |
| **HA behaviour** | HA itself answered differently (version quirk, demo-integration limitation); HA's own response attached |
| **Harness defect** | the assertion or authenticator is wrong; proven by ENV-06/ENV-08 style self-checks failing or a TS-vs-TS run diverging (the harness also runs **TS against TS** once per run: any diff there is by definition not Kotlin's fault, and it measures the noise floor) |
| **Environment** | container could not start, port taken, snapshot restore failed, timeout under load; includes `docker logs` |
| **Unprovable here** | needs real push service/Firebase/real model/real WebAuthn hardware/real host supervisor (§9) |

### 7.3 What the user gets after a run

Written to `backend-kt/e2e/.runs/<timestamp>/`:

1. `report.md` and `report.html`: the verdict section first (below), then per-domain tables (test ID, title, outcome, cause, one-line reason, link to evidence), then everything BLOCKED, then everything not covered.
2. `results.json`: machine-readable, one record per test (outcome, cause, both transcripts' paths, durations, retry history), so two runs can be diffed.
3. `coverage.md`: the **route and message matrix**: every route in TS's `API.md` and OpenAPI (and every WS message type) against *covered by a test / error case covered / differential identical / HA side effect verified*. Routes the Kotlin side has that TS lacks (additive) are listed separately. Un-covered routes are shown in red, not omitted.
4. `evidence/<test-id>/`: request and response transcripts, WS transcript, HA state before/after, both backends' log slices for the test's time window.
5. `environment.md`: exact versions (HA image digest, JDK, Bun), what was created, what was torn down, preflight and teardown results (including ENV-05 proof that nothing else was touched).

### 7.4 The parity verdict (gates, not a single percentage)

A percentage hides the one failed unlock rule among 400 passes. The report states each gate separately:

| Gate | Passes when |
|---|---|
| G1 Environment | all ENV checks pass |
| G2 Route coverage | every TS route and WS message type has ≥1 passing differential test and its error cases; the matrix has no red |
| G3 Contract | zero FAIL in `AUTH`, `HH`, `DEV`, `CMD`, `WS`, `AUT`, `ADM`, `X` after DIFF-ACCEPTED entries are reviewed |
| G4 Truth | every state-changing test that has an HA-visible effect has the effect verified in HA (no "assumed it worked") |
| G5 Security | all SEC-oracle tests pass (guest isolation, step-up, unlock rules, secrets never in logs, operator read-only, worker seal split) |
| G6 Capabilities | every capability in §4.0 has at least one passing capability test; none is "unproven" |
| G7 Resilience | the chaos suite shows no Kotlin-only failure |
| G8 Honesty | every BLOCKED and N/A has a reason, and §9's "unprovable here" list is printed unchanged |

"Full parity" is claimed only if G1–G8 hold. If G1–G7 hold but BLOCKED items remain, the verdict is **"parity proven for everything that could be exercised; N items unproven (listed)"**, which is the most the environment can honestly support.

## 8. Milestones

| M | Deliverable | Exit |
|---|---|---|
| M0 | Environment: parity compose project, two HA instances bootstrapped and snapshotted, preflight/teardown, port and name isolation, knob inventory (§6), key-format check | ENV-01…05 green; nothing of the user's touched |
| M1 | Harness core: http/ws clients, software passkey, normalizer, differ, transcript recorder, result model, report writers, **TS-vs-TS noise run** | ENV-06…08 green; the report renders a run end to end, including a forced FAIL and a forced BLOCKED |
| M2 | `AUTH`, `HH`, `X` capability and differential suites, plus the capability traceability table wired into the report | G3 partial; first Kotlin findings logged |
| M3 | `HA`, `DEV`, `FAV` with the inventory diff | HA-truth reader proven on reads |
| M4 | `CMD` with HA truth, idempotency, undo, restart recovery | the heart of the plan green or explained |
| M5 | `WS`, `NOTE`, `HIST` | per-person filtering and event parity |
| M6 | `AUT` with the worker, drift, offline-automation proof | HA-side behaviour verified |
| M7 | `ADM`, `AI`, updates with the fake supervisor | G5 complete |
| M8 | `CH` chaos and optional `SOAK` | G7 |
| M9 | Full run, report review, `expected-diffs.yaml` review with the user, verdict | G1–G8 evaluated and signed off (G6 is the capability gate) |

Rough effort for one engineer with the TS helpers reused: M0–M1 about 3 days, M2–M7 about 2 to 3 days each, M8 2 days, M9 1 day; about 4 weeks end to end. Findings feed back to `backend-kt` as they appear; the plan does not wait for M10 to report.

## 9. What this plan cannot prove (printed in every report, unchanged)

| Not provable | Why | What would close it |
|---|---|---|
| Push delivery to real phones/browsers; FCM; iPhone | needs real services and devices (L69, L97) | a real Firebase project and a device pass |
| The real Anthropic model path | needs an API key and costs money; only a fake provider is used (L92) | a live-provider run with a key supplied by the user |
| Real WebAuthn hardware (security keys, platform authenticators, attestation formats other than the software one's) | only the harness's software authenticator is available | a manual pass with a real passkey |
| Real update install/rollback on a host supervisor, arm64, native image, container packaging | the harness fakes the supervisor (§4.13) | a deployment-specific pass |
| Restoring a Home Assistant backup into the shared instance | restarts HA; exercised only on its own chaos instance (L81) | accepted risk, or a dedicated pass |
| Behaviour with real devices (Zigbee, Z-Wave, Matter) | the demo integration and helpers are fakes with instant, well-behaved responses (L54) | a lab with real hardware |
| Long-clock behaviour that has no knob (§6) | cannot be shortened on both stacks | add a knob, or a multi-day soak |
| Production data migration | out of scope: the Kotlin database is fresh by design (PARITY.md §7) | an importer, if production data ever exists |

**Also out of scope, by request:** any user interface, browser, gesture, layout or text-size behaviour. The frontend and its Playwright suite are not run.

## 10. Assumptions to confirm before building (defaults chosen so work is not blocked)

| # | Assumption | Default |
|---|---|---|
| A1 | The harness is Bun/TypeScript, in `backend-kt/e2e/`, and does not modify either backend | yes |
| A2 | Docker and the pinned HA image (already present locally) are usable; no new image downloads | assumed; checked in preflight |
| A3 | A real LLM key and real push services are **not** used | yes |
| A4 | The fixed ports in §2.1 are free during a run | checked in preflight, refuses to start otherwise |
| A5 | When Kotlin and TS disagree and the docs are silent, the TS behaviour is the target; a TS quirk is reported as such rather than silently copied | yes |
| A6 | Test data is synthetic only; no real household data is read | yes |
| A7 | The run is on this machine and takes about 1.5 hours for everything except soak | estimate, revised after M2 |

## 11. First actions when work starts

1. M0 preflight script and the `alice-parity` compose project (no code in either backend).
2. The knob inventory (§6), because it decides which of §4's time-dependent checks can run.
3. ENV-04 (key-format interoperability), because it decides whether the two stacks can share one key generator.
4. The TS-vs-TS noise run, to learn how much of any later diff is harness noise.
