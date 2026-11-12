# HIST — energy, history, insights

Cards for plan §4.11 (`E2E_PARITY_PLAN.md`). Written before `scenarios/hist.ts` (RUNBOOK §6.1).
T5.3 drives the seeded template power sensors through their `input_number` helpers and checks the
live total against the sum.

## Coverage

| Catalogue bullet (plan §4.11) | Cards |
|---|---|
| Live power from metering sensors (T5.3) | HIST-01 |
| Today's usage and top consumers | HIST-01 |
| Per-device power/limit/percentage | HIST-02 |
| Hourly/daily history per device | HIST-03 |
| State history compared with HA's own history | HIST-03 (shape + points; exact HA comparison is the same API) |
| Attribute log (brightness/colour), gaps, page limits | **not covered here** — HA recorder has no attributes for the demo sensors; a follow-up with a real recorder range |
| Insights list and dismiss | HIST-04 |
| Empty-history and large-range handling | **BLOCKED** — needs controlled recorder data; M8 |
| Guests refused | HIST-01/03/04 |

---

### E2E-HIST-01  The live total follows the metering sensors
- Capability: `GET /energy/summary` (T5.3)     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. drive `input_number.parity_kettle_power` and `…tv_power` to 1000/500 W through HA (the washer helper is not part of the summary total in this seed)
  2. wait for HA to report the three `sensor.parity_*_power` states
  3. `GET /api/v1/energy/summary` → `nowWatts >= 1500`, `monitoredDevices > 0`
  4. `statisticsAvailable` is a boolean and `topToday` is an array
  5. a guest gets 403
  6. reset the three helpers to 0
- Error twin: step 5
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the live sum includes the driven sensors

### E2E-HIST-02  Per-device energy carries the power limit
- Capability: `GET /energy/devices`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. set `powerLimitW:1600` on the `sensor.parity_kettle_power` Thing and drive its reading to 800
  2. `GET /api/v1/energy/devices` → the Thing has `watts ≈ 800`, `limitW:1600`, `percentOfLimit ≈ 50`
  3. `statisticsAvailable` is a boolean
  4. reset the limit and the reading
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the device row reports the configured limit and percentage

### E2E-HIST-03  A device's state history is returned and validated
- Capability: `GET /history/devices/:id`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. pick a switch; change it through HA so the recorder has at least one point
  2. `GET /api/v1/history/devices/:id` → `points` is an array, `totalPoints >= 1`, `downsampled` boolean
  3. every point has `at`, `state`, `values`, `availability`
  4. `?maxPoints=5` → 4xx validation error; `?from=nope` → 400
  5. a guest gets 403
- Error twin: step 4
- Normalize: timestamps, values
- Both stacks: yes     Timing: normal     Pass when: the history document matches the documented shape

### E2E-HIST-04  Insights are listed and dismissible
- Capability: `GET /insights`, `POST /insights/:id/dismiss`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. `GET /api/v1/insights` → 200 `{insights:[...]}` (may be empty)
  2. every entry has `id`, `kind` and `title` (the oracle also sends `reason`/`action`/`key`)
  3. `POST /insights/<id>/dismiss` for the first listed insight → 200 `{ok:true}`
  4. a guest gets 403
- Error twin: step 4
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the list shape and dismissal contract hold
