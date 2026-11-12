# FINDINGS

One block per finding, newest last. Seeded on day one with F-001 and F-002 from the runbook §2.2,
re-verified against the source on 2026-11-12. Every FAIL/BLOCKED in a report gets an entry here,
with the cause class from runbook §8.3.

## F-001  The worker's private-key environment variable has a different name
- Found by: runbook author / T0.1 re-verification     Date: 2026-11-12     Severity: major
- Cause class: kotlin_gap
- What happened: The TypeScript worker reads `ADMIN_SEAL_PRIVATE_KEY`; the Kotlin worker reads
  `CONFIG_WORKER_PRIVATE_KEY` (or `CONFIG_WORKER_PRIVATE_KEY_FILE`). Any deployment or launcher
  written for the TS backend starts the Kotlin worker with no key (`keyConfigured=false`), so HA
  admin-token saves never become readable.
  TS source: `backend/src/core/config/env.ts` (`adminSealPrivateKey: process.env.ADMIN_SEAL_PRIVATE_KEY`).
  Kotlin source: `backend-kt/worker/src/main/kotlin/alice/worker/Main.kt:17-18`.
- Reproduce: `grep -n CONFIG_WORKER_PRIVATE_KEY backend-kt/worker/src/main/kotlin/alice/worker/Main.kt`
  versus `grep -n ADMIN_SEAL_PRIVATE_KEY backend/src/core/config/env.ts`.
- Evidence: ENV-04 reads `<run>/logs/kt-worker.log` and requires `keyConfigured=true`;
  `env/stack.ts` maps the name per backend.
- Suggested owner action: accept `ADMIN_SEAL_PRIVATE_KEY` as an alias in the Kotlin worker's config,
  or document the name change in the deployment/parity docs and have the installer map it. (Not done
  by the agent — backend changes are out of scope for this harness.)

## F-002  Kotlin ignores `BACKUP_DIR`; backups are fixed under the working directory
- Found by: runbook author / T0.1 re-verification     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: TS honours `BACKUP_DIR`; Kotlin computes the local backup folder as
  `File(System.getProperty("user.dir"), "data/backups")` and ignores `BACKUP_DIR`. A Kotlin process
  started from `backend-kt/` would write into `backend-kt/data/` (a user-owned path, R2).
  TS source: `backend/src/core/config/env.ts` (`backupDir: process.env.BACKUP_DIR`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/backups/BackupService.kt:80`.
- Reproduce: `grep -n 'data/backups' backend-kt/server/src/main/kotlin/alice/server/backups/BackupService.kt`.
- Evidence: `env/stack.ts` starts every Kotlin process with cwd `<run>/kt/`, and `env/down.ts`
  asserts `backend-kt/data` does not exist in the tidy proof.
- Suggested owner action: read `BACKUP_DIR` in the Kotlin `BackupService` and fall back to the current
  behaviour when unset. (Not done by the agent.)

## F-003  The seal key envelope printed by the TS generator is not the form Kotlin reads
- Found by: T0.9 key interop (ENV-04)     Date: 2026-11-12     Severity: major
- Cause class: kotlin_gap (accepts two forms, but not the TS generator's)
- What happened: `backend/scripts/generate-keys.ts` prints `base64(PEM)` for
  `ADMIN_SEAL_PUBLIC_KEY`, `ADMIN_SEAL_PRIVATE_KEY` and `UPDATE_SIGNING_PUBLIC_KEY`. Kotlin's
  `HaConnectionAdminService.normalizePublicKey` and the worker's `pemOrDerToB64` accept **raw PEM**
  or **base64(DER)**, but not `base64(PEM)`. Given the TS value unchanged, `Base64.decode` yields
  PEM text and `X509EncodedKeySpec`/`PKCS8EncodedKeySpec` fail, so the server answers 503
  `not_configured` on the first admin-token save and the worker cannot open sealed values.
  TS source: `backend/scripts/generate-keys.ts`, `backend/src/core/security/sealed.ts` (`pemToEnv`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/ha/HaConnectionAdminService.kt:113-118`
  and `backend-kt/worker/src/main/kotlin/alice/worker/ConfigWorker.kt:40-48`.
- Reproduce: ENV-04 writes `evidence/E2E-ENV-04/formats.json`, which shows that the raw generator
  value does not parse as SPKI DER while the decoded PEM does. `env/stack.ts` decodes the TS
  envelope to raw PEM for Kotlin (`pemEnvToPem`).
- Evidence: `backend-kt/e2e/.runs/<run>/evidence/E2E-ENV-04/formats.json`.
- Suggested owner action: make Kotlin accept `base64(PEM)` too (detect `BEGIN` after one base64
  decode), or change the key generator to print raw PEM / base64(DER). Until then every deployment
  must translate the value. (Not done by the agent — backend changes are out of scope.)

## F-004  `alpine` image is not present; snapshots use the pinned HA image instead- Found by: T0.1 environment inventory     Date: 2026-11-12     Severity: note
- Cause class: environment
- What happened: The runbook §7 T0.6 snapshot command uses `alpine` as the tar provider, but the
  `alpine` image is not present locally and R9 forbids downloading without asking. The pinned
  Home Assistant image (already present) provides `tar`, so `env/snapshot.ts` runs the same tar
  command with that image's `--entrypoint tar`. No user resource is touched.
- Reproduce: `docker image inspect alpine:latest` (fails) vs
  `docker image inspect ghcr.io/home-assistant/home-assistant:2026.10.4` (succeeds).
- Evidence: `backend-kt/e2e/.runs/<run>/snap/`.
- Suggested owner action: pre-pull `alpine` if a smaller tar provider is preferred; otherwise this
  note can be closed. (Harness works without it.)

## F-005  Kotlin responses omit the HTTP `Date` header that TS sends
- Found by: ENV-07 clock check     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_gap
- What happened: Every TS response (and every HA response) carries a `Date` header; Ktor's
  responses do not (`GET /health` and 404s alike). RFC 9110 §6.6.1 requires an origin server with
  a clock to send `Date` on 2xx/3xx responses, and clients/proxies use it for caching and skew.
  The harness therefore reads the Kotlin worker's heartbeat (`config_worker_heartbeat.last_seen_at`)
  as the server-side clock probe for ENV-07 and records the missing header in `clocks.json`.
- Reproduce: `curl -sD - -o /dev/null http://127.0.0.1:3101/health` (has `Date`) vs
  `curl -sD - -o /dev/null http://127.0.0.1:3102/health` (no `Date`).
- Evidence: `backend-kt/e2e/.runs/<run>/evidence/E2E-ENV-07/clocks.json` (`ktDateHeader: null`).
- Suggested owner action: install Ktor's `DefaultHeaders`/`CachingHeaders` (or add a `Date`
  response header) so the Kotlin wire matches TS and the HTTP spec. (Not done by the agent.)

