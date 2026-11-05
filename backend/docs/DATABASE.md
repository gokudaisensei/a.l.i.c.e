# Alice Backend — Database

Status: draft v1. SQLite (WAL, `foreign_keys=ON`) via Drizzle. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Conventions

- Primary keys: ULID `text` (sortable, no coordination). Prefix by type in code only (`cmd_…`, `usr_…`).
- Timestamps: `integer` unix ms (`created_at`, `updated_at`); optional ones nullable.
- Every household-owned table has `household_id` (FK, indexed) and every query filters on it.
- JSON columns use `text(..., {mode: "json"})` and are validated by TypeBox at the edge.
- Enums are text with a CHECK via Drizzle `enum`; values live in code.
- Secrets (HA tokens) are encrypted with an env key; session tokens are stored as SHA-256 hashes.
- Soft delete (`deleted_at`) only where history must survive (devices, automations); otherwise hard delete.
- **HA data is a projection.** Tables prefixed `ha_` can be dropped and rebuilt from HA at any time. We do not store sensor time series (history comes from HA).

## Entity overview

```
users ─< passkeys
users ─< sessions
households ─< household_members >─ users
households ─< invitations
households ─< ha_connections ─< ha_areas / ha_devices / ha_entities ─< ha_entity_capabilities
households ─< thing_overrides, thing_links, entity_overrides, suggestions, alias_index
households ─< groups ─< group_members
households ─< scenes, routines ─< routine_actions, automations
households ─< commands ─< command_attempts
households ─< activity_events, notifications, audit_log, jobs, config_jobs
```

## Identity

| Table | Columns (key ones) | Notes |
|---|---|---|
| `users` | id, display_name, avatar_color, locale, created_at | Profile; preferences in `user_preferences` |
| `user_preferences` | user_id PK, quiet_hours json, push_enabled, extra json | Quiet hours / push toggles from the UI |
| `passkeys` | id (credential id), user_id, public_key, counter, transports json, device_label, created_at, last_used_at | WebAuthn credentials; ≥1 per user |
| `sessions` | id, user_id, token_hash UNIQUE, created_at, expires_at, last_seen_at, revoked_at, user_agent, last_step_up_at, restricted | Revocable; `last_step_up_at` backs step-up checks; `restricted` marks recovery sessions that may only add a passkey |
| `recovery_codes` | id, user_id, code_hash, used_at | One-time codes, shown once |
| `webauthn_challenges` | id, user_id?, challenge, purpose, expires_at | Short-lived, swept by job |

## Households and access

| Table | Columns | Notes |
|---|---|---|
| `households` | id, name, timezone, created_at | One row at first sign-up |
| `household_members` | id, household_id, user_id, role (`admin`/`member`/`guest`), status, expires_at?, joined_at, UNIQUE(household_id, user_id) | `expires_at` for time-limited guests |
| `invitations` | id, household_id, code_hash, role, guest_access_ms?, created_by, created_at, expires_at, used_by?, used_at?, revoked_at? | Code shown once, format `MAPLE-482913-KITE-7Q4X` (~50 bits); guests get `guest_access_ms` of access after joining |
| `household_settings` | household_id PK, mode (`home`/`away`/`night`/`vacation`), mode_changed_at, mode_changed_by, settings json | Current household mode |
| ~~`role_permissions`~~ | | Not a table: the RBAC matrix is the code constant `ROLE_PERMISSIONS` (`modules/permissions/permissions.ts`). Revisit if admins ever need custom roles |
| `device_policies` | id, household_id, connection_id, entity_id, subject_type (`role`/`member`), subject_id, effect (`allow`/`deny`), operations json? | Device-level overrides, e.g. guest can see/control a device; deny beats allow |
| `sensitive_operation_rules` | id, household_id, domain, action, device_class (`''` = any), sensitive (bool), updated_by, updated_at, UNIQUE(household_id, domain, action, device_class) | Admin changes to which device operations need step-up. Code defaults (`lock.unlock`, `lock.open`) apply when no row matches; a row with `sensitive = false` switches a default off. The most specific match wins (device_class beats any) |

## Home Assistant projection

