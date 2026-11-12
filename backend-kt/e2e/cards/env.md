# ENV — environment sanity

**Purpose:** prove the harness and the throwaway environment before any product behaviour is
judged. A parity FAIL is only believable if these eight checks pass (plan §4.1, runbook §7).

**Owner:** harness (`backend-kt/e2e/`). These checks inspect the harness, HA and both backends;
they never assert Kotlin product behaviour.

**Run:**

```bash
cd backend-kt/e2e
bun env/up.ts                         # preflight, HA pair, bootstrap, seed, save `seeded` snapshot
bun env/stack.ts up                   # TS server/worker on 3101, Kotlin server/worker on 3102
bun run.ts --suite env                # ENV-01…08 + the six SELFTEST fixtures
bun env/down.ts                       # teardown + ENV-05 tidy proof
```

`--run-dir <path>` pins the run directory; the report and evidence land under `<run>/`.

## Coverage

| Catalogue bullet (plan §4.1) | Check | Evidence |
|---|---|---|
| Both HA instances run, same version, same seed, entity by entity | ENV-01 | `evidence/E2E-ENV-01/{config-a,config-b,states-a,states-b,state-diff}.json` |
| Both backends answer `GET /health` with the same shape | ENV-02 | `evidence/E2E-ENV-02/requests.jsonl` |
| Snapshot/restore of an HA volume returns the seeded state | ENV-03 | `evidence/E2E-ENV-03/{ha-before,ha-after,timings}.json` |
| Generated keys are accepted by both backends | ENV-04 | `evidence/E2E-ENV-04/formats.json` |
| Nothing of the user's containers/ports/data was touched | ENV-05 | `evidence/E2E-ENV-05/{baseline-before,baseline-now,diff}.json` + `tidy-*.json` from `down.ts` |
| The software passkey registers, logs in, steps up on TS | ENV-06 | `evidence/E2E-ENV-06/requests.jsonl`, `<run>/passkey.json` |
| Host, HA and both backends agree on the clock within a second | ENV-07 | `evidence/E2E-ENV-07/clocks.json` |
| A deliberately wrong expectation is reported FAIL | ENV-08 | `evidence/E2E-ENV-08/{result,self-test-results}.json` |

## Checks

### ENV-01 — both HA instances are seed-equal
Reads `/api/config` and `/api/states` from HA-A (:18123) and HA-B (:18124), then compares the
state+attributes of every entity. Volatile demo-integration fields (`access_token`,
`entity_picture`, GPS numbers, forecast `start_time`/`end_time`, `user_id`, sun geometry) and
`geo_location.*` entities are removed first; ISO timestamps and epoch-ms values are replaced with
`<ts>`. An entity present on only one side, or any remaining value difference, fails the check.
The comparison is written to `state-diff.json`, including which volatile fields were skipped.

### ENV-02 — same `/health` shape
Requires both `/health` responses to be 200 JSON with exactly `{status, uptime}`, `status === "ok"`
and a numeric `uptime`. Values may differ; the shape may not.

### ENV-03 — snapshot/restore is real
Takes a tar snapshot of both HA volumes, flips `input_boolean.test_switch`, restores both volumes,
waits for HA to answer again, and requires the entity to return to its pre-snapshot state. The
snapshot uses the pinned HA image with `--entrypoint tar` because `alpine` is absent locally
(F-004). Save and restore durations are recorded.

### ENV-04 — key interop
Proves the TS generator's envelope and what the launcher hands Kotlin:

- the TS values are `base64(PEM)`;
- one base64 decode yields RSA SPKI (public) and PKCS8 (private) DER, the forms Kotlin's
  `X509EncodedKeySpec`/`PKCS8EncodedKeySpec` accept;
- the raw TS value is **not** itself DER — this is the evidence for F-003;
- both workers report a configured key (`config-worker running`, `keyConfigured=true`);
- `/api/v1/admin/security/sensitive-operations` is mounted and guarded (401/403, never 404/500).

### ENV-05 — nothing of the user's was touched
`env/preflight.ts` records the user's containers (name+image), ports 3001/3002/3010/3012/8123,
`backend/.env.test` (existence + SHA-256), and the state of `backend/data` and `backend-kt/data`
(recursive entries, sizes, mtimes). The check re-captures and compares. `env/down.ts` repeats the
comparison after teardown and additionally proves no `alice-parity-*` container and no recorded
harness process survives (`tidy-result.json`).

### ENV-06 — the software passkey works on TS
A pure-TypeScript ES256 authenticator (`lib/passkey.ts`, `none` attestation, resident key, UV flag,
counter) registers with the setup code, logs out, logs back in with an assertion, performs a
user-verified step-up, then logs out. The credential and private key are persisted to
`<run>/passkey.json`; later runs use login mode. The counter is wall-clock seconds so a state file
that is one write behind the server cannot look like a cloned authenticator.

### ENV-07 — clocks agree
Compares host time to HA-A (`/api/template {{ utcnow().timestamp() }}`, sub-second), to the TS
`Date` header, and — because Ktor sends no `Date` (F-005) — to the Kotlin worker's
`config_worker_heartbeat.last_seen_at`, observing it advance. Tolerances: 1 s for HA and Kotlin,
2 s for the whole-second TS `Date` header.

### ENV-08 — the reporter can fail
Runs the six SELFTEST fixtures in `suites/self-test.ts` and requires the report to render PASS,
FAIL, BLOCKED, FLAKY, NA and DIFF_ACCEPTED. The forced FAIL must carry a cause; the forced BLOCKED
must carry a reason. SELFTEST items never influence the runner's exit code.

## Notes / findings

- **F-003** — TS prints `base64(PEM)`; Kotlin accepts raw PEM or `base64(DER)`, not `base64(PEM)`.
  The launcher translates (`pemEnvToPem`), ENV-04 records the raw-value failure.
- **F-004** — `alpine` is not present locally; snapshots use the pinned HA image as the tar
  provider instead of pulling a new image.
- **F-005** — Kotlin responses omit `Date`; ENV-07 uses the worker heartbeat for the Kotlin clock.
- **F-006** — `backend-kt/data/` already existed before this run (created by an earlier harness
  iteration when the Kotlin server ran with the wrong cwd). It is user-owned per R2 and is left
  untouched; ENV-05 now proves it is unchanged instead of asserting it is absent.
- Empty `backend-kt/data/` is the only file-system artefact outside `e2e/` from earlier work; this
  run created nothing there.

## Last recorded run

`backend-kt/e2e/.runs/2026-11-12T04-37-16-337Z/` — ENV-01…08 PASS, `G1 Environment MET`,
report `report.md`, tidy proof `evidence/E2E-ENV-05/tidy-result.json` PASS.
