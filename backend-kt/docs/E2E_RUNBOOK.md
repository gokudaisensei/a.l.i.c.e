# Runbook: executing the backend end-to-end parity plan

For **any agent** (or person) executing [E2E_PARITY_PLAN.md](E2E_PARITY_PLAN.md). The plan says *what and why*; this file says *exactly how, in what order, with what commands, and how to know each step is done*. If the two disagree, stop and record it in `e2e/FINDINGS.md` (§9); do not pick silently.

Written 2026-11-12. Nothing in this file has been executed yet. Facts below are marked **[verified]** (read in the code on that date) or **[unverified]** (an assumption; the first task that depends on it must check it and update this file).

---

## 1. Rules for agents (hard rules, no exceptions)

| # | Rule |
|---|---|
| R1 | **Never modify** anything under `backend/` or `backend-kt/` outside `backend-kt/e2e/` and `backend-kt/docs/E2E_*.md`. A backend bug is a *finding*, not something to fix. |
| R2 | **Never touch the user's containers, volumes, ports or files**: containers `alice-ha`, `alice-ha-mock`, `alice-ha-demo` (and their `*-init-1`), `backend/.env.test`, `backend/data/`, `backend-kt/data/`, ports 3001, 3002, 3010, 3012, 8123. Only create and remove things named `alice-parity-*` / project `alice-parity`. |
| R3 | Do not `git commit`, `git push`, or change git state. Leave files uncommitted. |
| R4 | Never run `docker system prune`, `docker rm`/`volume rm` with wildcards, or `rm -rf` on anything not under `backend-kt/e2e/.runs/` or a `mktemp -d` directory you created. Remove containers by exact name. |
| R5 | Never put a real secret in a test. All keys, tokens and codes are generated per run into the run directory. No real household data. No real LLM, push or Firebase calls. |
| R6 | A check that did not run is **BLOCKED**, never PASS. Never edit an expected value to make a test pass. Never delete or skip a test card to improve numbers. |
| R7 | Evidence or it did not happen: every outcome other than N/A has an `evidence/<id>/` folder (§6.4). |
| R8 | One milestone at a time, in order (§7). Finish its acceptance checks, update `e2e/PROGRESS.md` (§3), then move on. |
| R9 | If a prerequisite is missing (tool absent, port taken, image missing) stop that task, record BLOCKED with the exact error, and continue with tasks that do not depend on it. Do not install system packages; ask the user. |
| R10 | Before any command that starts, stops or removes a container, print it and check it names only `alice-parity-*`. |

---

## 2. Verified facts and the first two findings

### 2.1 How each backend starts **[verified]**

| | TypeScript (oracle) | Kotlin |
|---|---|---|
| Build | none (Bun) | `cd backend-kt && ./gradlew :server:installDist :worker:installDist` |
| Server | `cd backend && bun src/index.ts` | `backend-kt/server/build/install/server/bin/server` |
| Worker | `cd backend && bun src/worker/index.ts` | `backend-kt/worker/build/install/worker/bin/worker` |
| Port env | `PORT` (default 3001) | `SERVER_PORT` or `PORT` (default 3002) |
| DB env | `DATABASE_URL` (file path) | `DATABASE_PATH` or `DATABASE_URL` |
| Health | `GET /health` | `GET /health` → `{"status":"ok","uptime":…}` |
| Java | n/a | JDK 21 on PATH (`java -version` showed 21.0.13 here); no local Gradle (wrapper) |

Common env (same names in both): `NODE_ENV`, `CORS_ORIGINS`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`, `SESSION_TTL_HOURS`, `SETUP_CODE`, `TRUST_PROXY`, `SECRETS_KEY`, `ADMIN_SEAL_PUBLIC_KEY`, `BACKUP_ENCRYPTION_KEY`, `UPDATE_MANIFEST_URL`, `UPDATE_SIGNING_PUBLIC_KEY`, `UPDATE_ALLOW_UNSIGNED`, `AI_API_KEY`, `AI_MODEL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FCM_SERVICE_ACCOUNT`. Kotlin also reads `STEP_UP_TTL_MINUTES`, `CHALLENGE_TTL_MINUTES`, `REQUIRE_UV_AT_LOGIN`, `AUTH_ATTESTATION_UNTRUSTED`, `AUTH_AAGUID_ALLOWLIST`, `AI_ENABLED`, `SMART_*`, `WEB_PUSH_HOST_ALLOWLIST`.

Keys come from `cd backend && bun scripts/generate-keys.ts`, which prints `ADMIN_SEAL_PUBLIC_KEY`, `SECRETS_KEY`, `BACKUP_ENCRYPTION_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (server), `ADMIN_SEAL_PRIVATE_KEY` (worker only), `UPDATE_SIGNING_PUBLIC_KEY`, `UPDATE_SIGNING_PRIVATE_KEY` (publisher only), as `NAME=value` lines.

### 2.2 Two differences already found while writing this runbook (record both as findings on day one)