| Table | Columns | Notes |
|---|---|---|
| `ha_connections` (implemented) | id, household_id, name, base_url, operational_token_enc, admin_token_enc?, status, last_connected_at, last_error, ha_version, created_at, updated_at | Admin token is only decrypted by the config-worker |
| `ha_areas` | id, connection_id, ha_area_id, name, floor?, UNIQUE(connection_id, ha_area_id) | Rooms |
| `ha_devices` | id, connection_id, ha_device_id, area_id?, name, manufacturer, model, hw_label, via_device_id?, identifiers json, connections json, UNIQUE(connection_id, ha_device_id) | `hw_label` is the "Hue Bridge" style text; `via_device_id`, `identifiers`, `connections` drive hub/child links and cross-integration merging |
| `ha_entities` | id, connection_id, entity_id, device_id?, area_id?, domain, name, entity_category?, device_class?, has_entity_name, translation_key?, platform?, role, name_clean, aliases json, state, attributes json, availability, last_changed, last_updated, last_synced_at, UNIQUE(connection_id, entity_id) | Latest-state projection plus derived classification: `role` (`primary`/`control`/`facet`/`sensor`/`diagnostic`/`config`), `name_clean`, `aliases`. Derived columns are recomputed on every sync; overrides live in `entity_overrides` |
| `ha_entity_capabilities` | entity_id (FK), capability, operations json, metadata json, PK(entity_id, capability) | Derived, rebuilt on discovery |
| `entity_settings` | connection_id, entity_id (HA id string, no FK), display_name?, power_limit_w?, voice_exposed, guest_visible, hidden | PK(connection_id, entity_id). Application overrides that survive resync |

## Things: overrides and suggestions

A **Thing** is one card per physical device, computed from the projection plus these overrides (see ARCHITECTURE.md, "Things"). Nothing here is authoritative about HA; all keys are HA id strings so a projection rebuild never orphans them.

| Table | Columns | Notes |
|---|---|---|
| `thing_overrides` | id, household_id, connection_id, ha_device_id? , root_entity_id?, display_name?, hidden, area_override?, updated_by, updated_at | One row per Thing the user customised. A Thing is identified by an HA device id, or by `root_entity_id` for entities with no device |
| `thing_links` | id, household_id, connection_id, kind (`merge`/`split`), from_ref, into_ref, created_by, created_at | Manual merge of two devices (or loose entities) into one Thing, or split an entity out of its device's Thing. Beats automatic grouping |
| `entity_overrides` | connection_id, entity_id, role?, display_name?, attach_to_entity_id?, hidden?, PK(connection_id, entity_id) | Manual role, name and facet attachment (e.g. force "Camera shutter" to attach to the camera) |
| `suggestions` | id, household_id, kind (`name`/`role`/`merge`/`attach`), subject json, proposal json, confidence, source (`heuristic`/`llm`), status (`pending`/`accepted`/`rejected`), created_at, decided_by?, decided_at? | Smart-layer output. Accepting a suggestion writes the matching override; rejected ones are remembered so they are not re-proposed |
| `alias_index` | household_id, connection_id, entity_id, alias, weight, source (`derived`/`user`) | Search terms and synonyms for resolving "kitchen lamp" to a Thing; rebuilt from names, areas and user aliases |

**Thing ids** are not stored as rows of their own. They are stable, derived ids: a hash of `(connection_id, ha_device_id)` for device-backed Things, or of `(connection_id, entity_id)` for loose entities, and a merge keeps the id of its first member. That keeps them stable across resyncs.

Precedence everywhere: **user override, then computed value, then HA source value.**

## Application features

| Table | Columns | Notes |
|---|---|---|
| `favorites` | user_id, connection_id, entity_id, position, PK(user_id, connection_id, entity_id) | Per user |
| `groups` | id, household_id, name, icon | Logical device groups |
| `group_members` | group_id, connection_id, entity_id, PK(group_id, connection_id, entity_id) | |
| `scenes` | id, household_id, name, icon, targets json, ha_scene_id?, sync_status, created_by | `targets`: entity → desired state |
| `routines` | id, household_id, name, icon, schedule json?, ha_script_id?, sync_status, created_by | Reusable action sequences |
| `routine_actions` | id, routine_id, position, type, target, params json | Ordered |
| `automations` | id, household_id, name, definition json, enabled, ha_automation_id?, sync_status, last_run_at, created_by, deleted_at | `definition`: trigger, conditions, actions (our schema, versioned) |

## Operations

| Table | Columns | Notes |
|---|---|---|
| `commands` (implemented) | id, household_id, connection_id, entity_id, domain, action, parameters json, requested_state json, actual_state json?, state, requested_by, source (`user`/`automation`/`ai`/`job`), ha_context_id?, failure_reason?, created_at, dispatched_at?, accepted_at?, finished_at?, timeout_at | Implemented in Run 7; `failure` is json `{code, message}`, `confirmed_by` is `state`/`already`/`unobservable`, `requested_by` is not a foreign key so history outlives users |
| `command_attempts` | id, command_id, attempt, state, result json?, started_at, finished_at | Retries |
| `activity_events` | id, household_id, actor_type, actor_id?, entity_id?, kind, summary, payload json, created_at | Timeline feed; index (household_id, created_at DESC) |
| `activity_reads` | user_id, household_id, last_seen_at | "New since last visit" |
| `notifications` | id, household_id, user_id, kind, title, body, payload json, created_at, read_at? | |
| `notification_deliveries` | id, notification_id, channel (`push`/`in_app`), status, attempts, sent_at? | |
| `push_subscriptions` | id, user_id, platform, token, created_at | Web push / FCM / APNs |
| `audit_log` | id, household_id, actor_type, actor_id, action, resource, detail json, created_at | Security audit; append-only |
| `support_sessions` | id, household_id, granted_by, scopes json, started_at, ends_at, revoked_at | Scoped, time-limited support access |

