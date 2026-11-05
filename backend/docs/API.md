# Alice Backend — API

Status: draft v1. Base path `/api/v1` (implemented: auth, users, household, permissions, `/admin/security`, `/ha/connection*`, `/devices*`, `/entities/*/role`, `/areas`, `/commands*`; other areas are stubs. `/ws` realtime, favorites, groups, scenes, routines, modes, device settings. automations, notifications, alerts, insights, `/admin/config-sync`. Not yet: activity, energy, history, backups, updates, AI, undo). JSON everywhere. OpenAPI is generated at `/docs`. Realtime on `/ws`. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Conventions

- **Auth:** session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) set after passkey login. All routes except those marked *public* need a session.
- **Household scope:** a session resolves to one active household (single household for now); `:householdId` is omitted from paths. The backend enforces the scope.
- **Permissions column:** `A` admin, `M` member, `G` guest. Guests see only devices allow-listed for them. `†` = step-up (passkey assertion within the last few minutes) required.
- **Errors:** `{ "error": { "code": "snake_case", "message": "…", "details"?: … } }` with HTTP 400/401/403/404/409/422/429/500. `422`-style validation errors use `validation_error`.
- **IDs:** ULIDs. **Timestamps:** ISO 8601 UTC in JSON.
- **Pagination:** cursor, `?limit=50&cursor=…` → `{ items, nextCursor }`.
- **Commands are asynchronous:** `POST …/commands` returns `202` with the command; progress arrives over `/ws` or via `GET /commands/:id`.

## Authentication

| Method & path | Perm | Purpose |
|---|---|---|
| `POST /auth/register/options` | public | Start first-user (or invited-user) passkey registration; body `{ displayName, inviteCode? }` |
| `POST /auth/register/verify` | public | Finish registration; creates user (+ household if first user) and session; returns recovery codes once |
| `POST /auth/login/options` | public | Start passkey login |
| `POST /auth/login/verify` | public | Finish login; sets session cookie |
| `POST /auth/logout` | any | Revoke current session |
| `GET /auth/session` | any | Current user, household, role, expiry |
| `GET /auth/sessions` | any | List own sessions |
| `DELETE /auth/sessions/:id` | any | Revoke a session |
| `POST /auth/step-up/options` / `verify` | any | Fresh passkey assertion for sensitive actions |
| `POST /auth/passkeys/options` / `verify` | any† | Add another passkey |
| `GET /auth/passkeys`, `DELETE /auth/passkeys/:id` | any† | Manage passkeys |
| `POST /auth/recovery/verify` | public | Sign in with a recovery code, then must add a passkey |

## Users

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /users/me`, `PATCH /users/me` | any | Profile |
| `GET /users/me/preferences`, `PATCH …` | any | Quiet hours, push toggles |
| `GET /users/me/push-subscriptions` | A,M,G | Your devices (never their tokens), which push channels the server supports (`webpush`, `fcm`) and the Web Push public key |
| `POST /users/me/push-subscriptions` | A,M,G | `{ platform: "webpush", token: endpoint, keys: { p256dh, auth }, label? }` or `{ platform: "fcm", token, label? }`. Web Push endpoints must be https on a known push service. Max 10 per person |
| `DELETE /users/me/push-subscriptions/:id`, `POST /users/me/push-subscriptions/test` | A,M,G | Remove a device; send a test push to yours |

## Household, members, invitations, permissions

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /household`, `PATCH /household` | A (read: all) | Name, timezone |
| `GET /household/members` | A,M | Members with role, presence, expiry |
| `GET /household/people` | A,M | Members with their linked Home Assistant person, whether they are home (null if not linked), a suggested person when the names match, and unlinked persons |
| `PUT /household/people/:userId` | A† | `{ personEntityId: string \| null }` link or unlink a member. A person belongs to one member. Once anything is linked only linked non-guest members count for presence |
| `PATCH /household/members/:id` | A† | Change role, expiry, device visibility |
| `DELETE /household/members/:id` | A† | Remove member |
| `GET /household/invitations` | A | Open invitations |
| `POST /household/invitations` | A† | `{ role, expiresIn }` → `{ code }` (shown once) |
| `DELETE /household/invitations/:id` | A | Revoke |
| `GET /permissions/me` | any | Effective permissions and allowed devices |
| `GET /permissions/policies`, `PUT /permissions/policies/:id`, `DELETE …` | A† | Device-level allow/deny |

