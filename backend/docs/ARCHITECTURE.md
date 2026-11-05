# Alice Backend — Architecture

Status: draft v1. Companion docs: [DATABASE.md](./DATABASE.md), [API.md](./API.md).

## 1. Decisions

| Topic | Decision |
|---|---|
| Shape | Modular monolith (Bun + Elysia), plus one separate **config-worker** process |
| HA support | Any Home Assistant reachable by URL + long-lived token (HAOS, Container, Core) |
| HA tokens | Two credentials per connection: *operational* (state, service calls) and *admin* (config), the admin one held only by the config-worker |
| Households | One household at first sign-up; every table and query is `household_id`-scoped (multi-ready) |
| Realtime to clients | Elysia WebSocket `/ws`, per-resource subscriptions, permission-filtered |
| Database | SQLite (WAL) via Drizzle |
| Auth | Passkeys (WebAuthn), DB-backed revocable sessions |
| Device model | Users see **Things** (one card per physical device), not raw HA entities. Roles, names and grouping are deterministic defaults that user overrides beat; any LLM assist is suggestion-only and off by default |
| Out of scope for now | OpenTelemetry, Docker deployment, AI implementation, multi-instance behaviour |

## 2. Ownership boundaries

Home Assistant is the source of truth for devices and their state. The backend owns people, permissions, application data and orchestration.

| Concern | Home Assistant | Backend |
|---|---|---|
| Integrations, device comms | Owns | — |
| Entity state | Source of truth | Disposable projection |
| Device control | Executes | Authorizes, orchestrates, verifies |
| Scenes, scripts, automations | Executes | Defines, compiles, manages |
| Users, auth, households, permissions | — | Owns |
| Notifications, activity, insights | Raw events / recorder | Owns logic and delivery |
| History, energy | Recorder (long-term data) | Queries and aggregates |
| Backups | HA backup | Application backups and orchestration |

**Rule:** the backend never keeps a competing smart-home state machine. After a restart it rebuilds the projection from HA.
**Rule:** only the HA module talks to Home Assistant. Every other module uses the `HomeAssistantGateway` interface.

## 3. Component view

```
 Web / Mobile (Capacitor)
        │  REST /api/v1   WS /ws
 ┌──────▼─────────────────────────────── backend (Elysia) ───────────────┐
 │ plugins: auth · household scope · permission guard · rate limit       │
 │ ┌─ domain modules ───────────────────────────────────────────────┐   │
 │ │ auth users households memberships permissions devices areas    │   │
 │ │ groups favorites scenes routines automations modes activity    │   │
 │ │ notifications energy insights history backups updates admin ai │   │
 │ └───────────────┬────────────────────────────────────────────────┘   │
 │        Command pipeline      Event bus (in-process, interface)       │
 │                 │                  ▲                                  │
 │   ┌─────────────▼──────────────────┴──────────┐   ┌── job runner ──┐ │
 │   │ HA module: gateway · connections ·        │   │ SQLite queue   │ │
 │   │ discovery · state cache · capabilities ·  │   └────────────────┘ │
 │   │ command executor/verifier · normalizer    │                      │
 │   └─────────────┬─────────────────────────────┘                      │
 └─────────────────┼────────────────────────────────────────────────────┘
        operational│token                        ▲ validated config jobs
                   ▼                             │ (job table / local IPC)
            Home Assistant ◄──── admin token ── config-worker (separate process)
```

## 4. Source layout (target)

```
backend/src/
  core/        config, database, errors, events, logging, security, lifecycle
  modules/     one folder per domain (routes, service, schemas, types)
    home-assistant/
      clients/ connections/ discovery/ state/ commands/ capabilities/ events/
      things/    (role classifier, name cleaner, grouping, Thing builder, alias index)
  realtime/    ws gateway, subscriptions, broadcaster
  workers/     job-runner (in-process jobs)
backend/config-worker/   separate entry point, its own admin credential
backend/docs/
```

Dependency rule: `core` depends on nothing; modules depend on `core` and on other modules only through their `index.ts` exports; nothing but `modules/home-assistant` imports `home-assistant-js-websocket`.

## 5. Home Assistant module

**Gateway interface** (all other modules depend on this, tests mock it):
`connect`, `disconnect`, `status`, `getEntities`, `getDevices`, `getAreas`, `getServices`, `callService`, `subscribeStateChanges`, `subscribeEvents`.

**Connection manager.** One connection object per `ha_connections` row. Handles auth, reconnect with exponential backoff and jitter, health, and re-subscribing after reconnect. Emits `connection.connected/disconnected`.

**Discovery.** On connect, load entity, device and area registries plus services into SQLite; keep current via registry-update events. Reconcile periodically.

**State cache.** In-memory map of the latest `EntityProjection` per entity; optionally persisted for fast startup. Never authoritative.

