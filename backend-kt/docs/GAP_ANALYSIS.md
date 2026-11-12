# Phase 0–6 Gap Analysis: What to Cover vs. What Depends on Later Phases

## GAPS TO COVER (phases 0–6 scope)

### Phase 0 — Foundation
- Schema migrations (user_version, .sqm) — K03
- Typed app events (core/events/app-events.ts)
- Sealed secrets (core/security/sealed.ts)
- parseKey (core/security/secrets.ts)
- Formatter/linter (K11)
- Structured logging / correlation id (K15)

### Phase 1 — Auth
- Revoke-all sessions on credential change
- Per-account lockout
- Require UV at login when household policy says so (L39)

### Phase 2 — Households/Permissions
- Household modes (mode change service + controller + table)
- Presence service (full, person_links table)
- Groups/group_members tables (schema)
- Favorites controller
- Users service/controller
- ha_connections table

### Phase 3 — HA Gateway
- HA reconnect with backoff+jitter
- REST client (basic)
- Connection manager (full multi-connection)
- getHistory/getStatistics (real HA)
- Per-domain normalizer maps (L12)
- Event pipeline split (L09)
- Per-consumer throttling
- Persist ha_* projection (L04)
- One HA connection per household (unique index, L49)
- Test doubles (controllable-delay fake, restart test, reset endpoints, anonymised fixtures)
- Connection service, sync service (basic)
- Config api, config jobs, config ops (basic)
- Drift detection (basic)
- Managed connection
- Mode mirror (basic)
- Sealed secrets, parseKey
- Thing overrides/links DB persistence
- Entity-less hub Things (L19)
- DELETE/unmerge endpoint (L51)
- Incremental rebuild (L22)
- Facet values (describeFacet, describeThingFacets)
- Presentation (presentThing, matchesQuery)
- Facet polarity suggestions (L01)

### Phase 4 — Things
- Facet values
- Presentation
- Entity-less hub Things
- DELETE/unmerge
- Incremental rebuild
- Thing overrides DB
- Thing links DB

### Phase 5 — Commands
- Per-entity serialization (bounded queue)
- Coalescing (L57)
- command_attempts table + retry
- Interrupted recovery on boot
- Late confirmation (sustained watching)
- Idempotency keys (HTTP + DB)
- Undo dispatch (inverse command)
- Group commands
- Command events with requestedState

### Phase 6 — Devices HTTP
- Per-caller visibility pruning
- Favorites filter on GET /devices
- decorate() (favorite flag, settings)
- visible() (404 not 403)
- include=diagnostics
- Entity role route enhancement
- Blocking main entity hides device; strip hubThingId
- Rename/hide/merge/split wiring
- Settings persistence
- Favorites controller
- Areas controller
- Users controller

---

## GAPS THAT DEPEND ON LATER PHASES (cannot cover now)

| Gap | Depends On | Phase |
|---|---|---|
| Household modes (full, with HA presence) | Phase 7 (realtime) + HA | 7+ |
| Activity service & controller | Phase 7 | 7 |
| Administration (admin, operator, support) | Phase 12 | 12 |
| AI assistant | Phase 13 | 13 |
| Automations | Phase 8 | 8 |
| Backups | Phase 11 | 11 |
| Energy | Phase 9 | 9 |
| Groups (full service + controller) | Phase 9 | 9 |
| History | Phase 9 | 9 |
| Insights | Phase 8 | 8 |
| Notifications, alerts, push | Phase 7 | 7 |
| Routines | Phase 9 | 9 |
| Scenes | Phase 9 | 9 |
| Updates | Phase 12 | 12 |
| Worker (config-worker, ha-admin-api) | Phase 11+ | 11 |
| Devices.service (full) | Phase 6+ (favorites, voice, activity, things) | 6+ |
| Sync.service (full) | Phase 3 (full HA connection) | 3+ |
| Config-api, config-jobs, config-ops (full) | Phase 3/11 | 3/11 |
| Drift detection (full) | Phase 3 | 3 |
| Managed connection (full) | Phase 3 | 3 |
| Mode mirror (full) | Phase 7 | 7 |
| Sealed secrets (full, HA admin token) | Phase 3/11 | 3/11 |
| Voice exposure | Phase 6+ (HA Assist) | 6+ |
| Device actions, describe | Phase 6+ | 6+ |
| Command events with requestedState (SMART 3) | Phase 8 (SMART) | 8 |
| Group commands | Phase 9 (groups) | 9 |
| Favorites controller | Can port now (service exists) | movable |
| Users controller | Can port now | movable |
| Presence against real HA | Phase 3 (HA) | 3 |