| ID | Finding | Evidence | Consequence for the plan |
|---|---|---|---|
| **F-001** | The worker's private-key variable has a **different name**. TypeScript: `ADMIN_SEAL_PRIVATE_KEY`. Kotlin: `CONFIG_WORKER_PRIVATE_KEY` (or `CONFIG_WORKER_PRIVATE_KEY_FILE`). Any setup script or deployment written for the TS backend will start the Kotlin worker with no key. | `backend/src/core/config/env.ts` vs `backend-kt/worker/src/main/kotlin/alice/worker/Main.kt:17-18` | The stack launcher maps the name per backend. ENV-04 also checks that the **format** of the TS-generated key is accepted by the Kotlin worker; if not, that is **F-003**. |
| **F-002** | Kotlin **ignores `BACKUP_DIR`**: the local backup folder is fixed at `<working directory>/data/backups`. TS honours `BACKUP_DIR`. | `backend-kt/server/src/main/kotlin/alice/server/backups/BackupService.kt:80` | Each Kotlin process **must be started with its own working directory** (a fresh temp dir per run) so backups never land in `backend-kt/data/`. The launcher does this. |

### 2.3 Time-dependent behaviour: no environment knobs exist **[verified]**

Undo window is a constant `10 * 60_000` in TS (`undo.ts:3`); left-open is `10 * 60_000` in TS (`alerts.service.ts:17`) and `10L * 60_000L` in Kotlin (`AlertsService.kt:48`, with a per-thing `left_open_after_ms` row override). Kotlin has env overrides only for session TTL, step-up TTL and challenge TTL. **Decision (replaces plan §6 "decided during M0"):** checks that need a long clock run in a separate **slow tier** at real time (§7, M8) and are otherwise not shortened. The slow-tier checks are: undo expiry (11 min), left-open alert (11 min), support grant expiry (1 h minimum: BLOCKED unless the user opts into a 70-minute run), session TTL (short-TTL env on a dedicated extra stack, minutes), step-up TTL (env, minutes). Everything else is not time-dependent.

### 2.4 Home Assistant helpers **[verified]**

- Image `ghcr.io/home-assistant/home-assistant:2026.10.4` is already pulled.
- `backend/dev/ha/docker-compose.yml` hard-codes `container_name: alice-ha-mock` and port `127.0.0.1:${HA_PORT:-8123}`; **do not use it** (R2). Use `e2e/env/docker-compose.parity.yml` (§5.2).
- Bootstrap: `HA_URL=<url> ENV_FILE=<file> bun backend/dev/ha/bootstrap.ts` writes `HA_URL=…` and `HA_TOKEN=…` to the file. Admin login it creates: `admin` / `alice-test-only`.
- Seed: `ENV_FILE=<file> DEMO=1 bun backend/dev/ha/seed-home.ts` (reads `HA_URL`/`HA_TOKEN` from the file).

### 2.5 Still **[unverified]** (check, then edit this file)

| ID | Assumption | First checked in |
|---|---|---|
| U1 | The seal key format printed by `generate-keys.ts` is accepted by the Kotlin worker and Kotlin `HaConnectionAdminService` | T0.9 (ENV-04) |
| U2 | `BACKUP_ENCRYPTION_KEY` base64-32-byte works in Kotlin (it calls `parseKey`) | T0.9 |
| U3 | Kotlin's `/ws` path, subscription grammar and close codes equal API.md §WebSocket | M5 cards |
| U4 | Kotlin implements an OpenAPI/`/docs` endpoint | T1.6 route inventory |
| U5 | TS test helpers in `backend/src/testing/http.ts` (`Browser`) can be ported for the software passkey | T1.2 |
| U6 | Both backends accept `setupCode` for first registration the same way | M2 cards |
| U7 | `bun` version is new enough for `WebSocket` client and `bun:test` is not needed | T0.1 |

---

## 3. Progress protocol (so another agent can resume)

Maintain `backend-kt/e2e/PROGRESS.md` after **every task**. Format:

```markdown
# PROGRESS
Updated: <ISO time> by <agent id>
Current milestone: M<n>   Current task: T<n.m>

| Task | Status (todo/doing/done/blocked) | Evidence / notes |
|---|---|---|
| T0.1 | done | `bun --version` = 1.x; docker 29.1.3 |
| ... | | |

## Open findings
F-001 … (links to FINDINGS.md)
## Environment currently running
containers: alice-parity-ha-a, alice-parity-ha-b | ports: 18123, 18124 | run dir: e2e/.runs/<ts>
```

On start, an agent **reads PROGRESS.md first**, verifies the "Environment currently running" claim with `docker ps --filter name=alice-parity` and port checks, and resumes at the first task that is not `done`. Never redo a `done` task unless its "done when" check now fails.

---

## 4. Conventions

- Language: TypeScript on Bun, ESM, strict mode. Folder `backend-kt/e2e/`. No dependency on code inside `backend/src` or `backend-kt/` (copy small helpers instead; **[unverified U5]** whether `backend/src/testing/http.ts` is easier to port than to rewrite).
- Dependencies: only `bun` built-ins plus, if needed, `yaml` and `@simplewebauthn/server` (for attestation/assertion verification sanity checks only). Add them to `e2e/package.json`, never to the root `package.json`.
- IDs: area codes and numbering exactly as the plan's catalogue (`E2E-AUTH-01`…). Card file per area: `e2e/cards/<area>.md`; scenario file per area: `e2e/scenarios/<area>.ts`; one exported function per card, named after the ID with dashes as underscores.
- Time: all timestamps in reports are ISO-8601 UTC.
- Randomness: the run seed is fixed in `run.json` (`seed`), so generated names/ids are reproducible; ULID/timestamp values differ by nature and are normalized.
- Logging: harness logs to `<run>/harness.log`; each backend and HA container logs to `<run>/logs/<name>.log` (captured continuously, sliced per test by timestamp).

---

## 5. Directory layout and what each file is