**Capability registry.** Capabilities are derived from entity domain, attributes and `supported_features` (not hardcoded per domain). They drive UI controls, command validation, permissions and AI tools.

**Things (device model).** Home Assistant names and entities are not user-friendly (`friendly_name` often includes the device, area, integration artifacts and numeric suffixes), and one physical device exposes many entities. Example: a custom-flashed Echo Show running as an ESPHome device exposes a speaker, media player, camera, mic-mute switch and camera-shutter state as separate entities. The shutter state is not a device at all; it is a property of the camera. The UI works with **Things**, built by a pure `buildThings(inventory, overrides)` step on top of `buildInventory` (deterministic, fixture-tested, no I/O). Commands still target entities; only presentation, naming and permissions work at the Thing level.

1. **Structural grouping.** Group by HA `device_id`. Use `via_device_id` for hub/child links (bridge and bulbs). Merge devices that share a hardware identifier in the device registry `connections`/`identifiers` (for example the same MAC through two integrations). Entities with no device (helpers, templates, YAML) are their own Thing unless a rule or the user says otherwise.
2. **Entity roles.** Every entity gets one role from registry flags (`entity_category`, `hidden_by`, `disabled_by`), `device_class`, domain and, as a last resort, name tokens:

   | Role | Examples | Shown as |
   |---|---|---|
   | `primary` | media_player, camera, light, climate, lock, fan, cover | The Thing's card and main controls |
   | `control` | mic-mute switch, volume number, mode select | Controls on the card |
   | `facet` | camera shutter state, "mic muted", privacy state | A property of the primary (`camera.privacy_shutter = closed`), never its own tile |
   | `sensor` | temperature, power, humidity | Readings on the card |
   | `diagnostic` / `config` | Wi-Fi signal, uptime, IP address | Hidden under "Details" |

   A facet that cannot be attached to a primary falls into Details rather than the main list. Sensitive facets (camera shutter, mic mute) are flagged for permissions.
3. **Names.** Three fields: source name (HA), computed `display_name`, user override; precedence override, computed, source. Cleaning is deterministic: strip the device-name prefix when `has_entity_name` is set, strip the area-name prefix ("Living room Floor lamp" in the Living room becomes "Floor lamp"), remove `_2`/`None` artifacts, fix casing, de-duplicate. The cleaner also emits search aliases (including synonym groups such as light/lamp/bulb) into an alias index used by search, voice and AI to resolve phrases like "kitchen lamp".
4. **Suggestions (smart layer).** Local heuristics (tokenizing, fuzzy matching, synonyms) are always on. An optional background job may use an LLM or embeddings for the ambiguous leftovers (orphan entities, helpers, odd names). It writes proposals to a `suggestions` table that an admin accepts or rejects; accepted ones become overrides. It never regroups silently, never runs on the control path, sends only entity ids, names and attributes, can use a local model, and is off by default.
5. **Overrides.** Users can rename, hide, re-role, merge and split. They are stored in app tables keyed by `(connection_id, entity_id)` or HA device id, so they survive resync. Every automatic decision is a default that an override beats, because heuristics will sometimes be wrong.

Capabilities are aggregated per Thing for the UI and for permissions. Guest visibility and device policies apply at Thing level and facets inherit them.

**Command executor.** The only path for device control (UI, automations, AI, background jobs):

```
request → authenticate → authorize → validate capability → create command
        → dispatch to HA → HA result → verify desired state → notify clients
```

Lifecycle: `pending → authorized → dispatched → accepted → confirmed`, with `failed`, `timed_out`, `cancelled`. Implemented in `modules/devices/command-lifecycle.ts`.
Confirmation compares observed state with the *desired* state within a timeout. It does not just accept the next `state_changed`, because a person may press a physical switch at the same time. Each command stores requester, HA context id, duration, failure reason and attempts.

## 6. Events

1. **Ingestion:** raw HA events (`state_changed`, registry updates, `call_service`).
2. **Normalization:** into application events (`entity.state_changed`, `entity.availability_changed`, `registry.updated`, …) with household id and HA context.
3. **Bus:** in-process pub/sub behind an `EventBus` interface (swappable for Redis/NATS later). Consumers: state cache, activity, notifications, automation triggers, realtime broadcaster.

## 7. Realtime protocol (`/ws`)

Client → server: `subscribe` / `unsubscribe` on `{resource, id}` (household, area, device, commands, notifications, activity).
Server → client: `entity.updated`, `entity.availability_changed`, `command.created|dispatched|accepted|confirmed|failed|timed_out`, `automation.triggered|updated`, `notification.created|read`, `connection.connected|disconnected`, `household.mode_changed`, `activity.created`.
The server authorizes every subscription and filters each event by the member's permissions (including guest device visibility).

## 8. Security model