---

## STATUS TRACKING

| # | Gap | Phase | Status | Filled In Run |
|---|---|---|---|---|
| 1 | Schema migrations | 0 | resolved | Run 19 |
| 2 | Typed app events | 0 | resolved | Run 19 |
| 3 | Sealed secrets | 0 | resolved | Run 19 |
| 4 | parseKey | 0 | resolved | Run 19 |
| 5 | Formatter/linter | 0 | accepted | Run 20 |
| 6 | Structured logging | 0 | resolved | Run 20 |
| 7 | Revoke-all sessions | 1 | open | |
| 8 | Per-account lockout | 1 | open | |
| 9 | UV at login policy | 1 | open | |
| 10 | Household modes | 2 | open | |
| 11 | Presence service (full) | 2 | open | |
| 12 | Groups/group_members tables | 2 | open | |
| 13 | Favorites controller | 2 | open | |
| 14 | Users service/controller | 2 | open | |
| 15 | ha_connections table | 2/3 | open | |
| 16 | HA reconnect | 3 | open | |
| 17 | REST client | 3 | open | |
| 18 | Connection manager (full) | 3 | open | |
| 19 | getHistory/getStatistics | 3 | open | |
| 20 | Per-domain normalizer maps | 3 | open | |
| 21 | Event pipeline split | 3 | open | |
| 22 | Per-consumer throttling | 3 | open | |
| 23 | Persist ha_* projection | 3 | open | |
| 24 | One HA connection per household | 3 | open | |
| 25 | Test doubles | 3 | open | |
| 26 | Connection service | 3 | open | |
| 27 | Sync service | 3 | open | |
| 28 | Config api/jobs/ops | 3 | open | |
| 29 | Drift detection | 3 | open | |
| 30 | Managed connection | 3 | open | |
| 31 | Mode mirror | 3 | open | |
| 32 | Sealed secrets | 3 | open | |
| 33 | parseKey | 3 | open | |
| 34 | Thing overrides DB | 3/4 | open | |
| 35 | Thing links DB | 3/4 | open | |
| 36 | Entity-less hub Things | 4 | open | |
| 37 | DELETE/unmerge endpoint | 4 | open | |
| 38 | Incremental rebuild | 4 | open | |
| 39 | Facet values | 4 | open | |
| 40 | Presentation | 4 | open | |
| 41 | Facet polarity suggestions | 4 | open | |
| 42 | Per-entity serialization | 5 | open | |
| 43 | Coalescing | 5 | open | |
| 44 | command_attempts table + retry | 5 | open | |
| 45 | Interrupted recovery on boot | 5 | open | |
| 46 | Late confirmation | 5 | open | |
| 47 | Idempotency keys (HTTP + DB) | 5 | open | |
| 48 | Undo dispatch | 5 | open | |
| 49 | Group commands | 5 | open | |
| 50 | Command events requestedState | 5 | open | |
| 51 | Per-caller visibility pruning | 6 | open | |
| 52 | Favorites filter on GET /devices | 6 | open | |
| 53 | decorate() | 6 | open | |
| 54 | visible() | 6 | open | |
| 55 | include=diagnostics | 6 | open | |
| 56 | Entity role route enhancement | 6 | open | |
| 57 | Blocking main entity hides device | 6 | open | |
| 58 | Rename/hide/merge/split wiring | 6 | open | |
| 59 | Settings persistence | 6 | open | |
| 60 | Favorites controller | 6 | open | |
| 61 | Areas controller | 6 | open | |
| 62 | Users controller | 6 | open | |
SQL
echo "Written to docs/GAP_ANALYSIS.md"