```
backend-kt/e2e/
  package.json  tsconfig.json  README.md  PROGRESS.md  FINDINGS.md  expected-diffs.yaml
  env/
    docker-compose.parity.yml     two HA instances (§5.2)
    ha-parity-pack.yaml           extra HA config (persons, power sensors, door sensor, input_select)
    preflight.ts                  checks ports, names, tools; refuses on conflict (§5.3)
    up.ts  down.ts                create / remove only alice-parity-* resources
    snapshot.ts                   save/restore an HA volume (tar)
    stack.ts                      start/stop TS and Kotlin servers+workers, mapping env per backend (§5.4)
    fake-services.ts              local fake manifest server, fake push endpoint, fake LLM provider, fake supervisor
  lib/
    http.ts  ws.ts  passkey.ts  normalize.ts  diff.ts  ha-truth.ts  record.ts  ids.ts
  cards/<area>.md                 test cards (§6)
  scenarios/<area>.ts             executable cards
  suites/                         capability.ts differential.ts realtime.ts worker.ts resilience.ts slow.ts soak.ts
  report/                         model.ts classify.ts write-md.ts write-html.ts coverage.ts
  run.ts                          entry point (§5.5)
  .runs/<timestamp>/              git-ignored output (add `backend-kt/e2e/.runs/` to a `.gitignore` inside e2e/)
```

### 5.1 Ports and names (fixed)

| Resource | Value |
|---|---|
| Compose project | `alice-parity` |
| HA-A (for TS) | container `alice-parity-ha-a`, `127.0.0.1:18123` |
| HA-B (for Kotlin) | container `alice-parity-ha-b`, `127.0.0.1:18124` |
| TS server | `127.0.0.1:3101` |
| Kotlin server | `127.0.0.1:3102` |
| Extra short-TTL stacks (slow tier) | TS `3103`, Kotlin `3104` |
| Fake manifest server | `127.0.0.1:3190` |
| Fake push endpoint | `127.0.0.1:3191` |
| Fake LLM provider | `127.0.0.1:3192` |
| Fake HA latency proxy (chaos) | `127.0.0.1:3193` → HA |

### 5.2 `docker-compose.parity.yml` (content to create)

```yaml
name: alice-parity
x-ha: &ha
  image: ghcr.io/home-assistant/home-assistant:2026.10.4
  restart: "no"
  environment: { TZ: UTC }
services:
  init-a:
    <<: *ha
    entrypoint: ["sh","-c","touch /config/scripts.yaml /config/automations.yaml"]
    volumes: [ "ha-a:/config" ]
  init-b:
    <<: *ha
    entrypoint: ["sh","-c","touch /config/scripts.yaml /config/automations.yaml"]
    volumes: [ "ha-b:/config" ]
  ha-a:
    <<: *ha
    container_name: alice-parity-ha-a
    depends_on: { init-a: { condition: service_completed_successfully } }
    ports: [ "127.0.0.1:18123:8123" ]
    volumes:
      - ha-a:/config
      - ../../../backend/dev/ha/configuration.yaml:/config/configuration.yaml:ro
      - ./ha-parity-pack.yaml:/config/parity-pack.yaml:ro
  ha-b:
    <<: *ha
    container_name: alice-parity-ha-b
    depends_on: { init-b: { condition: service_completed_successfully } }
    ports: [ "127.0.0.1:18124:8123" ]
    volumes:
      - ha-b:/config
      - ../../../backend/dev/ha/configuration.yaml:/config/configuration.yaml:ro
      - ./ha-parity-pack.yaml:/config/parity-pack.yaml:ro
volumes: { ha-a: {}, ha-b: {} }
```

The parity pack must be loaded by HA, but the shared `configuration.yaml` must not be edited. **Decision:** the up script writes a *copy* of `backend/dev/ha/configuration.yaml` plus a `homeassistant: packages: parity: !include parity-pack.yaml` line into `<run>/ha-config/configuration.yaml` and mounts that copy instead of the repo file. Update the compose `volumes` accordingly (the compose file takes the path from an env var `PARITY_HA_CONFIG`).

### 5.3 Preflight (`env/preflight.ts`) — exact checks

Exit non-zero with a readable list if any fail:
1. `docker --version` works; `docker info` works.
2. `docker image inspect ghcr.io/home-assistant/home-assistant:2026.10.4` succeeds (no pull; if absent: BLOCKED, ask the user).
3. No container named `alice-parity-*` exists, **unless** `PROGRESS.md` says this run owns it.
4. Ports 18123, 18124, 3101–3104, 3190–3193 are free (`ss -ltn`); print the holder if not.
5. `java -version` major is 21 (for Kotlin); `bun --version` prints.
6. `backend-kt/server/build/install/server/bin/server` and the worker exist (else run the Gradle task in T0.7).
7. Record a **hash baseline** of the user's resources for ENV-05: `docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}'` filtered to non-parity names, `ss -ltn` for 3001/3002/3010/3012/8123, and `sha256sum backend/.env.test` (the file may or may not exist; record that).

### 5.4 Stack launcher (`env/stack.ts`) — exact behaviour

For each backend it creates `<run>/<ts|kt>/` (working directory, database, backups, logs) and starts:

**TypeScript server** (cwd `backend/`):
`PORT=3101 DATABASE_URL=<run>/ts/alice.db NODE_ENV=development LOG_LEVEL=warn WEBAUTHN_ORIGIN=http://localhost:3101 WEBAUTHN_RP_ID=localhost CORS_ORIGINS=http://localhost:3101 SETUP_CODE=<code> SECRETS_KEY=… ADMIN_SEAL_PUBLIC_KEY=… BACKUP_ENCRYPTION_KEY=… BACKUP_DIR=<run>/ts/backups VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:e2e@example.com UPDATE_MANIFEST_URL=http://127.0.0.1:3190/manifest.json UPDATE_SIGNING_PUBLIC_KEY=… bun src/index.ts`
**TS worker** (cwd `backend/`): same `DATABASE_URL`, plus `ADMIN_SEAL_PRIVATE_KEY=…` only: `bun src/worker/index.ts`.

