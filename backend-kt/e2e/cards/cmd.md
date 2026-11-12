# CMD — commands, HA truth, undo, idempotency

Cards for plan §4.6 (`E2E_PARITY_PLAN.md`). Written before `scenarios/cmd.ts` (RUNBOOK §6.1).
Every card asserts Home Assistant's real state through `lib/ha-truth.ts`; the Oracle is HA for the
effect and TS for status codes, lifecycle and error codes.

## Coverage

| Catalogue bullet (plan §4.6) | Cards |
|---|---|
| Power on/off; 202 + command; `pending → confirmed`; HA state | CMD-01 |
| Brightness; out-of-range rejection | CMD-02 |
| Color temperature | CMD-03 |
| Fan speed | CMD-04 |
| Climate target temperature | CMD-05 |
| Cover position | CMD-06 |
| Lock/unlock; step-up rules | CMD-07 |
| Media player power | CMD-08 |
| Failure paths: unsupported operation, invalid parameters, HA rejection, fixed error text | CMD-09 |
| `Idempotency-Key` matrix: same request replays, different request refused, bad key, per-person | CMD-10 |
| Undo within the window, undo twice, undo of an undo, someone else's command | CMD-11 |
| Coalescing / per-entity ordering (T4.2): 45 brightness commands, final HA state, service-call count | CMD-12 |
| Group commands: fan-out, partial support, restore | CMD-13 |
| Unavailable device / confirmation timeout / late confirmation | **BLOCKED** — needs a device that HA never confirms; the fake latency proxy on 3193 plus a deliberate unavailable entity is T4.1/M8 work |
| Color RGB and input helpers | **not covered here** — the same command pipeline as CMD-03; add in M4 follow-up if wanted |
| Vacuum / media volume / media transport | **BLOCKED** — neither backend exposes a resolver for these operations (only power for media_player), so there is no contract to compare |
| Restart recovery (T4.1) | **separate task** — `suites/cmd-restart.ts`, result recorded in `cmd-restart.json` |
| Command events to sender/admins only (L35) | **BLOCKED** — the `/ws` transcript is M5 (WS) |
| Undo after the 10-minute window | **BLOCKED** — real-time 10 minutes is the slow tier (M8) |

The capability suite asserts the *functional* contract (a command is returned, reaches a terminal
state, HA changes) on both stacks. The exact wire contract (`202 pending` vs Kotlin's synchronous
`200 confirmed`) is what the differential suite compares; see finding F-026.

---

### E2E-CMD-01  Power commands reach Home Assistant and confirm
- Capability: `POST /devices/:id/commands` turn_off/turn_on     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find a switch Thing (e.g. `TV and console`); record HA state
  2. admin `POST /api/v1/devices/:id/commands {action:"turn_off"}` → 202 with an `id` (Kotlin: 200)
  3. wait for a terminal state; must be `confirmed`, `confirmedBy:"state"`, `undoable:true`
  4. HA shows the switch entity = `off`
  5. turn_on again → confirmed and HA `on`
- Error twin: none (CMD-09)
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the command confirms and HA really changes

### E2E-CMD-02  Brightness is applied and out-of-range values fail
- Capability: `set_brightness`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. record HA brightness; `set_brightness {brightness_pct:40}` → command confirms
  2. HA's `brightness` attribute is 40 % (±2) and the light is on
  3. `set_brightness {brightness_pct:0}` → command `failed`, `failure.code:"invalid_parameters"`
  4. restore the previous brightness (or turn off if it was off)
- Error twin: step 3
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the value is applied and 0 is refused

### E2E-CMD-03  Color temperature is applied
- Capability: `set_color_temperature {kelvin}`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. use the `light.bed_light` device (a color-temp light); record HA `color_temp_kelvin`; set 3000 K → confirmed
  2. HA reports 3000 K ±60
  3. restore the previous value (or turn off)
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: HA's kelvin value matches

### E2E-CMD-04  Fan speed is applied within the fan's step
- Capability: `set_speed {percentage}`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find `Ceiling fan`; record HA `percentage`
  2. `set_speed {percentage:50}` → confirmed; HA `percentage` within 34 (coarse steps)
  3. restore the previous percentage, or turn the fan off if it had none
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: HA's percentage is close to the request