## Infrastructure

| Table | Columns | Notes |
|---|---|---|
| `jobs` | id, type, payload json, status (`pending`/`running`/`completed`/`failed`/`retry`/`dead`), attempts, max_attempts, run_at, locked_at, locked_by, idempotency_key UNIQUE?, result json?, created_at, started_at, completed_at | Persistent queue |
| `config_jobs` | id, household_id, connection_id, operation, payload json, status, result json?, requested_by, created_at, completed_at | Validated config operations, consumed by the config-worker only |
| `backup_records` | id, kind (`app`/`ha`), destination_kind (`ha`/`nas`/`upload`), destination_ref, size_bytes, created_at, verified_at?, verify_note, status | Restore-test result per backup |
| `update_records` | id, from_version, to_version, state (`available`/`scheduled`/`installing`/`done`/`failed`), trigger (`manual`/`auto`/`emergency`), reason?, requested_by?, scheduled_for?, started_at?, finished_at? | `reason` is required for `emergency` |
| `application_settings` | key PK, value json, updated_at | Instance-wide config, e.g. `updates.auto` `{enabled, windowStart, windowEnd}`, `backups.destination` |

## Indexes worth having from day one

- `sessions(token_hash)`, `sessions(user_id)`
- `household_members(user_id)`
- `ha_entities(connection_id, domain)`, `ha_entities(area_id)`
- `commands(household_id, created_at)`, `commands(state)` (find in-flight for timeouts)
- `activity_events(household_id, created_at)`
- `notifications(user_id, read_at)`
- `jobs(status, run_at)`

## Migration and backup practice

- Drizzle Kit generates SQL migrations in `drizzle/`, applied at startup by `src/core/database/migrate.ts` (and by `bun run db:migrate`).
- Backups use `VACUUM INTO` / SQLite online backup, not file copy of a live WAL database.
- `ha_*` tables can be truncated safely; discovery repopulates them on next connect. Application data that must survive (`entity_settings`, `thing_overrides`, `thing_links`, `entity_overrides`, `favorites`, `group_members`, `device_policies`) references entities by `(connection_id, entity_id)` strings, not by `ha_entities` row ids, so a rebuild never orphans it.

## Implementation status

Implemented (migration `0005`, Run 14 adds `backup_records`: kind app/ha, destination, ref, size, sha256, encrypted, schema version, status, trigger, verify status and note; backup settings live in `household_settings.settings.backups`; migration `0004`, Run 13 adds `activity_events` and `activity_reads`; migration `0003`, Run 11 adds `routine_runs`, `config_jobs`, `config_worker_heartbeat`, `automations`, `automation_runs`, `alerts`, `notifications`, `insight_dismissals`, `push_subscriptions`, `person_links` and sync/voice, `compiled_hash`, `urgent`, `push_status` columns on `scenes`, `routines` and `entity_settings`; migration `0000`, Run 7; migration `0002`, Run 10 adds `favorites`, `groups`, `group_members`, `entity_settings`, `scenes`, `routines`; migration `0001`, Run 8 adds `ha_connections`, `thing_overrides`, `entity_overrides`, `thing_links`): `users`, `user_preferences`, `passkeys`, `sessions`, `recovery_codes`, `webauthn_challenges`, `households`, `household_members`, `invitations`, `household_settings`, `device_policies`, `sensitive_operation_rules`, `commands`, `audit_log`, `ha_connections`, `thing_overrides`, `entity_overrides`, `thing_links`, `favorites`, `groups`, `group_members`, `entity_settings`, `scenes`, `routines`, `routine_runs`, `config_jobs`, `config_worker_heartbeat`, `automations`, `automation_runs`, `alerts`, `notifications`, `insight_dismissals`, `push_subscriptions`, `person_links`, `activity_events`, `activity_reads`, `backup_records` (`household_settings.mode` holds the household mode). `ha_connections.admin_token_enc` holds the admin token sealed with a public key (format `s1.`); only the config-worker can open it. Everything else in this document (HA projection, Things overrides, features, notifications, jobs, backups, updates) is still design only; see LIMITATIONS.md L04.