## F-006  A pre-existing empty `backend-kt/data/` made the tidy proof fail
- Found by: T0.11 tidy proof (ENV-05)     Date: 2026-11-12     Severity: note
- Cause class: harness_defect (resolved in the harness)
- What happened: `env/down.ts` asserted that `backend-kt/data` must not exist, but that directory
  already existed before this run (mtime 2026-11-12 08:16 IST, created by an earlier harness
  iteration that started the Kotlin server from `backend-kt/`). It is user-owned per R2, so the
  harness must not remove it. The first tidy proof therefore reported FAIL with
  `unexpected /home/gokulk-con0013/projects/ha/alice/backend-kt/data`.
- Fix (harness only): `env/preflight.ts` now fingerprints `backend/data` and `backend-kt/data`
  (recursive entries, sizes, mtimes) in the ENV-05 baseline, and `env/down.ts` proves the trees are
  unchanged instead of assuming they are absent. A legacy baseline without the fingerprint falls
  back to "newest mtime must predate `baseline.capturedAt`".
- Reproduce: `bun backend-kt/e2e/env/down.ts --run-dir <run>` → `ENV-05 tidy proof: PASS`.
- Evidence: `backend-kt/e2e/.runs/<run>/evidence/E2E-ENV-05/{tidy-baseline,tidy-now,tidy-diff,tidy-result}.json`.
- Suggested owner action: none required; the directory is empty and untouched. If the repository
  owner does not want it, they can remove it outside a harness run. (The agent must not, per R2.)

