# FAV — favorites, groups, device settings

Cards for plan §4.8 (`E2E_PARITY_PLAN.md`). Written before `scenarios/fav.ts` (RUNBOOK §6.1).
Oracle: TS. Device ids come from `GET /devices`.

## Coverage

| Catalogue bullet (plan §4.8) | Cards |
|---|---|
| Favorites add / remove / reorder | FAV-01 |
| Maximum count (50) and unknown ids | FAV-04 |
| Favorites filter on the device list | FAV-03 |
| Per-person isolation (my favorites are not yours) | FAV-02 |
| Guest sees only visible group members / favorites | FAV-05 |
| Groups create / rename / members / delete | FAV-06 |
| Group state aggregation and group commands | **BLOCKED** — command lifecycle and HA truth are M4 (CMD) |
| Settings persistence across a restart | **BLOCKED** — a real restart is M8; DEV-07 covers the round-trip |

---

### E2E-FAV-01  Favorites keep the caller's order and can be reordered or cleared
- Capability: `GET/PUT /favorites`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. pick two devices by name; admin `PUT /api/v1/favorites {thingIds:[a,b]}` → 200 with `devices` in that order
  2. `GET /favorites` → the same two ids in the same order
  3. `PUT {thingIds:[b,a]}` → order reversed
  4. `PUT {thingIds:[]}` → `devices: []`
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: order is preserved and clearing works

### E2E-FAV-02  Favorites are personal
- Capability: per-user favorites     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. admin favorites one device
  2. member `GET /favorites` → 200 with `devices: []`
  3. member favorites another visible device; admin's list is unchanged
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: one person's list never leaks into another's

### E2E-FAV-03  The device list can be filtered to the caller's favorites
- Capability: `GET /devices?favorite=true`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. admin favorites two devices
  2. `GET /api/v1/devices?favorite=true` → exactly those two, in favorite order, each with `favorite:true`
  3. the unfiltered list still contains everything, and a non-favorite has `favorite:false`
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the filter returns only favorites in order

### E2E-FAV-04  Unknown ids and too many favorites are refused
- Capability: `PUT /favorites` validation     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. `PUT {thingIds:["thing_nope"]}` → 404 `not_found`
  2. `PUT {thingIds:[51 generated ids]}` → 400 `validation_error` (the oracle's schema caps at 50)
  3. the previous favorites are unchanged after both failures
- Error twin: this is the error card
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: bad input is refused and does not overwrite the list
- Known caveat: Kotlin's body type has no 50-item cap and silently truncates to 50; recorded by the differential suite.

### E2E-FAV-05  A device the caller cannot see cannot be a favorite
- Capability: favorites × visibility     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. admin favorites a device
  2. guest `PUT /favorites {thingIds:[<that device id>]}` → 404 `not_found` (it is invisible, not forbidden)
  3. guest `GET /favorites` → `devices: []`
  4. admin hides the device → `GET /favorites` no longer lists it, and it drops out of `?favorite=true`
- Error twin: step 2
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: favorites never reveal an invisible device

### E2E-FAV-06  Groups create, list, rename, change members and delete
- Capability: `GET/POST/PATCH/DELETE /groups`     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. admin `POST /api/v1/groups {name:"Parity lights", thingIds:[<two lights>]}` → 200 with `id`, `name`, `devices` (two entries)
  2. `GET /groups` lists it; `GET /groups/:id` returns the same view
  3. `PATCH /groups/:id {name:"Parity lamps", thingIds:[<one light>]}` → 200 with the new name and one member
  4. a guest `POST /groups` → 403 `forbidden` (members may create; the oracle grants `group.write` to admins and members)
  5. `DELETE /groups/:id` → 200 `{ok:true}`; `GET /groups/:id` → 404 `not_found`
- Error twin: step 4
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the group round-trips and only writers can change it
- Known caveat: Kotlin's group view may use a different `id`/`thingIds` shape; recorded by the differential suite.