**Kotlin server** (cwd `<run>/kt/`, **never** `backend-kt/`, because of F-002):
`SERVER_PORT=3102 DATABASE_PATH=<run>/kt/alice.db NODE_ENV=development WEBAUTHN_ORIGIN=http://localhost:3102 WEBAUTHN_RP_ID=localhost CORS_ORIGINS=http://localhost:3102 SETUP_CODE=<code> SECRETS_KEY=… ADMIN_SEAL_PUBLIC_KEY=… BACKUP_ENCRYPTION_KEY=… VAPID_… UPDATE_MANIFEST_URL=… UPDATE_SIGNING_PUBLIC_KEY=… <abs path>/backend-kt/server/build/install/server/bin/server`
**Kotlin worker** (cwd `<run>/kt/`): `DATABASE_PATH=<run>/kt/alice.db CONFIG_WORKER_PRIVATE_KEY=<value of ADMIN_SEAL_PRIVATE_KEY> CONFIG_WORKER_INTERVAL_MS=1000 <abs>/backend-kt/worker/build/install/worker/bin/worker`.

Both launchers: wait for `GET /health` 200 (timeout 60 s), write the PID to `<run>/pids`, stream stdout/stderr to `<run>/logs/<name>.log`, and on `down` send SIGTERM then SIGKILL after 10 s to **only the PIDs it recorded**. The server never receives `ADMIN_SEAL_PRIVATE_KEY` or `CONFIG_WORKER_PRIVATE_KEY` (a SEC check greps the server's `/proc/<pid>/environ`).

### 5.5 `run.ts` entry point

```
bun e2e/run.ts --suite <all|capability|differential|realtime|worker|resilience|slow|soak>
               [--only E2E-CMD-03,E2E-AUTH-*] [--area AUTH] [--keep-env] [--no-ts-noise] [--run-dir <path>]
```
Exit code: 0 only if every gate evaluated is satisfied *and* nothing is BLOCKED that the gate requires; 1 if any FAIL; 2 if only BLOCKED/UNPROVEN items prevent a verdict. Always writes the report, even when it aborts.

---

## 6. Test cards (the unit of work)

### 6.1 Rules for writing cards

1. One card = one behaviour with one verdict. If a card has two independent assertions that could fail separately, split it.
2. Every card names its **oracle(s)**: `TS`, `HA`, `SPEC` (with the doc anchor), `SEC`. A card with no oracle is invalid.
3. Every card lists exact requests (method, path, body, auth), exact expected status, and the exact expected body *fields* (not "looks right"). Values come from the SPEC or from running the TS oracle (state which).
4. Every state-changing card has an **HA truth** step (read the entity from HA directly) or states "no HA-visible effect".
5. Every card has an **error twin** when the route can fail: same route, the failing input, expected 4xx and error code.
6. Cards are written **before** their scenario code, in `cards/<area>.md`, then reviewed against the catalogue entry in the plan (every catalogue bullet must be covered by ≥1 card; list the mapping at the top of each card file).
7. IDs never get reused. A retired card stays in the file marked `RETIRED: <reason>`.

### 6.2 Card template

```markdown
### E2E-<AREA>-<nn>  <short title>
- Capability: <FEATURES.md bullet or API.md route>      Oracle: TS | HA | SPEC §… | SEC
- Needs: <preconditions, e.g. "admin signed in, HA connected, seed v1, snapshot 'seeded'">
- Steps:
  1. <METHOD /path> as <actor> body <json>  → expect <status> and <fields>
  2. HA truth: GET <ha url>/api/states/<entity> → expect state=<…>, attributes.<…>=<…>
- Error twin: <METHOD /path> body <bad> → expect <4xx> code `<code>`
- Normalize: <fields excluded from the diff, beyond the global list>
- Both stacks: yes | TS-only (why) | Kotlin-only (why)
- Timing: normal | slow-tier (<real wait>) | chaos
- Pass when: <one sentence>      Known caveat: <L-number or none>
```

### 6.3 Three fully worked cards (copy this level of detail)

```markdown
### E2E-AUTH-01  First user registers with the setup code and receives recovery codes once
- Capability: Passkey sign-in, recovery codes (FEATURES §People); API.md "Authentication" register     Oracle: SPEC, TS
- Needs: fresh stack, no users, SETUP_CODE=<run code>
- Steps:
  1. GET /api/v1/auth/setup (public) → 200 `{needsSetup:true, setupCodeRequired:true}` **[verified field names, TS]**; then POST /api/v1/auth/register/options {displayName:"Test Admin", setupCode:"<code>"} (no auth) → 200, body has `challenge` (string), `rp.id`="localhost", `user.name`
  2. Software authenticator creates a credential for that challenge (origin http://localhost:<port>)
  3. POST /api/v1/auth/register/verify {…attestation…} → 200, body has `user.role`="admin", `recoveryCodes` a non-empty array of unique strings (count taken from the TS response); Set-Cookie session (HttpOnly, SameSite=Lax)
  4. GET /api/v1/auth/session with that cookie → 200, `user.displayName`="Test Admin", `household` present
  5. POST /api/v1/auth/register/verify again with the same payload → expect 4xx (challenge consumed)
- Error twin: step 1 with setupCode "wrong" → expect 4xx code `setup_code_required` **[verified in TS `auth.service.test.ts`]**; compare Kotlin's code to it, and if it differs record DIFF, do not guess
- Normalize: user.id, household.id, challenge, recoveryCodes values, cookie value, timestamps
- Both stacks: yes     Timing: normal     Pass when: statuses, field presence and types match on both and the recovery codes are returned exactly once
```

```markdown
### E2E-CMD-02  Turning a light on through Alice really turns it on in Home Assistant
- Capability: Control that confirms itself (FEATURES §Control)     Oracle: HA, TS
- Needs: admin signed in, HA connected and synced, snapshot 'seeded', entity light.living_room_rgbww_lights is off (set via HA service before the test; assert it is off first)
- Steps:
  0. HA truth: GET /api/states/light.living_room_rgbww_lights → state="off"
  1. GET /api/v1/devices?q=Floor lamp → 200; take the Thing id and primary entity
  2. POST /api/v1/devices/<id>/commands {entityId:"light.living_room_rgbww_lights", action:"turn_on"} (optional `Idempotency-Key: <uuid>` header **[verified in API.md]**; copy the exact `action` string and `parameters` shape from the TS oracle's own light command, **[unverified]**) → 202, body.command.status in {pending,sent}
  3. Wait for WS event `command.confirmed` for that command (timeout 10 s) or poll GET /api/v1/commands/<cmd> (**[verified]** route `GET /commands/:id`) until status="confirmed"
  4. HA truth: GET /api/states/light.living_room_rgbww_lights → state="on"
  5. GET /api/v1/devices/<id> → primary value reads on
- Error twin: POST …/commands {entityId:"light.does_not_exist"} → expect 404 or 422 (use the TS status and code)
- Normalize: command ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: HA state really changed and the command reached `confirmed` with the same status codes and lifecycle events as TS
```

```markdown
### E2E-AUT-12  An automation created in Alice fires in Home Assistant while Alice is stopped
- Capability: "keeps running if Alice is offline" (FEATURES §Scenes/automations)     Oracle: HA
- Needs: admin signed in, HA connected, worker running, input_boolean.test_switch off, a target light off
- Steps:
  1. POST /api/v1/automations {name:"E2E offline", trigger:{type:"state", entity:"input_boolean.test_switch", to:"on"}, actions:[turn_on light]} → 201/200 per TS
  2. Wait until GET /api/v1/admin/config-sync shows the job applied, then HA truth: `automation.*` exists with that alias (GET /api/states, filter), and /config/automations.yaml (via HA REST config API) contains it
  3. Stop the backend (SIGTERM server AND worker)
  4. Via HA REST call service input_boolean.turn_on test_switch
  5. HA truth within 10 s: light is "on"
  6. Restart the backend; GET /api/v1/automations still lists it; no duplicate automation in HA
- Error twin: POST /api/v1/automations with an action that unlocks a door and no step-up → expect 403 (TS code)
- Both stacks: yes     Timing: normal     Pass when: the light turned on with Alice stopped and nothing was duplicated after restart
```

### 6.4 Evidence folder per card (`<run>/evidence/<id>/`)

`card.md` (the card text), `requests.jsonl` (every HTTP request/response incl. headers, one JSON per line, for each stack), `ws.jsonl` (WS messages in order with receive time), `ha-before.json`, `ha-after.json` (the entities named in the card), `diff.json` (normalized diff result), `logs-ts.txt` / `logs-kt.txt` (log lines within the test's time window), `result.json` (§8.1).

### 6.5 Authoring the full card set (M2–M7 each begin with this task)

At the start of each milestone the agent writes the cards for its areas **from the plan's catalogue and from `backend/docs/API.md`**, using the template. The plan's counts ("about 24") are targets, not limits: write as many cards as are needed so that (a) every route in §7 T1.6's inventory in the area has ≥1 card plus its error twin, and (b) every catalogue bullet is covered. Where the plan lists a scenario in prose, create its card (e.g. AUTH: "wrong origin", "challenge replay", "counter regression"). The card file starts with a coverage table: `catalogue bullet → card ids`.

---

## 7. Task list (execute in order; each task lists commands and a "done when" check)

### M0 Environment (no test code yet)

| Task | Steps | Done when |
|---|---|---|
| T0.1 Tools | `bun --version`; `java -version`; `docker --version`; `docker info`; record in PROGRESS.md. **Check U7.** | all four print versions; any failure → BLOCKED, ask user |
| T0.2 Skeleton | create the folder layout in §5 (empty files with a header comment), `e2e/package.json` (`"type":"module"`), `e2e/.gitignore` containing `.runs/` | `bun install` in `e2e/` succeeds; `bun e2e/run.ts --help` prints usage |
| T0.3 Preflight | implement `env/preflight.ts` per §5.3, including the ENV-05 baseline | running it on this machine prints PASS/FAIL per check and writes `<run>/baseline.json`; a deliberate conflict (start `nc -l 18123` in another shell, run preflight, then stop it) makes it fail and name the holder |
| T0.4 Compose + pack | write `docker-compose.parity.yml` (§5.2) and `ha-parity-pack.yaml` (3 persons: `person.parity_admin`, `person.parity_member`, `person.parity_guest`; template `binary_sensor.parity_door` driven by `input_boolean.parity_door`; `input_select.parity_mode` options Home/Away/Night/Vacation; 3 template power sensors `sensor.parity_kettle_power` etc. driven by `input_number`s) | `docker compose -p alice-parity -f e2e/env/docker-compose.parity.yml config` validates |
| T0.5 Up | `env/up.ts`: write the config copy (§5.2 decision), `docker compose -p alice-parity … up -d`, wait for `GET :18123/api/onboarding` and `:18124` to respond, then `HA_URL=http://127.0.0.1:18123 ENV_FILE=<run>/ha-a.env bun backend/dev/ha/bootstrap.ts`, same for B (`18124`, `ha-b.env`), then `ENV_FILE=<run>/ha-a.env DEMO=1 bun backend/dev/ha/seed-home.ts` and the same for B | `<run>/ha-a.env` and `ha-b.env` contain `HA_TOKEN`; both seeds exit 0 |
| T0.6 Snapshot | `env/snapshot.ts save <name>` / `restore <name>`: stop the HA container, `docker run --rm -v <vol>:/c -v <run>/snap:/o alpine tar czf /o/<name>-<a|b>.tgz -C /c .`, start again; restore does the reverse after wiping the volume contents | **ENV-03**: change an entity, restore, entity is back; time to restore recorded |
| T0.7 Build Kotlin | `cd backend-kt && ./gradlew :server:installDist :worker:installDist` | both `bin/` scripts exist; build output saved to `<run>/logs/gradle.log` |
| T0.8 Stack launcher | `env/stack.ts` per §5.4; `up`/`down` for `ts` and `kt` | **ENV-02**: both `/health` answer; `down` leaves no process (`pgrep -f` of recorded PIDs empty) and no files outside `<run>` |
| T0.9 Key interop | start the Kotlin server with the TS-generated keys; register nothing; check `GET /api/v1/admin/security` (or the route the Kotlin side uses) and the worker log line `keyConfigured=true`; then in M2 the first admin-token save proves the seal round trip | **ENV-04** PASS, or F-003 recorded with the error text |
| T0.10 Findings F-001, F-002 | write both findings (§9) | file exists with both |
| T0.11 Tidy proof | **ENV-05**: stop everything the run started; compare the baseline (names, ports, `.env.test` hash) with now | identical, written to `evidence/E2E-ENV-05/` |

**M0 acceptance:** ENV-01…05 PASS (ENV-01 = both HA at same version and entity-by-entity equal state, compared through `GET /api/states` after removing volatile attributes `last_changed`, `last_updated`, `context`).

### M1 Harness core

| Task | Steps | Done when |
|---|---|---|
| T1.1 HTTP/WS clients | `lib/http.ts`: cookie jar per actor, records every request/response to the card's `requests.jsonl`; `lib/ws.ts`: connect with the actor's cookie, send/receive with timestamps, `waitFor(type, predicate, timeout)` | a TS-only smoke script logs in a test user (after T1.2) and receives a WS message |
| T1.2 Software passkey | `lib/passkey.ts`: ES256 keypair, `none` attestation, `authenticatorData` with flags (UP, UV), counter, resident key, `clientDataJSON` with origin/challenge/type; functions `register(options)`, `assert(options, {counter?, uv?, origin?})`. Study `backend/src/testing/http.ts` first (**U5**) | **ENV-06**: register + login + step-up against the TS server succeed |
| T1.3 Normalizer | `lib/normalize.ts` implementing the table in §8.2 | unit tests (`bun test e2e/lib`) cover every rule |
| T1.4 Differ | `lib/diff.ts` producing `identical | shape-identical | different` with JSON paths | unit tests with fixtures for each kind |
| T1.5 Result + report | `report/model.ts`, writers, `coverage.ts`; classification (§8.3) | **ENV-08**: a harness self-test card with a wrong expectation is reported FAIL; one with a missing prerequisite BLOCKED; one retried flake FLAKY; report renders all five |
| T1.6 Route inventory | `report/coverage.ts` builds the inventory: TS routes from the Elysia controllers (all `*.controller.ts`; also fetch TS `GET /docs/json` if OpenAPI is exposed **U4**), Kotlin routes from the Ktor `route("…")` blocks (nested prefixes must be resolved), plus WS message types from `backend/docs/API.md` §WebSocket; writes `e2e/route-inventory.json` | file lists method, full path, owning module for both backends; routes present on only one side are listed separately; counts printed. An earlier crude scan on 2026-11-12 found 143 TS route registrations and 104 Kotlin literal registrations, **a lower bound for Kotlin because prefixes nest**: this task replaces that guess |
| T1.7 TS-vs-TS noise run | run a sample scenario set against two TS stacks (HA-A and a second throwaway TS stack on `3103` with HA-A) | any diff is recorded as harness noise; count in `report` header |

**M1 acceptance:** ENV-06…08 PASS; noise run diff is empty or fully explained.

### M2 `AUTH`, `HH`, `X`

1. Write `cards/auth.md`, `cards/hh.md`, `cards/x.md` (§6.5). 2. Implement `scenarios/*.ts`. 3. Run capability suite then differential. 4. For each FAIL/BLOCKED, classify (§8.3) and write a finding. **Acceptance:** every card has an outcome; every route in the `AUTH/HH/X` slice of the inventory is covered or listed as uncovered with a reason.

### M3 `HA`, `DEV`, `FAV`
Same procedure. Special task **T3.1 Inventory diff**: after both stacks sync their identical HA, `GET /api/v1/devices?include=diagnostics` on each; compare Thing-by-Thing (matched by primary entity id): name, area, kind, capabilities, facets, controls, sensors. Output a table of every Thing and the fields that differ. **Acceptance:** the table exists and is attached to the report even when empty.

### M4 `CMD`
Same procedure, with HA truth in every card. Special tasks: **T4.1** restart recovery (kill -9 the server between `sent` and `confirmed` using the fake latency proxy on HA to hold the command; restart; assert the command is resolved, not stuck); **T4.2** coalescing and per-entity ordering (send 50 brightness commands in 1 s; the final HA state equals the last command; count of HA service calls is recorded for both backends and compared); **T4.3** idempotency matrix.

### M5 `WS`, `NOTE`, `HIST`
Same procedure. Special: **T5.1** WS transcript differ (message `type` and payload keys, per actor role); **T5.2** fake push endpoint (`env/fake-services.ts`) receives Web Push requests: verify encryption headers and VAPID `Authorization`; **T5.3** energy numbers: drive the template power sensors via their `input_number`s and compare Alice's live power to the sum.

### M6 `AUT` (worker and HA side effects)
Same procedure. Special: **T6.1** script/automation YAML equivalence: fetch `scripts.yaml` and `automations.yaml` from each HA (HA config REST endpoints), normalize ids/aliases, then *behaviourally* compare by running the same scene on both and comparing final entity states; **T6.2** drift: edit an Alice-created script in HA, `POST /api/v1/admin/config-sync/verify`, assert it is reported; **T6.3** offline automation (E2E-AUT-12 as worked above).

### M7 `AI`, `ADM`
Same procedure. Special: **T7.1** fake LLM provider (`3192`) implementing the Anthropic Messages shape with a forced tool call; configure `AI_API_KEY=fake` and the provider base URL **[unverified U8: whether either backend lets the base URL be overridden; if not, the model path is BLOCKED with that reason and only the rules-first cases run]**; **T7.2** signed manifest server (sign with the generated `UPDATE_SIGNING_PRIVATE_KEY` via `backend/scripts/sign-manifest.ts`; produce valid, tampered, wrong-key, unsigned, expired, newer/older versions); **T7.3** fake supervisor consumes `update-requested.json` and writes the result the backend expects (read both backends' marker contracts first; record any contract difference as a finding); **T7.4** backups: make, verify, corrupt a copy and verify fails, retention, delete with step-up; **T7.5** operator API with bearer token.

### M8 Resilience (`CH`), slow tier, optional soak
- **Chaos** (each on its own snapshot restore): `docker pause alice-parity-ha-b` 30 s then unpause; `docker restart alice-parity-ha-b`; token revoked (delete the long-lived token through HA's websocket API); latency proxy at 5 s; `kill -9` of the backend during a command, a backup, a config job; worker kill/restart; disk-full simulation by pointing the backup dir at a size-limited tmpfs created with `docker run --tmpfs` is **not** possible for host processes, so use a small loop-mounted file only if the user has pre-approved `sudo`; otherwise BLOCKED with that reason; 200 WS clients; 1,000 rapid commands.
- **Slow tier** (real time, §2.3): undo expiry, left-open alert, short-TTL session/step-up stacks.
- **Soak** (optional, ask the user first): 2 hours mixed traffic; sample RSS/threads/fds/db size every 30 s from `/proc/<pid>`.

### M9 Full run and verdict
1. `down` and `up` clean. 2. `bun e2e/run.ts --suite all`. 3. Review `expected-diffs.yaml` additions with the user (list each with reason). 4. Re-run only changed cards. 5. Produce the verdict (gates G1–G8 of the plan) in `report.md` first lines.

---

## 8. Schemas and rules the harness must implement

### 8.1 Result record (`results.json` is an array of these)

```ts
type Outcome = "PASS" | "FAIL" | "BLOCKED" | "DIFF_ACCEPTED" | "NA" | "FLAKY";
type Cause =
  | "kotlin_defect" | "kotlin_gap" | "ts_quirk" | "ha_behaviour"
  | "harness_defect" | "environment" | "unprovable_here";
interface TestResult {
  id: string;                    // "E2E-CMD-02"
  area: string;                  // "CMD"
  title: string;
  capability: string;            // FEATURES bullet or route
  oracles: ("TS" | "HA" | "SPEC" | "SEC")[];
  tier: "normal" | "slow" | "chaos" | "soak";
  stacks: { ts?: StackResult; kt?: StackResult };
  outcome: Outcome;
  cause?: Cause;                 // required for FAIL, BLOCKED, FLAKY
  reason: string;                // one sentence, plain words, says WHAT differed or WHY it could not run
  detail?: string;               // longer explanation with the diff
  attempts: { n: number; outcome: Outcome; ms: number }[];   // a FAIL is retried once
  acceptedDiff?: string;         // key into expected-diffs.yaml
  finding?: string;              // "F-007"
  evidence: string;              // relative path of the evidence folder
  startedAt: string; ms: number;
}
interface StackResult { status: "ok" | "failed" | "not_run"; assertions: { name: string; ok: boolean; expected?: unknown; actual?: unknown }[]; }
```
Outcome rules: PASS needs every stack the card applies to `ok` and (when two stacks) diff `identical` or `shape-identical`; FAIL if any assertion fails; the second attempt passing makes it FLAKY (not PASS); BLOCKED requires a `cause` of `environment`, `harness_defect` or `unprovable_here` and a `reason` that names the missing thing.

### 8.2 Normalizer rules (global; cards add their own)

| Field / pattern | Treatment |
|---|---|
| Type-prefixed ULIDs (`usr_…`, `dev_…` etc.) | replaced by `<id:prefix>`; the **prefix and length** are still compared |
| Unix-ms timestamps and ISO timestamps | replaced by `<ts>`; must be within the test's start/end window ±5 s, else FAIL |
| `uptime`, `version` in `/health` | `<number>`, `<string>`; type compared |
| Set-Cookie | compare attribute set (`HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age` within 1%); value replaced |
| Challenges, recovery codes, invitation codes, tokens, signatures | `<secret:len>` (length compared) |
| HA-internal error text | must not appear at all (SEC): any response body containing a string from HA's own error vocabulary (`Service not found`, `Entity not found`, `Unauthorized`, stack frames) is a FAIL regardless of the diff |
| Arrays | compared in order unless the card marks `unordered:<key>` |
| `null` fields | **omitted** by both backends (PARITY.md §1); presence of `null` is a FAIL |
| Everything else | compared literally |

### 8.3 Classification procedure (apply in order, stop at the first match)

1. Did `ENV-*` for this run all pass? If not → `environment`, BLOCKED.
2. Did the same card pass on **TS-vs-TS** (noise run)? If it *failed* there → `harness_defect`.
3. Does the route/feature appear as *open/not built* in `backend-kt/docs/LIMITATIONS.md` or PARITY.md, or return 404/501 on Kotlin while TS serves it? → `kotlin_gap` (cite the L-number or phase).
4. Does Kotlin match SPEC and HA but TS does not? → `ts_quirk` (write both responses; propose DIFF_ACCEPTED only with a user decision).
5. Did HA itself behave differently from its documentation (HA state unexpected before Alice acted)? → `ha_behaviour` (attach HA's response).
6. Needs real push/model/hardware/host/arm64/real devices (plan §9)? → `unprovable_here`, BLOCKED.
7. Otherwise → `kotlin_defect`, FAIL, with a minimal reproduction (the single request that shows it).

### 8.4 `expected-diffs.yaml`

```yaml
- id: D-001
  route: "GET /api/v1/home"           # method + path, or "*" for all
  field: "$.extra"                    # JSON path or "headers.x-foo"
  kind: kotlin_additive               # kotlin_additive | ts_quirk_not_copied | intended_fix
  reason: "Additive endpoint; PARITY.md §1 'Additions'"
  reference: "backend-kt/docs/PARITY.md#1"
  approvedBy: "<user>"                # REQUIRED; an agent may not self-approve
  approvedOn: "2026-.."
```
The file starts empty. An entry without `approvedBy` is ignored by the matcher.

### 8.5 Report layout (`report.md`, in this order)

1. **Verdict** table: gates G1–G8 with status (MET / NOT MET / UNPROVEN) and one sentence each.
2. Headline counts: PASS, FAIL, BLOCKED, FLAKY, DIFF_ACCEPTED, NA; noise-run diff count.
3. **Failures** grouped by cause; each row: id, title, one-line reason, finding id, evidence link.
4. **Blocked and unproven** with reasons.
5. **Capability table**: each FEATURES.md bullet, its cards, result (PROVEN / FAILED / UNPROVEN).
6. **Route and message coverage matrix** (from `route-inventory.json`): covered / error case / differential identical / HA effect verified; uncovered routes in a separate list, never dropped.
7. **Inventory diff** (T3.1) and **HA end-state diff** tables.
8. Accepted differences, with reasons and approvers.
9. "Not provable here" list from plan §9, unchanged.
10. Environment (versions, image digest, what was created/removed, ENV-05 result).

---

## 9. Findings file

`e2e/FINDINGS.md`, one block per finding, newest last:

```markdown
## F-001  <title>
- Found by: <card id or task>     Date: <ISO>     Severity: blocker | major | minor | note
- Cause class: kotlin_defect | kotlin_gap | ts_quirk | ha_behaviour | harness_defect | environment
- What happened: <expected vs actual, with the exact request/response or log line>
- Reproduce: <single command or request>
- Evidence: <path>
- Suggested owner action: <what a backend engineer would do>   (never done by the agent)
```
Seed it with F-001 and F-002 (§2.2) on day one.

---

## 10. Stop and ask the user when

- A prerequisite in R9 is missing, or a step needs `sudo`, a download, a real credential, or more than 70 minutes of wall time (support grant expiry, soak).
- A finding looks like a security issue (guest sees a device they must not; secret appears in a log; step-up bypass): finish the card, record it as `blocker`, and tell the user immediately rather than at the end.
- Two cards disagree about the TS oracle's behaviour (the oracle is not deterministic): record, do not guess.
- A run would touch anything in R2.

## 11. Definition of done for the whole effort

All of: milestones M0–M9 complete in `PROGRESS.md`; `route-inventory.json` and `coverage.md` present with no route silently missing; every capability in plan §4.0 shows PROVEN, FAILED or UNPROVEN with a reason; `FINDINGS.md` lists every FAIL/BLOCKED with a cause; the final `report.md` verdict is written using only the gate wording in plan §7.4; `down` has run and ENV-05 shows the user's setup unchanged.