## F-007  WebAuthn registration option/credential shapes differ
- Found by: E2E-AUTH-01, E2E-AUTH-11     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: Kotlin's WebAuthn registration/options responses omit fields the TS oracle emits and encode one field differently. TS includes `authenticatorSelection.requireResidentKey: true` and `hints: []`; Kotlin omits both (it does send `residentKey: "required"`). For an existing passkey in `excludeCredentials`, TS omits `transports` while Kotlin returns `transports: null`. Differential comparisons therefore report `different` on these paths.
  TS source: `backend/src/modules/authentication/auth.service.ts` (registration options via `@simplewebauthn/server`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/AuthRoutes.kt`, `backend-kt/server/src/main/kotlin/alice/server/auth/AuthService.kt`.
- Reproduce: `bun run.ts --suite differential --area AUTH --only E2E-AUTH-01,E2E-AUTH-11` and inspect `evidence/<card>/diff.json`.
- Evidence: `/tmp/opencode/m2-diff-auth/evidence/E2E-AUTH-01/diff.json`, `/tmp/opencode/m2-diff-auth/evidence/E2E-AUTH-11/diff.json`.
- Suggested owner action: emit `requireResidentKey` and `hints` in the same shape as TS and omit `transports` when empty (rather than `null`) so clients see an identical option document. (Not done by the agent.)

## F-008  Invitation create/list response shapes differ from the TS oracle
- Found by: E2E-AUTH-02, E2E-AUTH-03, E2E-HH-06, E2E-HH-07, E2E-HH-08     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: TS nests a created invitation as `{invitation:{id,role,expiresAt,guestAccessMs}, code}` and lists invitations with `householdId`, `guestAccessMs`, `createdBy`, `createdAt`, `expiresAt`, `usedBy`, `usedAt`, `revokedAt`. Kotlin returns creation flat as `{id,role,expiresAt,code}` with no `guestAccessMs`, and list entries contain only `{id,role,expiresAt,createdAt}`. The UI/oracle contract cannot read the same fields from both stacks.
  TS source: `backend/src/modules/households/household.service.ts`, `households.controller.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/households/HouseholdService.kt`, `routes/HouseholdRoutes.kt`.
- Reproduce: `bun run.ts --suite differential --area AUTH --only E2E-AUTH-02,E2E-AUTH-03` and `--area HH --only E2E-HH-06,E2E-HH-07,E2E-HH-08`.
- Evidence: `/tmp/opencode/m2-diff-auth/evidence/E2E-AUTH-02/diff.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-06/diff.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-07/diff.json`.
- Suggested owner action: return the nested `invitation` object with `guestAccessMs` on create and include the full field set on list to match the TS/API contract. (Not done by the agent.)

## F-009  Household PATCH response and validation semantics differ
- Found by: E2E-HH-02     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `PATCH /api/v1/household` on Kotlin returns extra `mode` and `role` fields (TS returns exactly `id`, `name`, `timezone`), rejects an empty body with 400 `validation_error` (TS stores/echoes and answers 200), rejects an unknown timezone with 400 `validation_error` (TS stores the string and answers 200), and accepts a name of 81 characters with 200 (TS rejects with 4xx `validation_error`).
  TS source: `backend/src/modules/households/household.service.ts`, `households.controller.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/households/HouseholdService.kt`, `routes/HouseholdRoutes.kt`.
- Reproduce: `bun run.ts --suite capability --area HH --only E2E-HH-02` and the corresponding differential card.
- Evidence: `/tmp/opencode/m2-cap-hh2/results.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-02/diff.json`.
- Suggested owner action: align the response shape (no extra keys), the empty-body behaviour, timezone validation, and the name length limit with the TS oracle, or record an approved diff if the stricter/looser choice is intentional. (Not done by the agent.)

## F-010  Profile and preferences responses/behaviour differ
- Found by: E2E-HH-09, E2E-HH-10     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `PATCH /api/v1/users/me` on Kotlin includes a `role` field that TS omits. Preferences on Kotlin omit `userId` (TS includes it) and an explicit `quietHours: null` in a PATCH does not clear quiet hours (TS clears them); the differential for `E2E-HH-10` reports the missing `userId` and the uncleared/shape-different quiet-hours handling.
  TS source: `backend/src/modules/users/user.service.ts`, `users.controller.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/users/UserService.kt`, `routes/UserRoutes.kt`.
- Reproduce: `bun run.ts --suite capability --area HH --only E2E-HH-09,E2E-HH-10` and the differential equivalents.
- Evidence: `/tmp/opencode/m2-cap-hh2/results.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-09/diff.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-10/diff.json`.
- Suggested owner action: drop `role` from the profile PATCH response, include `userId` in preferences, and honour an explicit `null` to clear `quietHours` as TS does. (Not done by the agent.)

## F-011  Revoking an invitation is not idempotent on Kotlin
- Found by: E2E-HH-08     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: Deleting the same invitation twice returns 404 `not_found` on Kotlin, while the TS oracle re-stamps `revokedAt` and answers 200 `{ok:true}`. The capability card follows the oracle; the differential comparison records the status/body difference.
  TS source: `backend/src/modules/households/household.service.ts` (`revokeInvitation`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/households/HouseholdService.kt`, `routes/HouseholdRoutes.kt`.
- Reproduce: `bun run.ts --suite differential --area HH --only E2E-HH-08`.
- Evidence: `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-08/diff.json`.
- Suggested owner action: make revoke idempotent (or deliberately align on 404 and accept the diff) so repeated deletes behave the same on both stacks. (Not done by the agent.)

## F-012  Validation, method, body-parsing and CORS preflight behaviour differ
- Found by: E2E-X-02, E2E-X-04, E2E-X-06, E2E-X-07, E2E-X-08, E2E-X-10, E2E-HH-04, E2E-HH-06     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: Several contract-level behaviours diverge: (1) a known path called with the wrong HTTP method returns 405 with no JSON envelope on Kotlin (TS returns 404 with the standard envelope); (2) schema validation failures return 400 on Kotlin (TS returns 422) and TS messages are JSON schema dumps while Kotlin uses short strings; (3) malformed JSON on a body-less route is accepted as 200 on Kotlin (TS refuses it); (4) `limit` query bounds are not enforced on Kotlin (e.g. `limit=0` returns 200) while TS treats an out-of-range limit as a validation error; (5) a denied CORS preflight answers 405 on Kotlin (TS answers 204 without granting CORS). Differential comparisons treat status/error-code differences as contract differences.
  TS source: `backend/src/core/http/*`, `backend/src/modules/*` controllers/schemas.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/*`, `backend-kt/server/src/main/kotlin/alice/server/http/*`.
- Reproduce: `bun run.ts --suite capability --area X --only E2E-X-02,E2E-X-04,E2E-X-06,E2E-X-07,E2E-X-08` and `--suite differential --area X`, plus `--area HH --only E2E-HH-04`.
- Evidence: `/tmp/opencode/m2-cap-x3/results.json` (earlier full run), `/tmp/opencode/m2-diff-x/evidence/E2E-X-02/diff.json`, `E2E-X-04/diff.json`, `E2E-X-06/diff.json`, `E2E-X-07/diff.json`, `E2E-X-08/diff.json`, `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-04/diff.json`.
- Suggested owner action: normalise method-not-allowed handling to return the standard envelope, align validation status/message conventions, reject malformed bodies consistently, enforce `limit` bounds, and answer denied preflights with 204/no grant like TS. (Not done by the agent.)

## F-013  Permissions `defaultsSwitchedOff` contents differ
- Found by: E2E-HH-11     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: The permissions/sensitive-operation response reports a different number of `defaultsSwitchedOff` entries (TS reports 0, Kotlin reports 1 for the same card state), so the normalised transcripts differ in array length. The same card also shows the F-012 validation difference: an invalid permission body gets 422 with a JSON schema dump on TS and 400 with a short (and partly internal) message on Kotlin.
  TS source: `backend/src/modules/permissions/permissions.service.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/permissions/PermissionService.kt` / related routes.
- Reproduce: `bun run.ts --suite differential --area HH --only E2E-HH-11`.
- Evidence: `/tmp/opencode/m2-diff-hh/evidence/E2E-HH-11/diff.json`.
- Suggested owner action: align the default switched-off set (and its computation) with TS so clients see the same permission defaults. (Not done by the agent.)

## F-014  Step-up expiry and sibling-session revocation are not provable in the fast tier
- Found by: E2E-AUTH-14, E2E-AUTH-15     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: Step-up expiry (5 minutes) cannot be observed on a fresh session because login/registration set `steppedUp=true`, and TS exposes no challenge/step-up/session TTL knob while Kotlin does; real-time expiry belongs to the slow tier (M8, RUNBOOK §2.3). Neither backend revokes sibling sessions on a passkey change per source inspection, and `REQUIRE_UV_AT_LOGIN` exists only in Kotlin, so there is no TS oracle for E2E-AUTH-15.
- Reproduce: inspect `backend/src/modules/authentication/auth.service.ts` and `backend-kt/server/src/main/kotlin/alice/server/auth/AuthService.kt` for TTL/knob and session-revocation behaviour.
- Evidence: capability/differential BLOCKED results for E2E-AUTH-14 and E2E-AUTH-15 in `/tmp/opencode/m2-cap-auth2/results.json`, `/tmp/opencode/m2-diff-auth/results.json`.
- Suggested owner action: add a fast-tier TTL knob on both stacks or cover expiry in M8; define and align sibling-session revocation semantics before comparing. (Out of scope for M2.)

## F-015  HA-dependent household cards deferred without a live HA connection
- Found by: E2E-HH-12, E2E-HH-13, E2E-HH-14     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: Person-to-member linking requires `person.*` entities, presence-from-HA requires a backend connected to HA-A with an external state change, and guest device visibility requires synced Things/device policies; the M2 stacks run without an HA connection or seeded entities.
- Reproduce: n/a (requires M3/M4 HA-connected stacks).
- Evidence: BLOCKED results in `/tmp/opencode/m2-cap-hh2/results.json`, `/tmp/opencode/m2-diff-hh/results.json`.
- Suggested owner action: exercise these cards in M3/M4 once both stacks are attached to the throwaway HA pair. (Deferred by plan.)

## F-016  Spec and operational hygiene checks not provable by the harness
- Found by: E2E-X-11     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: OpenAPI/`docs/API.md` coverage, the `TRUST_PROXY` header-trust rule, request-size-limit behaviour and "no secret in logs" are document/source/operational properties that cannot be asserted from a running request/response transcript in the fast tier.
- Reproduce: manual/source inspection per plan §4.14 (SEC/spec hygiene).
- Evidence: BLOCKED results for E2E-X-11 in the X capability/differential runs.
- Suggested owner action: keep as a manual checklist item or add dedicated spec/log assertions in a later milestone. (Out of scope for M2.)

## F-017  Kotlin device views never join live Home Assistant state
- Found by: E2E-DEV-01, E2E-DEV-02, E2E-DEV-03, E2E-DEV-04, E2E-DEV-05, E2E-DEV-06, E2E-DEV-07, E2E-DEV-08, E2E-DEV-09, E2E-FAV-01, E2E-FAV-02, E2E-FAV-03, E2E-FAV-04, E2E-FAV-05, E2E-FAV-06, E2E-WS-04, E2E-NOTE-01, E2E-NOTE-02, E2E-AUT-01, E2E-AUT-02, E2E-AUT-04, E2E-AI-02, E2E-INV-01     Date: 2026-11-12     Severity: critical
- Cause class: kotlin_defect
- What happened: Every entity in Kotlin's `GET /devices` (and the favorites/group device views built from it) has `availability:"unknown"` and `values:{}`, while TS reports the live state (`available`, and e.g. `{"power":true,"brightness":71,…}`). The device routes call `Presentation.presentThing(t, { null }, …)` with a constant null lookup, so the state cache that `HaRuntime` fills is never consulted. This makes every device, favorite and group transcript differ and would break the UI's live values on Kotlin.
  TS source: `backend/src/modules/devices/devices.service.ts` (`presentThing(t, { lookup: (id) => conn.cache.get(id), … })`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/DeviceRoutes.kt:129`.
- Reproduce: `bun run.ts --suite differential --area DEV --only E2E-DEV-01` with an HA-connected run dir, then read `evidence/E2E-DEV-01/diff.json`.
- Evidence: `.runs/m3-all-dev/evidence/E2E-DEV-01/diff.json` (`primary.availability: ts="available" kt="unknown"`, `values` missing); `.runs/m3-inv/inventory-diff.json`.
- Suggested owner action: pass `stateCache::get` (or an equivalent projection lookup) into `Presentation.presentThing` in `visibleDeviceViews`, as the TS service does. (Not done by the agent.)

## F-018  Kotlin emits empty `capabilities[].metadata` objects where TS omits the key
- Found by: E2E-INV-01 (T3.1 inventory diff)     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: For capabilities with no metadata Kotlin serialises `"metadata": {}`; TS omits `metadata` entirely. 75 of 109 seeded Things show this field difference. The capability is otherwise identical.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/ha/Presentation.kt` / capability JSON builder.
- Reproduce: `bun suites/inventory-diff.ts <run-dir>` after an HA sync, then read `inventory-diff.md`.
- Evidence: `.runs/m3-inv/inventory-diff.md`, `.runs/m3-inv/inventory-diff.json`.
- Suggested owner action: omit `metadata` when it is empty (or include an empty object on both sides after an explicit contract decision). (Not done by the agent.)

## F-019  Kotlin's HA connection save does not validate the target and reports a different status
- Found by: E2E-HA-02, E2E-HA-03, E2E-HA-04, E2E-CH-02     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `PUT /ha/connection` on Kotlin validates only that the string parses as a URI. A rejected token is accepted and saved (200 instead of 400 `ha_token_rejected`); `ftp://` and `http://169.254.169.254/…` are accepted (TS 400 `validation_error`); the default name is the literal "Home Assistant" instead of the HA location name ("Alice Test Home"); and the immediate reply says `status:"disconnected"`, `haVersion:null` until the runtime connects. `PUT /admin-token` also skips the credential test, so a bad admin token is sealed and answered 200 instead of 400 `ha_token_rejected`.
  TS source: `backend/src/modules/home-assistant/connection.service.ts` (`normalizeBaseUrl`, `test`, `save`, `setAdminToken`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/ha/HaConnectionAdminService.kt:53-75`.
- Reproduce: `bun run.ts --suite capability --area HA --only E2E-HA-03`.
- Evidence: `.runs/m3-all-ha/evidence/E2E-HA-03/diff.json`, `E2E-HA-04/diff.json`.
- Suggested owner action: test the operational token and the admin token before saving, apply the same URL rules as TS (http/https only, no credentials, no link-local), use the HA location name as the default, and do not persist a rejected target. (Not done by the agent.)

## F-020  HA status, resync, delete and post-delete device removal differ
- Found by: E2E-HA-01, E2E-HA-05, E2E-HA-06     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: (1) The unconfigured `GET /ha/connection` returns `{configured:false}` on TS but Kotlin serialises every optional field as `null` (`id,name,baseUrl,status,…`). (2) `POST /resync` returns `{ok,triggered}` on Kotlin instead of `{entities:<count>}`. (3) `DELETE` returns `{deleted:true}` instead of `{ok:true}`. (4) After a delete the Kotlin device list still returns the old Things until its 30-second inventory cache expires; TS drops them immediately.
  TS source: `backend/src/modules/home-assistant/connection.service.ts`, `backend/src/modules/home-assistant/sync.service.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/ha/HaConnectionAdminService.kt`, `things/ThingsService.kt`.
- Reproduce: `bun run.ts --suite all --area HA`.
- Evidence: `.runs/m3-all-ha/evidence/E2E-HA-01/diff.json`, `E2E-HA-05/diff.json`, `E2E-HA-06/diff.json`.
- Suggested owner action: align the status/resync/delete response contracts and invalidate the inventory cache when a connection is deleted. (Not done by the agent.)

## F-021  Kotlin favorites endpoints return 500 for a non-empty list
- Found by: E2E-FAV-01, E2E-FAV-02     Date: 2026-11-12     Severity: critical
- Cause class: kotlin_defect
- What happened: `PUT /favorites` and `GET /favorites` fail with HTTP 500 (`kotlinx.serialization.SerializationException: Serializer for class 'Any' is not found`) whenever the list is non-empty. `FavoritesResponse(val devices: List<alice.ha.Thing>)` serialises the internal `Thing`, which contains an `Any`-typed field; the empty list serialises fine.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/FavoriteRoutes.kt` (`FavoritesResponse`), `ha/src/main/kotlin/alice/ha/Thing.kt`.
  Evidence: `kotlin-kt-server.log` for that card shows the serialization exception.
- Reproduce: `bun run.ts --suite capability --area FAV --only E2E-FAV-01`, then read `logs/kt-server.log`.
- Evidence: `.runs/m3-all-fav/evidence/E2E-FAV-01/requests.jsonl` (500), reproduction log `/tmp/opencode/m3-fav-debug/logs/kt-server.log`.
- Suggested owner action: return the same `ThingView` presentation TS returns (not the internal `Thing`), so the response is serialisable and carries live values. (Not done by the agent.)

## F-022  Favorites validation, ordering and visibility differ
- Found by: E2E-FAV-03, E2E-FAV-04, E2E-FAV-05     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `PUT /favorites {thingIds:["thing_nope"]}` silently drops the unknown id and answers 200 (TS 404 `not_found`); more than 50 ids are truncated to 50 and answered 200 (TS schema refuses with 422 `validation_error`); an unknown-only PUT clears the caller's existing favorites; a guest can PUT an invisible device and gets 200 (TS 404); and `GET /devices?favorite=true` returns name order instead of the caller's favorite order.
  TS source: `backend/src/modules/favorites/favorites.service.ts`, `devices.service.ts` (`setFavorites`, `list`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/FavoriteRoutes.kt`.
- Reproduce: `bun run.ts --suite capability --area FAV --only E2E-FAV-04`.
- Evidence: `.runs/m3-all-fav/evidence/E2E-FAV-04/diff.json`, `E2E-FAV-05/diff.json`, `E2E-FAV-03/diff.json`.
- Suggested owner action: refuse unknown/invisible ids instead of dropping them, enforce the 50-item limit as a validation error, leave favorites untouched on a failed request, and preserve favorite order. (Not done by the agent.)

## F-023  Hidden devices and the settings response differ
- Found by: E2E-DEV-07, E2E-DEV-08     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `GET /devices` on Kotlin returns hidden Things to an admin even without `includeHidden=true`; TS excludes them unless asked. `PATCH /devices/:id/settings` returns a flat `{entityId,powerLimitW,leftOpenAfterMs,voiceExposed,voiceSync}` document on Kotlin, while TS returns the whole device view with a nested `settings` object, so the save response contracts differ.
  TS source: `backend/src/modules/devices/devices.service.ts` (`list`, `updateSettings`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/DeviceRoutes.kt` (`visibleDeviceViews`, `patch("/{id}/settings")`).
- Reproduce: `bun run.ts --suite all --area DEV --only E2E-DEV-07,E2E-DEV-08`.
- Evidence: `.runs/m3-all-dev/evidence/E2E-DEV-07/diff.json`, `E2E-DEV-08/diff.json`.
- Suggested owner action: hide hidden Things from admins unless `includeHidden=true` and return the device view from the settings PATCH like TS. (Not done by the agent.)

## F-024  Areas are returned in registry order, not name order
- Found by: E2E-DEV-04     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: `GET /areas` sorts by name on TS; Kotlin returns the Home Assistant registry order, so the first area differs (`arjun_s_room` vs `living_room`) and the whole array is a different order. The area contents and counts match.
  TS source: `backend/src/modules/devices/devices.service.ts` (`areas` sorts by `name.localeCompare`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/DeviceRoutes.kt` (`get("/api/v1/areas")`).
- Reproduce: `bun run.ts --suite differential --area DEV --only E2E-DEV-04`.
- Evidence: `.runs/m3-all-dev/evidence/E2E-DEV-04/diff.json`.
- Suggested owner action: sort areas by name like TS. (Not done by the agent.)

## F-025  M3 capability cards deferred (HA mutations, merge/split, group commands)
- Found by: coverage tables in `cards/ha.md`, `cards/dev.md`, `cards/fav.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: Several plan bullets need state or machinery the M3 fast tier does not have: HA-side rename/area move and entity add/remove would mutate the shared seed for every later card; merge/split/unmerge and group commands need the command lifecycle and HA truth (M4 CMD); HA reconnect/backoff and token revocation are chaos-suite work (M8); drift detection needs the config-worker (M6/M7). The coverage tables mark each as uncovered with that reason, and T3.1 compares the full seeded inventory.
- Reproduce: n/a (scope decision recorded in the cards).
- Evidence: `cards/ha.md`, `cards/dev.md`, `cards/fav.md`.
- Suggested owner action: cover them in the milestone named above. (Deferred by plan.)

## F-026  Kotlin command responses crash on string/nested state values
- Found by: E2E-CMD-02, E2E-CMD-03, E2E-CMD-09, E2E-CMD-12, E2E-CMD-13     Date: 2026-11-12     Severity: critical
- Cause class: kotlin_defect
- What happened: `toPublicCommand` maps `requestedState`/`actualState` with `mapToJsonElement`, which does `Json.parseToJsonElement(v.toString())` for every value. A string value (`"locked"`, `"heat_cool"`, `"open"`) becomes the unquoted token `locked`, and a nested map/list (`color:{rgb:[…]}`) becomes Kotlin's `{rgb=[…]}` text. Both throw `JsonDecodingException`, so `POST /devices/:id/commands` and `GET /commands/:id` answer **500 `internal_error`** for brightness/color/climate/cover/lock/fan and group commands. Power-only devices (switch/media) serialize because every value is a boolean.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/commands/Expectations.kt:157-180` (`mapToJsonElement`, `toPublicCommand`).
- Reproduce: `bun run.ts --suite capability --area CMD --only E2E-CMD-02`, then read `logs/kt-server.log` for `SerializationException`/`JsonDecodingException` on the command route.
- Evidence: `/tmp/opencode/m4-smoke/logs/kt-server.log` (`JSON input: {rgb=[255, 127, 125]}`, stack at `ExpectationsKt.mapToJsonElement`); `.runs/m4-all-cmd/evidence/E2E-CMD-02/result.json`.
- Suggested owner action: convert values properly (JsonPrimitive for strings/booleans/numbers, buildJsonObject/buildJsonArray for maps/lists) instead of stringifying and re-parsing. (Not done by the agent.)

## F-027  Kotlin runs commands synchronously and omits the 202/idempotent-replay contract
- Found by: E2E-CMD-01, E2E-CMD-04, E2E-CMD-05, E2E-CMD-06, E2E-CMD-07, E2E-CMD-08, E2E-CMD-10, E2E-CMD-11, E2E-CMD-13     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: TS `POST /devices/:id/commands` answers **202** with the `pending` command and returns immediately; Kotlin's `CommandExecutor.execute` runs the whole lifecycle (including waiting up to 5 s for confirmation) before answering **200** with a terminal command. Kotlin also never sets the `Idempotent-Replay: true` header on a replayed idempotent request (TS does), even though it returns the same command id. Clients that rely on 202/pending or the replay header see a different protocol.
  TS source: `backend/src/modules/devices/devices.controller.ts` (`ctx.set.status = 202`, `idempotent-replay`), `commands/command-executor.ts` (`submit`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/DeviceRoutes.kt:289-317`, `commands/CommandExecutor.kt:62-240`.
- Reproduce: `bun run.ts --suite all --area CMD --only E2E-CMD-01,E2E-CMD-10`.
- Evidence: `.runs/m4-all-cmd/evidence/E2E-CMD-01/diff.json`, `E2E-CMD-10/diff.json`.
- Suggested owner action: dispatch asynchronously and answer 202 with the pending command; add the replay header. (Not done by the agent.)

## F-028  Kotlin undo returns the original command and generic errors
- Found by: E2E-CMD-11     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `POST /commands/:id/undo` on Kotlin runs the inverse command but returns `store.get(id)` — the **original** command (`action:"turn_off"`, `undoOf:null`) instead of the new inverse (`action:"turn_on"`, `undoOf:<original>`). A second undo and an undo-of-an-undo answer 400 `validation_error` ("Cannot undo") instead of `already_undone`/`not_undoable`, and a member undoing an admin's command gets 403 instead of the oracle's 404.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/commands/CommandExecutor.kt:254-271`, `routes/DeviceRoutes.kt:381-392`.
  TS source: `backend/src/modules/devices/commands/command-executor.ts` (undo returns the inverse), `undo.ts` error codes.
- Reproduce: `bun run.ts --suite capability --area CMD --only E2E-CMD-11`.
- Evidence: `.runs/m4-all-cmd/evidence/E2E-CMD-11/result.json` (`action:"turn_off"`, `undoOf:null`, `validation_error`).
- Suggested owner action: return the inverse command and map the refusal reasons to the documented codes; treat another person's command as not-found. (Not done by the agent.)

## F-029  M4 deferred checks (T4.1 restart recovery, timeout/unavailable paths, T4.2 call count)
- Found by: coverage table in `cards/cmd.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: T4.1 (kill -9 between `sent` and `confirmed`) is not implemented for this run. The Kotlin command call is synchronous, so the kill window sits inside the HTTP request and needs a stack restarted against the 3193 latency proxy plus a kill/restart sequence; that is a follow-up task. The unavailable-device/timeout/late-confirmation paths need a device HA never confirms (same proxy work). T4.2's Home Assistant service-call count was implemented (`lib/ha-events.ts`) but the brightness burst could not finish on Kotlin because of F-026; the final-state/ordering assertions are also blocked by the same defect. Command-event filtering (sender/admins only) is the M5 WS card.
- Reproduce: n/a (scope/blocker note).
- Evidence: `cards/cmd.md` coverage table, `PROGRESS.md`.
- Suggested owner action: fix F-026 first, then enable the T4.1/T4.2 scripts. (Deferred.)

## F-030  Kotlin accepts an unauthenticated WebSocket upgrade and closes it afterwards
- Found by: E2E-WS-01     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: A `GET /ws` upgrade with no session cookie gets **HTTP 401** from TS (no socket); Kotlin completes the upgrade (`101`) and only then closes with `4401 Unauthenticated`. A client that inspects the upgrade status sees a different protocol and briefly holds an unauthenticated socket.
  TS source: `backend/src/realtime/ws.controller.ts` (`beforeHandle` refuses the upgrade).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/RealtimeRoutes.kt` (auth check inside `webSocket { }`).
- Reproduce: `bun run.ts --suite capability --area WS --only E2E-WS-01`.
- Evidence: `.runs/m5-all-ws/evidence/E2E-WS-01/result.json` (`actual: 101`).
- Suggested owner action: authenticate in a Ktor `intercept`/route guard before the upgrade, and answer 401. (Not done by the agent.)

## F-031  Kotlin's WebSocket message grammar differs (hello key and command lifecycle)
- Found by: E2E-WS-02, E2E-WS-03     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: `hello` carries an extra `protocolVersion` key that TS/API.md do not define. More importantly, a command produces only `command.confirmed` on Kotlin, while TS sends `command.created`, `command.authorized`, `command.dispatched`, `command.accepted` and `command.confirmed`. A client that renders progress from the lifecycle sees a command jump straight to confirmed.
  TS source: `backend/src/realtime/hub.ts` (`onCommand` for every `command.*` event).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/realtime/RealtimeHub.kt` (`onCommandGeneric` / event publishing), `commands/CommandExecutor.kt`.
- Reproduce: `bun run.ts --suite capability --area WS --only E2E-WS-03`.
- Evidence: `.runs/m5-all-ws/evidence/E2E-WS-03/diff.json` (Kotlin transcript has only `command.confirmed`).
- Suggested owner action: publish every lifecycle transition and drop the undocumented `protocolVersion` (or document it first). (Not done by the agent.)

## F-032  Kotlin replays an entity snapshot on subscribe
- Found by: E2E-WS-05     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: After a reconnect and `subscribe devices`, Kotlin immediately sends `entity.updated` for entities (`input_boolean.test_switch`, `binary_sensor.test_door`) that did not change on that socket. TS sends nothing (no replay by design; clients refetch over REST). This can resurrect stale values or duplicate handler work in a client that expects events to mean "something changed now".
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/realtime/RealtimeHub.kt` (`handleSubscription`/initial cache push).
- Reproduce: `bun run.ts --suite capability --area WS --only E2E-WS-05`.
- Evidence: `.runs/m5-all-ws/evidence/E2E-WS-05/diff.json` (Kotlin transcript has two extra `entity.updated` frames).
- Suggested owner action: do not emit state on subscribe; let clients refetch, as the protocol says. (Not done by the agent.)

## F-033  Kotlin energy has no meters and no live total
- Found by: E2E-HIST-01, E2E-HIST-02     Date: 2026-11-12     Severity: critical
- Cause class: kotlin_defect
- What happened: With the three template power sensors driven to 1000/500/250 W, TS reports `nowWatts >= 1500` and `monitoredDevices: 6`; Kotlin reports `nowWatts: 0` and `monitoredDevices: 0`, and `GET /energy/devices` has no rows. Kotlin's meter discovery (which builds `Meter` rows from the device view) sees nothing, so every energy figure is empty. F-017 (empty live values) may contribute, but the zero meter count points at the energy wiring itself.
  TS source: `backend/src/modules/energy/energy.service.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/energy/EnergyService.kt` (`meters`, `summary`, `deviceList`).
- Reproduce: drive `input_number.parity_kettle_power`/`…tv_power`, then `GET /api/v1/energy/summary` on Kotlin.
- Evidence: `.runs/m5-all-hist/evidence/E2E-HIST-01/result.json`, `E2E-HIST-02/result.json`.
- Suggested owner action: wire the device view's sensors/values into the Kotlin meter discovery (after F-017) and verify against the same HA readings. (Not done by the agent.)

## F-034  Kotlin history ignores the `maxPoints` bounds
- Found by: E2E-HIST-03     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: `GET /history/devices/:id?maxPoints=5` is rejected by the TS schema with 422 `validation_error`; Kotlin parses the number and answers 200. The documented minimum is 10 and maximum 1000.
  TS source: `backend/src/modules/history/history.controller.ts` (`t.Numeric({ minimum: 10, maximum: 1000 })`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/HistoryRoutes.kt` (`q["maxPoints"]?.toIntOrNull()`).
- Reproduce: `bun run.ts --suite capability --area HIST --only E2E-HIST-03`.
- Evidence: `.runs/m5-all-hist/evidence/E2E-HIST-03/result.json` (`actual: 200`).
- Suggested owner action: validate the range and answer 422 like TS. (Not done by the agent.)

## F-035  Push code/shape differences and the fake push endpoint cannot be exercised
- Found by: E2E-NOTE-03     Date: 2026-11-12     Severity: major (delivery: note)
- Cause class: kotlin_defect (+ unprovable_here for delivery)
- What happened: With no FCM provider configured, TS answers `409 push_not_configured`; Kotlin answers `409 conflict`. Kotlin also serialises `lastUsedAt: null` where TS omits the key. The plan's T5.2 (deliver a push to the harness-owned fake endpoint on `:3191`) cannot run against the real stacks: both backends allow-list real push-service hosts (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`), so `http://127.0.0.1:3191` is refused by design. No test push is sent and no external service is contacted.
  TS source: `backend/src/modules/notifications/push/push.service.ts` (`WEBPUSH_HOSTS`, `push_not_configured`).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/UserRoutes.kt`, push service.
- Reproduce: `bun run.ts --suite capability --area NOTE --only E2E-NOTE-03`; try registering `http://127.0.0.1:3191/push` and observe `validation_error`.
- Evidence: `.runs/m5-all-note/evidence/E2E-NOTE-03/diff.json`.
- Suggested owner action: align the error code/optional field; for T5.2 either add an explicit harness-only provider override or keep delivery unprovable in this environment (recommended). (Not done by the agent.)

## F-036  M5 deferred checks
- Found by: coverage tables in `cards/ws.md`, `cards/note.md`, `cards/hist.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: Backpressure (1 MB queue, 1013), idle timeouts, 10-connection cap, hub restart/shutdown close (1001), left-open 10-minute alerts, quiet-hours/urgent push, 410 forgotten devices, runaway-sender cap, HA recorder attribute history and large-range/gap handling all need chaos/soak, a real push provider, or a controlled recorder. They are listed as BLOCKED with those reasons in the coverage tables.
- Reproduce: n/a (scope note).
- Evidence: `cards/ws.md`, `cards/note.md`, `cards/hist.md`.
- Suggested owner action: cover in M8 or with a fake-provider mode. (Deferred.)

## F-037  Kotlin automation documents, summaries and validation differ
- Found by: E2E-AUT-04     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: The automation view uses `haAutomation.syncStatus`/`syncError` where TS uses `status`/`error`/`syncedAt`/`entityId`, so a client cannot read the sync state the same way. The plain-language summary differs too: TS says "When it is 10:30 pm, turn off TV and console.", Kotlin says "When it is 22:30, turn off switch.decorative_lights." (12-hour clock and device name vs entity id). TS also sends `haConfig.condition: []` and a slightly different warning sentence, and an unknown device in an automation answers `unknown_entity` on TS but `not_found` on Kotlin.
  TS source: `backend/src/modules/automations/automations.service.ts`, `compile.ts`, `definition.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/automations/` and `routes/AutomationRoutes.kt`.
- Reproduce: `bun run.ts --suite all --area AUT --only E2E-AUT-04`.
- Evidence: `.runs/m6-all-aut/evidence/E2E-AUT-04/diff.json`.
- Suggested owner action: align the `haAutomation` field names, use the device name and the household's 12/24-hour convention in the summary, include `haConfig.condition`, and map unknown entities to `unknown_entity`. (Not done by the agent.)

## F-038  Kotlin scene actions carry empty parameters and mode actors lose their display name
- Found by: E2E-AUT-01, E2E-AUT-03     Date: 2026-11-12     Severity: minor
- Cause class: kotlin_defect
- What happened: Every scene action on Kotlin serialises `parameters:{}` where TS omits the key when there are none, so the stored/scene-read documents are not byte-comparable. The household-mode response also sets `changedBy.displayName` to the user id on Kotlin; TS returns the person's display name.
  TS source: `backend/src/modules/scenes/scenes.service.ts`, `backend/src/modules/household-modes/modes.service.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/scenes/`, `modes/ModesService.kt`, `routes/ModeRoutes.kt`.
- Reproduce: `bun run.ts --suite differential --area AUT --only E2E-AUT-01,E2E-AUT-03`.
- Evidence: `.runs/m6-all-aut/evidence/E2E-AUT-01/diff.json`, `E2E-AUT-03/diff.json`.
- Suggested owner action: omit empty `parameters` and resolve `changedBy` to the member's display name. (Not done by the agent.)

## F-039  T6.2 drift and T6.3 offline automation are deferred
- Found by: coverage table in `cards/aut.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: T6.1 ran and both stacks produced the same Home Assistant end state for the same scene (`.runs/m6-t61/aut-t61.md`: two commands each, both switches off). T6.2 (edit an Alice-created script in HA, then `POST /admin/config-sync/verify`) and T6.3 (stop the server, trigger the automation in HA, assert the effect) need an admin token + config-worker apply and a deliberate server stop; they are deferred to the M6 follow-up/M8 rather than claimed as passing.
  TS/Kotlin source: `backend/src/modules/automations/`, `backend-kt/server/src/main/kotlin/alice/server/sync/`, `routes/ConfigSyncRoutes.kt`.
- Reproduce: n/a (scope note); T6.1 evidence is `.runs/m6-t61/`.
- Evidence: `cards/aut.md` coverage table, `.runs/m6-t61/aut-t61.md`.
- Suggested owner action: add the worker-apply setup and the direct HA edit in a follow-up. (Deferred.)

## F-040  Kotlin Ask Alice proposes a device to a guest
- Found by: E2E-AI-01     Date: 2026-11-12     Severity: major (security)
- Cause class: kotlin_defect
- What happened: TS `POST /ai/interpret` returns `[]` for a guest asking "turn off the floor lamp" (they cannot see the device). Kotlin returns one proposal for it, so a guest is told about a device they may not see and could try to run the plan.
  TS source: `backend/src/modules/ai/assistant.service.ts` / `assistant.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/ai/AskAliceService.kt`.
- Reproduce: `bun run.ts --suite capability --area AI --only E2E-AI-01`.
- Evidence: `.runs/m7-all-ai/evidence/E2E-AI-01/result.json` (`actual: 1`).
- Suggested owner action: filter proposals through the same per-caller visibility check the device list uses. (Not done by the agent.)

## F-041  Kotlin backup responses use a different envelope and stringify nulls
- Found by: E2E-ADM-01, E2E-ADM-02     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: TS `POST /backups` returns `{items:[backup]}`, Kotlin returns the backup object directly, so a client that reads `items` finds nothing (and the card's verify then targets `undefined`). Kotlin also serialises absent `nasPath`/`lastScheduledDay` as the **string** `"null"` in the backup settings, where TS sends JSON `null`.
  TS source: `backend/src/modules/backups/controller.ts`, `backup.service.ts`.
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/BackupRoutes.kt`.
- Reproduce: `bun run.ts --suite all --area ADM --only E2E-ADM-01,E2E-ADM-02`.
- Evidence: `.runs/m7-all-adm/evidence/E2E-ADM-01/requests.jsonl`, `E2E-ADM-02/diff.json`.
- Suggested owner action: return the `{items}` envelope and encode optional strings as JSON null (or omit them). (Not done by the agent.)

## F-042  The AI model path is not provable here
- Found by: coverage table in `cards/ai.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: T7.1 needs a fake Anthropic provider, but the TS interpreter takes only `AI_API_KEY`/`AI_MODEL` and has no provider base-URL override, so requests would go to the real API. There is also no TS `/ai/settings` route (it exists only in the Kotlin inventory), so the settings card has no oracle. The rules-first proposals are covered by AI-01/AI-02.
  TS source: `backend/src/core/config/env.ts`, `src/services.ts` (`new AnthropicInterpreter(env.aiApiKey, env.aiModel)`).
- Reproduce: `grep -n "aiApiKey\|aiModel" backend/src/core/config/env.ts` (no base URL).
- Evidence: `cards/ai.md` coverage table.
- Suggested owner action: add a provider base-URL override if the model path should be testable offline. (Deferred.)

## F-043  Operator tokens and the supervisor handoff cannot be exercised here
- Found by: E2E-ADM-04, coverage table in `cards/adm.md`     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: T7.5 needs an operator bearer token, but no TS API mints one (only the in-process `operators.create` does), so only the 401 paths are testable. T7.3 needs a host supervisor to consume `update-requested.json`; the harness has no supervisor. The signed-manifest matrix (T7.2) passed on both stacks (ADM-03 differential identical).
  TS source: `backend/src/modules/administration/operator.service.ts`, `updates/sources.ts` (`MarkerFileInstaller`).
- Reproduce: `grep -rn "operators.create" backend/src` (test-only).
- Evidence: `.runs/m7-all-adm/evidence/E2E-ADM-04/result.json`, `cards/adm.md`.
- Suggested owner action: add an operator bootstrap path for a test environment, or keep these as manual/chaos checks. (Deferred.)

## F-044  Kotlin returns 500 when a command is sent while Home Assistant is frozen
- Found by: E2E-CH-01     Date: 2026-11-12     Severity: major
- Cause class: kotlin_defect
- What happened: With `alice-parity-ha-b` paused (TCP open, process frozen), TS accepts the switch command and leaves it `dispatched` until HA returns; after unpause it resolves and a fresh command confirms. Kotlin's synchronous `POST /devices/:id/commands` answers **500** during the freeze, so the client sees a server error rather than a command that will settle. The server itself stays up in both cases.
  TS source: `backend/src/modules/devices/commands/command-executor.ts` (`submit` is asynchronous).
  Kotlin source: `backend-kt/server/src/main/kotlin/alice/server/routes/DeviceRoutes.kt:289`, `commands/CommandExecutor.kt` (synchronous `execute`).
- Reproduce: pause `alice-parity-ha-b`, then `POST /api/v1/devices/<switch>/commands {action:"turn_off"}`.
- Evidence: `.runs/m8-all-ch/evidence/E2E-CH-01/result.json` (`actual: 500`).
- Suggested owner action: dispatch asynchronously and keep the command pending/dispatched until HA returns (F-027 is the same root cause). (Not done by the agent.)

## F-045  A 5 s TCP latency proxy cannot be used for connection setup
- Found by: E2E-CH-03     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: The harness latency proxy delays every TCP chunk, including the Home Assistant WebSocket handshake. At 5 s per chunk the connection test times out ("Could not reach Home Assistant"), so the stack never connects through the proxy and the command-timeout case cannot run. A protocol-aware delay (delay only service calls) or a product-side latency knob is needed. The card is recorded BLOCKED/harness, not PASS.
  Harness source: `backend-kt/e2e/env/fake-services.ts` (`startLatencyProxy`).
- Reproduce: `bun run.ts --suite all --area CH --only E2E-CH-03`.
- Evidence: `.runs/m8-all-ch/evidence/E2E-CH-03/result.json`.
- Suggested owner action: add a service-call-only delay to the proxy for M8 follow-up. (Not done by the agent.)

## F-046  Remaining M8 chaos, load, slow-tier and soak checks are deferred
- Found by: E2E-CH-04, E2E-CH-05, E2E-CH-06, E2E-CH-07, E2E-CH-08, E2E-CH-09     Date: 2026-11-12     Severity: note
- Cause class: unprovable_here
- What happened: Token revocation needs the HA long-lived token id (websocket admin call) the harness does not have; worker kill/config-job recovery depends on the deferred T6.2/T6.3 worker apply; disk-full needs sudo/loop mounting (R9); 200 WS clients need 20 accounts (the cap is 10 per user) and rapid-command load is covered by T4.2; the 10-minute undo/left-open windows and hour-scale session TTL are not shortened on both stacks; and a 2-hour soak needs explicit user approval. Each card carries its own reason and is BLOCKED, never PASS.
- Reproduce: `bun run.ts --suite all --area CH`.
- Evidence: `.runs/m8-all-ch/results.json`.
- Suggested owner action: cover these in a dedicated chaos environment or with product-side test knobs. (Deferred.)
