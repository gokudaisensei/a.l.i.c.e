# Alice Backend — API

Status: draft v1. Base path `/api/v1`. JSON everywhere. OpenAPI is generated at `/docs`. Realtime on `/ws`. See [ARCHITECTURE.md](./ARCHITECTURE.md).

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
| `POST /users/me/push-subscriptions`, `DELETE …/:id` | any | Register device for push |

## Household, members, invitations, permissions

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /household`, `PATCH /household` | A (read: all) | Name, timezone |
| `GET /household/members` | A,M | Members with role, presence, expiry |
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

## Devices, capabilities, commands

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /devices?area=&type=&q=&favorite=` | A,M,G (filtered) | Inventory with current state and capabilities |
| `GET /devices/:id` | A,M,G | Detail, current projection |
| `GET /devices/:id/capabilities` | A,M,G | Capabilities and allowed operations |
| `PATCH /devices/:id/settings` | A | Display name, power limit, voice exposure, guest visibility, hidden |
| `POST /devices/:id/commands` | A,M,G (per policy); `†` for lock/unlock-type operations | `{ action, parameters }` → `202 Command` |
| `GET /devices/:id/activity` | A,M | Recent events for the device |
| `GET /commands/:id` | owner or A | Command with lifecycle state |
| `POST /commands/:id/cancel` | owner or A | Cancel while `pending`/`authorized` |
| `POST /commands/:id/undo` | owner or A | Compensating command from `actual_state` |
| `GET /commands?state=&limit=` | A | Command log |

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

## Areas, groups, favorites

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /areas`, `GET /areas/:id`, `GET /areas/:id/devices` | A,M,G (filtered) | Rooms and their devices |
| `GET /groups`, `POST /groups` | A,M | List / create |
| `PATCH /groups/:id`, `DELETE /groups/:id` | A,M | Edit / delete |
| `POST /groups/:id/commands` | per member devices | Fan-out command; returns array of commands |
| `GET /favorites`, `PUT /favorites` | any | Own ordered favorites (`PUT` replaces the list) |

## Scenes, routines, automations, modes

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /scenes`, `POST /scenes` | A,M | List / create (compiled to HA via config-worker) |
| `PATCH /scenes/:id`, `DELETE /scenes/:id` | A,M | |
| `POST /scenes/:id/activate` | A,M (G if allowed) | Runs as commands per target; returns `202` with command ids |
| `GET /routines`, `POST /routines`, `PATCH /routines/:id`, `DELETE …` | A,M | Reusable action sequences |
| `POST /routines/:id/execute` | A,M | Run now |
| `GET /automations`, `POST /automations`, `GET /automations/:id` | A,M | |
| `PATCH /automations/:id`, `DELETE /automations/:id` | A,M | |
| `POST /automations/:id/enable` / `disable` | A,M | |
| `POST /automations/:id/test` | A,M | Dry run: returns the plain-language summary and the actions that would run; changes nothing |
| `GET /automations/:id/runs` | A,M | Recent runs |
| `GET /household/mode` | any | `{ mode, changedAt, changedBy, suggestion? }` |
| `PUT /household/mode` | A,M (`†` to leave Away/Vacation for Home if configured) | `{ mode: "home"|"away"|"night"|"vacation" }` |

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

Triggers (from the UI): `arrive, leave, time, sunset, door_opens, motion, power_over_limit`. Conditions: `dark, someone_home, days (any|weekdays|weekends), mode`. Actions: `turn_on, turn_off, set_brightness, set_temperature, lock, notify, run_scene`. The server renders the plain-language summary (`"When someone gets home, if it is dark, …"`) so clients do not have to.

## Activity, notifications, alerts

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /activity?cursor=&kind=` | A,M | Household timeline |
| `POST /activity/seen` | any | Update last-seen marker; clears "new" count |
| `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | A,M | In-app notifications |
| `GET /alerts` | A,M | Active alerts (power near limit, door left open, backup unverified), with acknowledge |
| `POST /alerts/:id/ack` | A,M | Acknowledge / snooze |

## Energy, history, insights

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /energy/summary` | A,M | Current draw, today so far |
| `GET /energy/history?from=&to=&resolution=hour|day` | A,M | Aggregated consumption |
| `GET /energy/devices` | A,M | Per-device consumption and limits |
| `GET /history/entities/:id?from=&to=` | A,M | State history proxied from HA's recorder (read-only) |
| `GET /insights` | A,M | Deterministic insights (mode suggestions, anomalies) |
| `POST /insights/:id/dismiss` | A,M | Snooze a suggestion |

## AI (later)

| Method & path | Perm | Purpose |
|---|---|---|
| `POST /ai/chat` | A,M | Conversational control; tool calls flow through the command pipeline with risk classes |
| `POST /ai/plans/:id/confirm` | A,M† | Confirm a planned multi-step action |

## Backups, updates, administration

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
| `GET /health` | public | Liveness (already implemented) |

## WebSocket `/ws`

Authenticate with the same session cookie during the upgrade. JSON text frames: `{ "type": "…", "id"?: "…", "data"?: … }`.

**Client → server**

| type | data | Notes |
|---|---|---|
| `subscribe` | `{ resource, id? }` | `resource`: `household`, `area`, `device`, `commands`, `notifications`, `activity`, `alerts` |
| `unsubscribe` | same | |
| `ping` | — | Server replies `pong`; also used for keepalive |

**Server → client**

| type | data |
|---|---|
| `subscribed` / `error` | confirmation or `{code,message}` (e.g. `forbidden`) |
| `entity.updated` | `{ entityId, state, attributes, lastChanged }` |
| `entity.availability_changed` | `{ entityId, availability }` |
| `command.created`, `command.dispatched`, `command.accepted`, `command.confirmed`, `command.failed`, `command.timed_out`, `command.cancelled` | Command object |
| `automation.triggered`, `automation.updated` | `{ id, … }` |
| `notification.created`, `notification.read` | Notification |
| `activity.created` | Activity event |
| `alert.created`, `alert.cleared` | Alert |
| `household.mode_changed` | `{ mode, changedBy }` |
| `connection.connected`, `connection.disconnected` | HA connection status (admins) |

Every subscription is authorized, and every event is filtered by the member's permissions (guests never receive events for devices they cannot see). On reconnect the client re-subscribes and fetches a fresh snapshot via REST, so there is no event replay requirement in v1.

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