## Home Assistant connection (admin)

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /ha/connection` | A | Status, HA version, last sync, health |
| `PUT /ha/connection` | A† | Set URL and operational token (admin token is set separately) |
| `PUT /ha/connection/admin-token` | A† | Store admin token for the config-worker |
| `POST /ha/connection/test` | A | Test credentials without saving |
| `POST /ha/connection/resync` | A | Queue rediscovery |

There is no endpoint that proxies arbitrary HA calls.

## Things, capabilities, commands

The API exposes **Things** (one per physical device), not raw HA entities. In URLs and payloads `:id` is a Thing id. Commands still target entities inside a Thing, so a command may name any control entity in the Thing (for example the mic-mute switch).

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /devices?area=&type=&q=&favorite=` | A,M,G (filtered) | Things with display name, area, primary capability, current values, facets and controls. `q` searches names and aliases |
| `GET /devices/:id` | A,M,G | Thing detail: primary, `controls`, `facets`, `sensors`, hidden `diagnostics` (`?include=diagnostics`), underlying entities |
| `GET /devices/:id/capabilities` | A,M,G | Aggregated capabilities and allowed operations, per entity |
| `PATCH /devices/:id/settings` | A | Power limit, voice exposure, guest visibility |
| `PATCH /devices/:id/name` | A,M | User display-name override (`null` clears it) |
| `POST /devices/:id/hide`, `POST /devices/:id/unhide` | A | Hide a Thing from lists |
| `POST /devices/merge` | A† | `{ ids: [thingId, …] }` merge into one Thing |
| `POST /devices/:id/split` | A† | `{ entityIds: […] }` move entities out into their own Thing |
| `PUT /entities/:entityId/role` | A | `{ role?, attachTo?, onMeans? }` force a role, attach a facet to a primary, or say what a facet means when "on" (e.g. `"closed"`) |
| `GET /suggestions?status=pending` | A | Proposed names, roles, merges and attachments |
| `POST /suggestions/:id/accept`, `POST /suggestions/:id/reject` | A | Accept writes the override; reject is remembered |
| `POST /suggestions/run` | A | Queue the (optional, off by default) LLM suggestion job |
| `POST /devices/:id/commands` | A,M,G (per policy); `†` for lock/unlock-type operations | `{ entityId?, action, parameters }`; `entityId` defaults to the primary and must belong to the Thing. Returns `202 Command` |
| `GET /devices/:id/activity` | A,M | Recent events for the Thing (all its entities) |
| `GET /commands/:id` | owner or A | Command with lifecycle state |
| `POST /commands/:id/cancel` | owner or A | Cancel while `pending`/`authorized` |
| `POST /commands/:id/undo` | owner or A | Compensating command from `actual_state` |
| `GET /commands?state=&limit=` | A | Command log |

**Thing object (abridged)** for an Echo-style ESPHome device:

```json
{
  "id": "thing_01J…", "name": "Kitchen display", "area": "kitchen",
  "nameSource": "computed", "sourceName": "echolocal kitchen Media Player",
  "kind": "device",
  "primary": { "entityId": "media_player.kitchen_display", "values": { "power": true } },
  "others": [ { "entityId": "camera.kitchen_display_camera", "name": "Camera" } ],
  "controls": [ { "entityId": "switch.kitchen_display_mic_mute", "name": "Microphone mute", "values": { "power": true }, "sensitive": true } ],
  "facets": [ { "key": "privacy_shutter", "entityId": "binary_sensor.kitchen_display_camera_shutter", "value": "closed", "label": "Closed", "active": true, "tone": "ok", "ambiguous": false, "basis": "override", "sensitive": true } ],
  "sensors": [],
  "diagnostics": { "count": 3 }
}
```