- **Authentication:** passkeys through a vetted library (`@simplewebauthn/server`); sessions in the DB (hash of token stored, expiry, revocation, device label).
- **Step-up:** sensitive actions (unlock, disarm, invite, change roles, support access, backups restore) require a passkey assertion newer than N minutes (the UI already shows "Unlocking always needs your passkey").
- **Authorization:** household RBAC (admin / member / guest) plus per-device policy. Guests can be time-limited and see only allow-listed devices. All checks run in the backend.
- **HA credentials:** stored encrypted at rest (key from env). The operational token goes in the main process. The admin token is read only by the config-worker.
- **No passthrough:** there is no "call any HA service" endpoint. Clients reach only defined application operations.
- **Audit:** security-relevant actions write to `audit_log`; support access sessions are scoped, time-limited and logged.
- **Rate limiting** on auth and command endpoints.

## 9. Config-worker (separate process)

- Holds the admin HA token. The main process does not.
- Consumes `config_jobs` (validated by the main process): create/update/delete scene, script, automation, helper; sync voice exposure.
- Accepts a fixed set of operations only, never raw WebSocket commands. Logs every operation to `audit_log`; returns results through the job table.
- Communication starts as the shared SQLite job table, so there is no network surface between the processes. It can move to a Unix socket later.

## 10. Routines, scenes, automations

- **Scene:** named target states, compiled to an HA scene.
- **Routine:** reusable ordered action sequence, compiled to an HA script.
- **Automation:** trigger + conditions + actions in our schema, validated and permission-checked, compiled to an HA automation by the config-worker. HA executes it, so it keeps running when the backend is down.
- **Household modes** (Home, Away, Night, Vacation) are household state; automations can condition on them and a mode change can run a routine. Mode *suggestions* are deterministic insights (presence, time of day, lock state).
- We keep a mapping between our ids and HA entity ids.

## 11. Background jobs

Persistent `jobs` table with status, attempts, backoff, timeout, idempotency key and dead-letter state. Used for backup creation and restore-testing, inventory reconciliation, energy aggregation, automation compilation requests and update steps.

## 12. Frontend-driven feature notes

Features the current mock UI needs from the backend:

- Presence per person (from HA `person` entities); "who is home".
- Guest access with expiry and per-device visibility.
- Per-device flags: favorite (per user), voice exposure (syncs to HA Assist exposure), guest-visible.
- Plug power limits with alerts at 90%, and "left open" alerts for contacts.
- Command undo, implemented as a compensating command.
- Activity feed with "new since last visit" counts per user.
- Invitations (code, role, expiry) and account recovery.
- Backups with restore-test verification, destinations (local, NAS), and update flow (ready → scheduled → installing → done).
- Support access sessions and operator audit log.

## 13. Testing

`bun test`; in-memory SQLite per test. HA-dependent tests run against the mock HA in `dev/ha` (port 8123, token in `.env.test`). Unit tests mock the gateway.

## 14. Build order

1. HA Gateway, connections, discovery, state cache, capabilities, event normalizer (done, against the mock HA)
2. **Things:** extend registry fetch (`entity_category`, `device_class`, `has_entity_name`, `translation_key`, device `connections`/`identifiers`/`via_device_id`), role classifier, name cleaner, grouping, `buildThings`; fixtures including an ESPHome Echo-style device and the demo HA
3. Command executor (stub authorizer), using Thing-level targeting and facets
4. Identity: users, passkeys, sessions, households, memberships, permissions; replace the stub authorizer
5. Overrides (rename/hide/re-role/merge/split), Things API, `/ws` realtime, areas/groups/favorites APIs; alias index and fuzzy resolver
6. Scenes, routines, modes, config-worker, automations
7. Activity, notifications, energy, history, insights
8. Backups, updates, admin; then AI (tool layer over the command pipeline with risk classes) and the LLM suggestion job

## 15. Resolved questions

- **Emergency deploy** (frontend "Emergency deploy" sheet): an admin installs an available update immediately, skipping the nightly update window. Requires a reason (min 8 chars), the typed confirmation word `DEPLOY`, and a step-up passkey. It writes to `audit_log` and `update_records` (`trigger = emergency`, with the reason), and is shown in the household and operator logs.
- **Backups:** Home Assistant runs as a Docker container on a Raspberry Pi, and backups go to the HA host first. Destinations sit behind a `BackupDestination` interface with kinds `ha` (default, via HA's backup WebSocket commands), `nas` (mounted share) and `upload` (remote object store), so NAS and upload targets can be added later without touching callers.
- **Updates:** the app does not update itself by default. An **auto-update setting** (on/off, plus the nightly window, default 02:00 to 04:00 local) is stored in `application_settings`. When on, a scheduled job installs a newly available update inside the window. Manual install and emergency deploy remain available.
