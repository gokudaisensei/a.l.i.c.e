# ADM — backups, updates, operator API

Cards for plan §4.13 (`E2E_PARITY_PLAN.md`). Written before `scenarios/adm.ts` (RUNBOOK §6.1).

## Coverage

| Catalogue bullet (plan §4.13) | Cards |
|---|---|
| Backups: make, list, verify, corrupt detection, delete | ADM-01 |
| Backup settings, permissions, step-up | ADM-02 |
| Updates: status, signed/unsigned/tampered/wrong-key/older manifests (T7.2) | ADM-03 |
| Update settings and permissions | ADM-04 |
| Restore / download / rollback / emergency / supervisor handoff (T7.3) | **BLOCKED** — needs a host supervisor and a real restore target; M8 |
| Retention (keep N) and scheduled backups | **not covered here** — needs clock control; M8 slow tier |
| Operator API with a bearer token (T7.5) | **BLOCKED** — no API creates an operator token in the TS stack (only the in-process service does), so there is no way to mint one in this environment; F-041 |
| Admin metrics / sensitive-operation audit | covered by AUTH-13 / X cards and the M3 admin surface |

---

### E2E-ADM-01  A backup is made, verified, corrupted and deleted
- Capability: `/backups`     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `POST /backups {what:"app"}` → 200 with one `kind:"app"`, `status:"ok"`, `encrypted:true` item
  2. `GET /backups` lists it; `POST /backups/:id/verify` → `verify.status:"passed"`
  3. append bytes to the backup file → `verify.status:"failed"` with a checksum note
  4. `DELETE /backups/:id` → `{removed:true}` and the list is empty
- Error twin: step 3
- Normalize: ids, timestamps, sizes
- Both stacks: yes     Timing: normal     Pass when: the backup round-trips and a changed file is caught

### E2E-ADM-02  Backup settings are admin-only and step-up guarded
- Capability: `/backups/settings`     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `PUT /backups/settings {keep:3}` → 200 with `keep:3`
  2. `GET /backups/settings` reflects it
  3. a member and a guest get 403 on `GET /backups` and `PUT /settings`
- Error twin: step 3
- Normalize: none
- Both stacks: yes     Timing: normal     Pass when: settings round-trip and only admins may change them

### E2E-ADM-03  Only a correctly signed manifest is offered (T7.2)
- Capability: `/updates/check`     Oracle: TS, SEC
- Needs: HA-connected household world, `keys.env`
- Steps:
  1. write a manifest signed with the run's publisher key, version `0.2.0` → `POST /updates/check` → `state:"ready"`, `available.signed:true`
  2. write the same manifest without a signature → the check reports an error and stays `up_to_date`
  3. write a signed manifest, then change its version → the check rejects it (tampered)
  4. sign with a different Ed25519 key → the check rejects it
  5. write an older signed version (`0.0.1`) → `up_to_date`
- Error twin: steps 2–4
- Normalize: timestamps
- Both stacks: yes     Timing: normal     Pass when: only the valid, correctly signed, newer manifest becomes available

### E2E-ADM-04  Update settings and visibility follow the admin rule
- Capability: `/updates`     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `GET /updates` → `currentVersion`, `state`, `settings.autoUpdate`
  2. `PUT /updates/settings {autoUpdate:true, windowStart:"03:00", windowEnd:"05:00"}` → reflected
  3. a member gets 403 on `GET /updates` and on check/settings
  4. `GET /api/v1/operator/homes` with no bearer token and with a bogus one → 401 (the operator surface never accepts a household session)
- Error twin: steps 3–4
- Normalize: none
- Both stacks: yes     Timing: normal     Pass when: update settings round-trip and every write is admin/step-up guarded
