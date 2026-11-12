# AUT — scenes, routines, automations, modes

Cards for plan §4.9 (`E2E_PARITY_PLAN.md`). Written before `scenarios/aut.ts` (RUNBOOK §6.1).
Cards use switch-only actions for scene/routine activation: boolean states serialize on both stacks
(F-026 still blocks light/fan/climate command responses on Kotlin).

## Coverage

| Catalogue bullet (plan §4.9) | Cards |
|---|---|
| Scenes: create, read, edit, delete, run from Alice; HA effect | AUT-01 |
| Scene with a device that later disappears | **not covered here** — the resync/disappear path is HA mutation work; M6 follow-up |
| Routines: ordered steps, progress, run history; mode step | AUT-02 |
| Routine delay/stop/cancel mid-run and a failing step | **BLOCKED** — controlled waits/clock are not exposed on the real stacks; M8 slow tier |
| Automations: plain-language summary, dry-run preview, save, enable/disable, validation | AUT-04 |
| Automation exists in HA and fires with Alice offline (T6.3) | **BLOCKED** — needs the config-worker apply plus a server stop; recorded as deferred (F-038) |
| Sensitive automation (unlock) needs step-up | **BLOCKED** — needs a session older than the 5-minute step-up window; slow tier |
| Household modes: get/set, mirror status, suggestion | AUT-03 |
| Mode mirrored to HA `input_select` | **BLOCKED** — the mirror needs the config-worker/admin token; sync is T6.1 follow-up |
| Drift detection (`POST /admin/config-sync/verify`) (T6.2) | **BLOCKED** — direct HA YAML edit + config-worker; deferred (F-038) |
| Config jobs queued → applied → verified | **BLOCKED** — same worker dependency; deferred (F-038) |
| Script/automation YAML equivalence and behavioural scene comparison (T6.1) | **separate script** — `suites/aut-t61.ts`, result in `aut-t61.md` |

---

### E2E-AUT-01  A scene saves, activates, edits and deletes
- Capability: `/scenes`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. admin `POST /api/v1/scenes {name, actions:[switch off, switch off]}` → 200 with two actions and `lastRunAt:null`
  2. `GET /scenes` lists it; `GET /scenes/:id` returns the actions
  3. `POST /scenes/:id/activate` → 202 `{commands:[2], skipped:[]}`; both commands confirm
  4. Home Assistant shows both switches off; `lastRunAt` is set
  5. `PATCH` the name, `DELETE`, then `GET` → 404
  6. restore both switches on through HA
- Error twin: none (validation is AUT-04's preview card)
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the scene round-trips and really changes HA

### E2E-AUT-02  A routine runs its steps in order and reports progress
- Capability: `/routines`, `/routines/runs`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. `POST /api/v1/routines {name, steps:[device off, mode night]}` → 200
  2. `POST /routines/:id/execute` → 202 with a run id
  3. poll `GET /routines/runs/:runId` until `completed`; every step is `confirmed`
  4. `GET /routines/runs` lists the run; HA shows the switch off and the household mode is night
  5. restore the switch and mode
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the run completes in order and has the HA/mode effect

### E2E-AUT-03  Household modes can be read and changed
- Capability: `/household/mode`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. `GET /household/mode` → `{mode:"home", mirror, suggestion}`
  2. `PUT {mode:"night"}` → 200 with `mode:"night"`; `GET` reflects it
  3. a guest can read the mode but cannot change it (403)
  4. restore `home`
- Error twin: step 3
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: mode state round-trips and guests are read-only

### E2E-AUT-04  An automation previews, saves, validates and toggles
- Capability: `/automations`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. `POST /automations/preview` with a time trigger and a switch action → 200 with a plain-language summary
  2. `POST /automations` → 200 with the same summary; without an admin token `haAutomation.status` is `not_synced`
  3. `GET /automations` lists it; `GET /:id` returns it
  4. `POST /:id/disable` → `enabled:false`; `/enable` → true
  5. an unknown entity in the definition → 404/`unknown_entity`; a malformed definition → 400 `validation_error`
  6. a guest gets 403; `DELETE` then `GET` → 404
- Error twin: step 5
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the automation document and validation match the oracle