Facets are properties, not devices: they appear on their primary and never as their own item in `GET /devices`. A facet value is resolved server-side from the entity's `device_class`, then wording in its name, then a user override (`onMeans`). When none of those say what "on" means (a bare "Camera shutter"), the facet is returned with `ambiguous: true` and an On/Off label, and the admin UI should offer to resolve it (`PUT /entities/:entityId/role` accepts `onMeans`).

**Command object**

```json
{
  "id": "01J…", "entityId": "light.floor_lamp", "action": "set_brightness",
  "parameters": { "brightness_pct": 60 },
  "state": "confirmed",
  "requestedState": { "state": "on", "brightness_pct": 60 },
  "actualState": { "state": "on", "brightness": 153 },
  "createdAt": "…", "finishedAt": "…", "failureReason": null
}
```

States: `pending, authorized, dispatched, accepted, confirmed, failed, timed_out, cancelled`.

`failure.code` is one of `unknown_entity`, `unsupported_operation`, `invalid_parameters`, `device_unavailable`, `forbidden`, `step_up_required`, `ha_unreachable`, `ha_rejected`, `not_confirmed` (HA accepted but the expected state was not seen in time). `confirmedBy` is `state` (desired state observed), `already` (it was already true) or `unobservable` (scene/script/stop: nothing to observe, confirmed on HA's acceptance).

## Areas, groups, favorites

Implemented. Everything here is filtered by what you may see: a device you cannot see is absent, and a group or scene made only of such devices does not exist for you.

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /areas`, `GET /areas/:id/devices` | A,M,G (filtered) | Rooms with the number of devices you can see, and their devices |
| `GET /groups`, `GET /groups/:id` | A,M,G | Groups with the devices of each that you can see; guests only get groups that hold something of theirs |
| `POST /groups` | A,M | `{ name, icon?, thingIds[] }`; every device must be visible to you (max 100) |
| `PATCH /groups/:id`, `DELETE /groups/:id` | A,M | Rename, change members, delete |
| `POST /groups/:id/commands` | A,M,G (per device) | `{ action, parameters?, target?: "first"\|"all" }` runs one operation on each member, as you. Each device uses its first visible entity that supports it (main entity, other main entities, then controls); `target: "all"` uses every supporting entity. `202` with `{ commands, skipped }`; unsupported members are listed in `skipped` |
| `GET /favorites`, `PUT /favorites` | A,M,G | Your own favorites in your order. `PUT { thingIds[] }` replaces the list (max 50). Devices also carry `favorite: true/false`, and `GET /devices?favorite=true` filters to them |
| `PATCH /devices/:id/settings` | A | `{ entityId?, powerLimitW? (1-100000 or null), voiceExposed? }` for the main entity. Shown as `settings` on the device, with `voiceSync` (`none`, `pending`, `synced`, `failed`). A power limit raises alerts at 90%; voice exposure is applied in Home Assistant's Assist |

## Scenes, routines, automations, modes

Scenes, routines and modes are implemented; automations are not.

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /scenes`, `GET /scenes/:id` | A,M,G | Guests only see scenes that touch a device of theirs, and not what is in them |
| `POST /scenes` | A,M | Also mirrored to Home Assistant as a script (`haScript` shows `not_synced`, `pending`, `synced` or `failed` and why). `{ name, icon?, description?, actions: [{ entityId, action, parameters? }] }`, max 50. Every action is checked: real, visible to you, supported, valid; sensitive ones need a fresh passkey to save |
| `PATCH /scenes/:id`, `DELETE /scenes/:id` | A,M | |
| `POST /scenes/:id/activate` | A,M,G | Starts every action at once **as you**. `202` with `{ commands, skipped }`; devices that are gone or not yours are skipped, refusals and step-up requirements appear as failed commands |
| `GET /routines`, `GET /routines/:id` | A,M | |
| `POST /routines` | A,M | `{ name, icon?, onFailure?: "continue"\|"stop", steps[] }`. Steps: `{ type: "device", entityId, action, parameters? }`, `{ type: "scene", sceneId }`, `{ type: "mode", mode }`, `{ type: "delay", seconds }` (1-3600). Max 50 steps |
| `PATCH /routines/:id`, `DELETE /routines/:id` | A,M | |
| `POST /routines/:id/execute` | A,M | Runs the steps in order as you. `202` with a run |
| `GET /routines/runs/:runId`, `POST /routines/runs/:runId/cancel` | starter, admins | Progress (`running`, `completed`, `failed`, `stopped`, `cancelled`, with each step's state and any problems) and cancel. A passkey confirmation only covers steps that start within 5 minutes of the run starting |
| `GET /household/mode` | A,M,G | `{ mode, changedAt, changedBy, mirror: { status: "active"\|"waiting"\|"unavailable", reason }, suggestion }`. `mirror` says whether Home Assistant follows the mode through `input_select.alice_household_mode` (needs an admin token and the worker). `suggestion` is for members and admins only. A change made in Home Assistant arrives with `changedBy: null` |
| `PUT /household/mode` | A,M | `{ mode: "home"\|"away"\|"night"\|"vacation" }`; pushed to `/ws` subscribers of `household` as `household.mode_changed` |
| `GET /automations`, `GET /automations/:id` | A,M | With a plain-language `summary` and `haAutomation` sync state. Guests have no access |
| `POST /automations` | A,M | `{ name, enabled?, definition }` (format below). Checked, saved, compiled to a Home Assistant automation by the config-worker |
| `PATCH /automations/:id`, `DELETE /automations/:id` | A,M | Edit recompiles; delete removes it from Home Assistant |
| `POST /automations/:id/enable` / `disable` | A,M | Applied in Home Assistant too |
| `POST /automations/preview`, `POST /automations/:id/test` | A,M | Dry run: the summary, the Home Assistant config that would be sent, and warnings. Saves and runs nothing |
| `GET /automations/:id/runs` | A,M | When Home Assistant ran it |

**Automation definition** (our schema, versioned):

```json
{
  "version": 1, "name": "Lights on when I get home",
  "trigger": { "type": "arrive", "person": "anyone" },
  "conditions": [ { "type": "dark" }, { "type": "mode", "value": "home" } ],
  "actions": [
    { "type": "turn_on", "target": "light.hall" },
    { "type": "set_brightness", "target": "light.floor_lamp", "value": 70 }
  ]
}
```

A member can be the subject of an arrival: `{ "type": "arrive", "userId": "usr_…" }` follows whichever Home Assistant person that member is linked to. Saving an automation with a sensitive action (such as unlock) needs an admin with a fresh passkey; it is shown in `sensitiveActions` and admins get an urgent notification each time it runs. Scripts, scenes, routines and automations show `haScript` / `haAutomation` status `drifted` when they were changed in Home Assistant.

Triggers (from the UI): `arrive, leave, time, sunset, door_opens, motion, power_over_limit`. Conditions: `dark, someone_home, days (any|weekdays|weekends), mode`. Actions: `turn_on, turn_off, set_brightness, set_temperature, lock, notify, run_scene`. The server renders the plain-language summary (`"When someone gets home, if it is dark, …"`) so clients do not have to.

## Activity, notifications, alerts

Notifications and alerts are implemented (in-app and over `/ws`; delivery to a phone's push service is not). Activity is not built yet.

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /notifications?unread=&limit=&before=` | A,M | Your notifications, newest first, with `unread` count |
| `POST /notifications/:id/read`, `POST /notifications/read-all` | A,M | Mark read (yours only) |
| `GET /alerts?includeCleared=` | A,M | Active alerts for devices you can see. Today: `power_limit`, raised at 90% of a device's limit and cleared below 85% |
| `POST /alerts/:id/ack` | A,M | "Seen". It stays until usage drops |
| `GET /activity`, `POST /activity/seen` | A,M | Not built yet |

Notifications come from power alerts and from automations' `notify` action (Home Assistant fires `alice_notification`, Alice stores one per recipient). Guests receive none.

## Energy, history, insights

Insights are implemented for one thing so far: household mode suggestions. Energy and history are not built.

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /energy/summary` | A,M | Current draw, today so far |
| `GET /energy/history?from=&to=&resolution=hour|day` | A,M | Aggregated consumption |
| `GET /energy/devices` | A,M | Per-device consumption and limits |
| `GET /history/entities/:id?from=&to=` | A,M | State history proxied from HA's recorder (read-only) |
| `GET /insights` | A,M | Deterministic suggestions, e.g. `{ id: "mode:away", title: "Switch to Away mode?", reason: "Everyone has left.", action: { type: "set_mode", mode: "away" } }`. Rules: everyone gone and mode Home suggests Away; night time and mode Home suggests Night; someone home and mode Away suggests Home; morning and mode Night suggests Home |
| `POST /insights/:id/dismiss` | A,M | "Not now": hidden for 6 hours |

## AI (later)

| Method & path | Perm | Purpose |
|---|---|---|
| `POST /ai/chat` | A,M | Conversational control; tool calls flow through the command pipeline with risk classes |
| `POST /ai/plans/:id/confirm` | A,M† | Confirm a planned multi-step action |

## Backups, updates, administration

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /admin/config-sync` | A | `{ connected, adminTokenSet, workerOnline, workerLastSeenAt, pendingJobs, failedJobs, canApply }`: whether scenes, routines, automations, the mode helper and voice exposure can reach Home Assistant |
| `POST /admin/config-sync/resync` | A | Queue everything that is not in Home Assistant yet, failed to get there, or drifted |
| `POST /admin/config-sync/verify` | A | Read back what Alice put in Home Assistant and mark anything edited, removed or switched off there as `drifted` (also runs every 15 minutes). `GET /admin/config-sync` includes a `drifted` count |

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /backups` | A | List with verification status |
| `POST /backups` | A | Queue a backup job; `{ destination: "ha"|"nas"|"upload" }` (default `ha`) |
| `POST /backups/:id/verify` | A | Queue restore test |
| `POST /backups/:id/restore` | A† | Restore (guarded) |
| `GET /updates` | A | Current version, available version, state, settings |
| `PUT /updates/settings` | A† | `{ autoUpdate: boolean, windowStart, windowEnd }` |
| `POST /updates/schedule`, `POST /updates/install` | A† | Schedule into the next window / install now |
| `POST /updates/emergency` | A† | `{ reason (min 8 chars), confirmation: "DEPLOY" }`; skips the window, audited |
| `GET /admin/health` | A | Service, HA connection, jobs, disk, DB |
| `GET /admin/diagnostics` | A | Versions, config summary (no secrets) |
| `GET/POST /admin/support-sessions`, `DELETE /admin/support-sessions/:id` | A† | Grant, list, end scoped support access |
| `GET /admin/audit?cursor=` | A | Audit log |
| `GET /admin/security/sensitive-operations` | A | Effective rules: defaults plus household changes, each with `source: "default" \| "custom"` |
| `PUT /admin/security/sensitive-operations` | A† | `{ rules: [{ domain, action, deviceClass?, sensitive }] }` replace the household's rules; audited, and the response flags any default that was switched off |
| `DELETE /admin/security/sensitive-operations/:ruleId` | A† | Remove a custom rule (falls back to the default) |
| `GET /health` | public | Liveness (already implemented) |

## WebSocket `/ws`

Implemented. `GET /ws` (WebSocket upgrade, at the root, not under `/api/v1`). It authenticates with the same session cookie as the REST API during the upgrade: no valid session (or no household access) is a plain `401` and no socket opens. JSON text frames: `{ "type": "…", "data"?: …, "requestId"?: "…", "ts": 1700000000000 }` from the server; clients send `{ "type": "…", "requestId"?: "…", …fields }`.

**Client to server**

| type | fields | Notes |
|---|---|---|
| `subscribe` / `unsubscribe` | `resource`, `id?` | Answered with `subscribed` / `unsubscribed` (or `error`) carrying your `requestId` |
| `ping` | - | Answered with `pong` |

Resources: `devices` (every device you may see), `device` + `id` (one Thing id), `area` + `id` (an HA area id), `commands` (your commands; admins: all), `household` (mode changes for everyone, `insights.changed` for members, connection health for admins), `alerts` (members and admins; only alerts about devices you can see), `notifications` (your own). `activity` is reserved and answers `unknown_resource`. Subscribing to a device you cannot see answers `not_found`, exactly like one that does not exist.

**Server to client**

| type | data |
|---|---|
| `hello` | `{ userId, role, resources }`, sent once on connect |
| `subscribed`, `unsubscribed`, `pong` | acknowledgement |
| `error` | `{ code, message, resource?, id? }`: `bad_message`, `unknown_message_type`, `unknown_resource`, `validation_error`, `not_found`, `too_many_subscriptions`, `rate_limited` |
| `entity.updated` | `{ thingId, entityId, role, availability, values, lastChanged, facet? }`. `values` are application-level (brightness in %, lock state, ...); `facet` is the resolved meaning (`{ key, value, label, ambiguous, sensitive, name, ... }`) when the entity is a facet |
| `entity.availability_changed` | `{ thingId, entityId, availability }` |
| `devices.changed` | `{ reason: "inventory" \| "overrides" \| "permissions" }`. The set or shape of devices changed (resync, rename, hide, merge, split, policy). Refetch `GET /devices` |
| `command.created`, `command.authorized`, `command.dispatched`, `command.accepted`, `command.confirmed`, `command.failed`, `command.timed_out`, `command.cancelled` | the command in public form (same as `GET /commands/:id`) |
| `connection.connected`, `connection.disconnected` | `{ connectionId, status, error? }`, admins subscribed to `household` |
| `household.mode_changed` | `{ mode, previous, changedBy }`, everyone subscribed to `household` |
| `presence.changed` | `{ userId \| null, personEntityId, home }` when a person arrives or leaves; members and admins subscribed to `household` (not guests) |
| `insights.changed` | `{}`; refetch `GET /insights` (members and admins subscribed to `household`) |
| `alert.created`, `alert.cleared` | the alert (as `GET /alerts`), to members and admins subscribed to `alerts` who can see the device |
| `notification.created` | the notification, to its recipient subscribed to `notifications` |

Rules the server enforces on every event: you only receive updates for entities you may see (guests: allowed devices only; denied devices never), diagnostics and config entities and hidden devices are not pushed, and commands go only to the person who sent them (and admins). Roles are re-read every couple of seconds, and sockets whose session ended are closed by a 15 s sweep (`4401`).

Limits: 10 connections per user (`4429`), 50 subscriptions per socket, 60 messages per 10 s, 16 KB per message, and a client with more than 1 MB queued is dropped (`1013`). On shutdown the server closes sockets with `1001`. There is no replay: after a reconnect, resubscribe and refetch over REST.

**Command objects** (REST and WebSocket) leave out internal ids and never carry Home Assistant's own error text: a `ha_rejected` failure always reads "Home Assistant refused the command".

## Authorization summary

| Capability | Admin | Member | Guest |
|---|---|---|---|
| View & control devices | all | all (minus denied) | allow-listed only, while access is valid |
| Unlock / disarm | yes† | policy | policy† |
| Scenes, routines, automations | create/edit | create/edit | run if allowed |
| Household mode | change | change | no |
| Members, invitations, roles | manage† | view | no |
| HA connection, backups, updates, admin, support | manage† | no | no |
| Energy, history, insights, activity | all | all | no |