### E2E-CMD-05  Climate target temperature is applied
- Capability: `set_temperature {temperature}`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find the `climate.heatpump` device (a single-target climate); record HA `temperature`
  2. `set_temperature {temperature:22}` → confirmed; HA target within 0.5
  3. restore the previous target
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the climate target moves

### E2E-CMD-06  Cover position is applied
- Capability: `set_position {position}`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find `Balcony door`; record HA `current_position`
  2. `set_position {position:30}` → confirmed; HA `current_position` within 2
  3. restore the previous position (or open the cover if it had none)
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the cover reports the requested position

### E2E-CMD-07  Lock and unlock change HA, and a guest cannot control the door
- Capability: `lock`, `unlock`; step-up rules     Oracle: HA, TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `Front Door` starts locked; admin `unlock` → confirmed; HA `unlocked`
  2. admin `lock` → confirmed; HA `locked`
  3. guest `POST /devices/<door>/commands {action:"unlock"}` → 404 (device invisible) or 403
  4. the door is still locked afterwards
- Error twin: step 3
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the door follows the command and a guest cannot open it

### E2E-CMD-08  Media player power is applied
- Capability: media_player turn_on/turn_off     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find a `media_player` Thing; record HA state
  2. `turn_off` → confirmed; HA state `off`
  3. `turn_on` → confirmed; HA state is `on`/`idle`/`playing` (not `off`)
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: HA's media player changes state

### E2E-CMD-09  Refusals are failed commands with fixed text
- Capability: command failure codes and messages     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `do_a_backflip` on the lamp → `failed`, `failure.code:"unsupported_operation"`
  2. `set_brightness {brightness_pct:0}` and `{brightness_pct:"ten"}` → `invalid_parameters`
  3. `set_hvac_mode {hvac_mode:"nonsense"}` on the climate → `failed`, `failure.code:"ha_rejected"`
  4. the `ha_rejected` message is exactly `Home Assistant refused the command` (no raw HA text)
- Error twin: this is the error card
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: every refusal is a failed command with a known code and masked text

### E2E-CMD-10  The idempotency-key matrix
- Capability: `Idempotency-Key`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. `turn_off` a switch with key `parity-cmd-key-0001` → command A
  2. repeat the exact request → the same command id (TS also sets `Idempotent-Replay: true`)
  3. the same key with `turn_on` → 422 `idempotency_key_reuse`
  4. key `short` → 400 `validation_error`
  5. a member using the same key gets their own command id
  6. turn the lamp back on
- Error twin: steps 3–4
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: a replay is one command and a different request is refused

### E2E-CMD-11  Undo puts the previous state back once
- Capability: `POST /commands/:id/undo`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. `turn_off` a switch → confirmed, `undoable:true`
  2. `POST /commands/<id>/undo` → 202 with `action:"turn_on"`, `undoOf:<id>`
  3. the undo command confirms and HA shows `on`
  4. undoing the original again → `already_undone`; undoing the undo → `not_undoable`
  5. a member undoing the admin's command → 404
- Error twin: steps 4–5
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: undo works once and the refusals are explicit

### E2E-CMD-12  Coalescing keeps the last brightness and preserves order
- Capability: T4.2 coalescing / per-entity ordering     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. send 45 `set_brightness` commands (10…54 %) back to back
  2. wait for all of them to reach a terminal state
  3. HA's final `brightness` is 54 % (±2)
  4. the commands' `createdAt` order is monotonic and the final command is the last one
  5. count Home Assistant `call_service` events for the lamp during the burst (recorded in the result detail)
  6. restore the previous brightness
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the last requested value wins and order is preserved

### E2E-CMD-13  A group command fans out to its members
- Capability: `POST /groups/:id/commands`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. create a group with `Floor lamp` and `Bedside lamps`
  2. `POST /api/v1/groups/:id/commands {action:"turn_off"}` → 202 `{commands:[2], skipped:[]}`
  3. both child commands confirm and HA shows both lights `off`
  4. `turn_on` via the group and both return `on`, then delete the group
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: every visible member follows the group command
