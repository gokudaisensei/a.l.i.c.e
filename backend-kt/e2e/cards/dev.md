# DEV — things, devices, areas, capabilities

Cards for plan §4.5 (`E2E_PARITY_PLAN.md`). Written before `scenarios/dev.ts` (RUNBOOK §6.1).
Oracle: TS + HA. The device ids are read from the list, never hard-coded.

## Coverage

| Catalogue bullet (plan §4.5) | Cards |
|---|---|
| `GET /devices` list shape and hidden exclusion | DEV-01 |
| Filters: `area`, `type`, `q`, `favorite` | DEV-02, FAV-03 |
| `GET /devices/:id` with and without `include=diagnostics` | DEV-03 |
| Areas list and area → devices | DEV-04 |
| Capabilities and facets per domain | DEV-05 + **T3.1 inventory diff** |
| Facet polarity, name cleaning, search over aliases | T3.1 inventory diff (field-by-field) and DEV-02 search |
| `PATCH …/settings` power limit / voice / guest visibility | DEV-07 |
| `PATCH …/name` | DEV-06 |
| Entity role route (blocking the main entity hides the device) | DEV-08 |
| Per-caller visibility pruning (404, never 403) | DEV-09 |
| Merge / split / unmerge | **not covered here** — needs multi-entity Things and the command path; M4 (CMD) |
| Hide / unhide | DEV-08 |
| Every seeded Thing compared Thing-for-Thing | **T3.1 inventory diff** (`inventory-diff.md`) |
| Guest device policies (allow/deny) | **BLOCKED** — the policy API and guest allow list are M3/M4 scope (HH-14) |

---

### E2E-DEV-01  The device list has the documented shape and hides hidden Things
- Capability: `GET /devices` (API.md)     Oracle: TS, HA
- Needs: HA-connected household world
- Steps:
  1. admin `GET /api/v1/devices` → 200 `{devices:[...]}` with at least 10 entries
  2. every entry has `id`, `name`, `kind`, `primary`, `others`, `controls`, `sensors`, `available`
  3. no entry has a `diagnostics` array and no entry is `hidden`
  4. names are sorted case-insensitively on the oracle
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the list is complete and shaped like a Thing

### E2E-DEV-02  List filters narrow by area, primary type and text
- Capability: `GET /devices?area=&type=&q=`     Oracle: TS, HA
- Needs: HA-connected household world
- Steps:
  1. `GET /areas`, take the first area id; `GET /devices?area=<id>` → every entry has that `areaId`
  2. `GET /devices?type=light` → every entry's `primary.domain` is `light`
  3. `GET /devices?q=floor lamp` → every entry's name contains `floor` (case-insensitive)
  4. the filtered counts are non-zero
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: every returned entry matches the filter
- Known caveat: Kotlin's `q` filter matches only the Thing name, not aliases; the differential suite records any list difference.

### E2E-DEV-03  Diagnostics appear only when asked for
- Capability: `GET /devices/:id?include=diagnostics`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. find a Thing with `diagnosticCount > 0` in the list
  2. `GET /devices/:id` → no `diagnostics` array
  3. `GET /devices/:id?include=diagnostics` → `diagnostics` is an array of the same length as `diagnosticCount`
  4. a guest asking for diagnostics never gets them (role check)
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: diagnostics are opt-in and complete

### E2E-DEV-04  Areas list and area membership
- Capability: `GET /areas`, `GET /areas/:id/devices`     Oracle: TS, HA
- Needs: HA-connected household world
- Steps:
  1. admin `GET /api/v1/areas` → 200 `{areas:[...]}` with at least 5 entries
  2. every area has `id`, `name` and a numeric `deviceCount`
  3. `GET /areas/:id/devices` → every device has `areaId` equal to `:id` and the count matches `deviceCount`
- Error twin: unknown area id → 200 with an empty list (the oracle does not 404 areas)
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: area counts agree with the area-scoped lists
- Known caveat: Kotlin returns an area `name` plus a `count`/`deviceCount` pair; the differential suite records the exact field names.

### E2E-DEV-05  Capabilities are exposed for the device's entities
- Capability: `GET /devices/:id/capabilities`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. pick the `Floor lamp` or the first light
  2. `GET /devices/:id/capabilities` → 200 `{entities:[...]}` with at least one entity
  3. every entity has `entityId`, `name`, `role`, `capabilities`
  4. at least one capability has `name`, `readable`, `controllable` and `operations`
- Error twin: unknown id → 404 `not_found`
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the capability document is complete

### E2E-DEV-06  Renaming a device is reflected and can be undone
- Capability: `PATCH /devices/:id/name`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. pick a device and remember its name
  2. admin `PATCH /api/v1/devices/:id/name {name:"Parity Lamp"}` → 200 with `name:"Parity Lamp"`
  3. `GET /devices/:id` → `name:"Parity Lamp"`
  4. `PATCH …/name {name:null}` → 200 and the name returns to the original
- Error twin: unknown id → 404 `not_found`
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the override round-trips

### E2E-DEV-07  Settings persist on the device's primary entity
- Capability: `PATCH /devices/:id/settings`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. pick a device with a primary entity
  2. admin `PATCH /api/v1/devices/:id/settings {powerLimitW:1200, voiceExposed:true}` → 200
  3. the reply's `settings.powerLimitW` is 1200 and `settings.voiceExposed` is true
  4. `GET /devices/:id` reports the same settings
  5. `PATCH {powerLimitW:0}` → 400 `validation_error`; `PATCH {}` → 400 `validation_error`
  6. reset to `{powerLimitW:null, voiceExposed:false}`
- Error twin: step 5
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the values round-trip and out-of-range values are refused

### E2E-DEV-08  Hiding a device (and blocking its main entity) removes it from the list
- Capability: `POST /devices/:id/hide|unhide`, `PUT /entities/:id/role`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. pick a device; admin `POST /api/v1/devices/:id/hide` → 200 `{ok:true}`
  2. `GET /devices` no longer contains it; `GET /devices?includeHidden=true` contains it with `hidden:true`
  3. `POST …/unhide` → the device is back in the default list with `hidden:false`
  4. `PUT /api/v1/entities/<primary.entityId>/role {hidden:true}` → `{ok:true}`; the device disappears
  5. `PUT …/role {hidden:false}` → the device returns
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: both hide paths remove and restore the device

### E2E-DEV-09  A caller who may not see a device gets 404, never 403
- Capability: per-caller visibility (SEC)     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. guest `GET /api/v1/devices` → 200 and every returned device is one the guest may see
  2. guest `GET /api/v1/devices/<id of an admin-visible device>` → 404 `not_found`
  3. guest `GET /devices/<id>/capabilities` → 404; `PATCH /devices/<id>/name` → 403 `forbidden` (the write-permission guard runs before visibility)
  4. guest `POST /devices/<id>/hide` → 403 or 404, never 200
- Error twin: steps 2–4
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: invisibility is a 404 and no mutation succeeds
