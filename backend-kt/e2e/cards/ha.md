# HA — Home Assistant connection and sync

Cards for plan §4.4 (`E2E_PARITY_PLAN.md`). Written before `scenarios/ha.ts` (RUNBOOK §6.1).
Oracle: HA + TS. Every card that needs a connection uses the throwaway `alice-parity-ha-a` instance
through `<run>/ha-a.env`; neither backend reads HA directly in the harness.

## Coverage

| Catalogue bullet (plan §4.4) | Cards |
|---|---|
| `PUT /ha/connection` with a good target | HA-02 |
| Wrong token / wrong URL / unsafe target | HA-03 |
| `GET /ha/connection` status; unconfigured install | HA-01 |
| Non-admin cannot manage the connection | HA-01 |
| Admin-token storage through the worker (seal round trip) | HA-04 |
| Resync and discovery count | HA-05 |
| Discovery of seeded entities into the same Things (count, names, areas, primaries, capabilities) | HA-05 + **T3.1 inventory diff** (`.runs/m3-*/inventory-diff.md`) |
| Entity rename / area move in HA reflected after sync | **not covered here** — mutating the shared seed would disturb every later card; T3.1 compares the seeded inventory and the mutation cases run in M3 follow-up |
| Entity removed in HA / new entity added after first sync | **not covered here** — same shared-seed reason; the incremental rebuild is exercised by `POST …/resync` in HA-05 |
| HA reconnect with backoff after a restart | **BLOCKED** — chaos suite (M8) |
| Token revoked in HA mid-run (`status` becomes auth-failed, no crash loop) | **BLOCKED** — chaos suite (M8) |
| Merge/split/unmerge, rename/hide overrides survive resync | hide is DEV-08; merge/split in M4; resync survival is a DEV follow-up |
| Drift detection (`POST /admin/config-sync/verify`) | **BLOCKED** — needs the config-worker and an Alice-created script; M6/M7 |
| Connection delete | HA-06 |

---

### E2E-HA-01  An unconfigured install says so, and only admins may manage it
- Capability: `GET/PUT /ha/connection` (API.md), permission `ha.manage`     Oracle: TS, SEC
- Needs: household world, no HA connection
- Steps:
  1. admin `GET /api/v1/ha/connection` → 200 and exactly `{configured:false}`
  2. member `GET /api/v1/ha/connection` → 403 `forbidden`
  3. member `PUT /api/v1/ha/connection {baseUrl,token}` → 403
- Error twin: steps 2–3
- Normalize: none
- Both stacks: yes     Timing: normal     Pass when: the unconfigured body is minimal and non-admins are refused

### E2E-HA-02  Saving a good connection reports it and never echoes the token
- Capability: `PUT /ha/connection` with good credentials     Oracle: TS, HA
- Needs: household world + `<run>/ha-a.env`
- Steps:
  1. admin `PUT /api/v1/ha/connection {baseUrl:<ha-a>, token:<token>}` → 200
  2. body has `configured:true`, `status:"connected"`, `haVersion:"2026.10.4"`, `baseUrl:<ha-a>`
  3. the raw response text does not contain the token
  4. `GET /api/v1/ha/connection` → 200, `configured:true`, same base URL
- Error twin: none (HA-03)
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the connection is reported connected and the token never appears

### E2E-HA-03  Bad targets are refused without saving anything
- Capability: `PUT /ha/connection` validation     Oracle: TS, HA
- Needs: household world + `<run>/ha-a.env`
- Steps:
  1. `PUT {baseUrl:<ha-a>, token:"bad-token-1234567890"}` → 400 `ha_token_rejected`
  2. `PUT {baseUrl:"not a url", token:<good>}` → 400 `validation_error`
  3. `PUT {baseUrl:"ftp://ha.local", token:<good>}` → 400 `validation_error`
  4. `PUT {baseUrl:"http://169.254.169.254/latest", token:<good>}` → 400 `validation_error`
  5. after each, `GET /ha/connection` still `{configured:false}`
- Error twin: this is the error card
- Normalize: none
- Both stacks: yes     Timing: normal     Pass when: every bad target is refused and nothing is saved
- Known caveat: Kotlin's `putConnection` validates only the URI and does not test the token, so it may store a bad target; the differential suite records the status/body difference.

### E2E-HA-04  The admin token is stored sealed and reported as set
- Capability: `PUT /ha/connection/admin-token`     Oracle: TS, HA, SEC
- Needs: household world + `<run>/ha-a.env`
- Steps:
  1. save a good connection, wait until `status:"connected"`
  2. admin `PUT /api/v1/ha/connection/admin-token {token:<good>}` → 200 `{ok:true}`
  3. `GET /ha/connection` → `adminTokenSet:true`
  4. `PUT …/admin-token {token:"bad-admin-token-1234567890"}` → 400 `ha_token_rejected`
   5. member `PUT …/admin-token {token:<good>}` → 403
- Error twin: steps 4–5
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the token is accepted once, reported as set, and bad callers are refused
- Known caveat: Kotlin's `setAdminToken` does not test the token with HA, so step 4 may answer 200; recorded by the differential suite.

### E2E-HA-05  Resync discovers the seeded home
- Capability: `POST /ha/connection/resync`, discovery     Oracle: TS, HA
- Needs: household world + `<run>/ha-a.env`
- Steps:
  1. save a good connection and wait until at least 10 devices are visible
  2. admin `POST /api/v1/ha/connection/resync` → 200 with `entities >= 10`
  3. `GET /ha/connection` → `entities >= 10`
  4. `GET /devices` → at least 10 Things; the seeded `Floor lamp`, `Front Door` and `TV and console` appear by name (case-insensitive); each has `id`, `name`, `kind`, `primary`
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the resync reports the entity count and the seeded home is visible
- Known caveat: Kotlin's resync response is `{ok,triggered}` rather than `{entities}`; recorded by the differential suite.

### E2E-HA-06  Deleting the connection drops the devices
- Capability: `DELETE /ha/connection`     Oracle: TS, HA
- Needs: household world + `<run>/ha-a.env`
- Steps:
  1. save a good connection and wait until at least 10 devices are visible
  2. admin `DELETE /api/v1/ha/connection` → 200
  3. `GET /ha/connection` → `{configured:false}`
  4. `GET /devices` → `devices: []`
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the connection is gone and the Things are gone with it
- Known caveat: TS answers `{ok:true}` and Kotlin answers `{deleted:true}`; recorded by the differential suite.
