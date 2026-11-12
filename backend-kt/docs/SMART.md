# Smart UX: intelligence you don't see

The product rule for everything in this file:

> **Intervene on interactions, never on attention.**
> No new notifications, badges, suggestion inboxes or "AI" labels. Learning
> changes response speed, ordering, memory and forgiveness — the things people
> only notice when they use an app that lacks them. The feedback signal is
> behaviour (views, commands, undos, dwell), never a question.

These features are additive to parity: they cannot change the behaviour of an
existing screen unless that screen opts into them. They are server-served so
phone and tablet agree, except the transport/optimistic layer, which lives in
a shared KMP client library.

---

## 1. The features and where each lives

| # | Feature | User-visible effect | Server work | Client work |
|---|---|---|---|---|
| 1 | **Home is already where you are** | Cold open lands on the right room with devices in your order; one round trip | `GET /home` composition | prefetch on foreground |
| 2 | **Ordering that never shuffles under your thumb** | Order changes between opens, never during use | affinity scores + hysteresis + `generation` | adopt order on open only |
| 3 | **Commands feel instant** | Tap renders immediately; "settling" until confirmed; no error at timeout | lifecycle events with `requestedState` | optimistic state machine |
| 4 | **Undo everywhere + regret guards** | One undo for scenes/routines/groups; an action you keep undoing needs a 2 s hold instead of a tap | undo scope, regret EWMA, `confirmIntent` hint | hold affordance |
| 5 | **Reconnect that never announces itself** | No spinners or stale lies; values age instead of pretending | resync token, `devices.changed` scope | reconnect/resubscribe/refetch/queue |
| 6 | **Search that just finds it** | Typos, synonyms and recents work; empty search shows what you touch now | alias index, trigram rank, query history | local debounce + cached recents |
| 7 | **Remembered defaults** | Light sheet opens at *your* 50 %; climate at your setpoint | per-user `action_defaults` | prefill from hint |
| 8 | **One-tap likely scenes** | "Morning" is a chip at 06:50 and gone by 09:00 | scene usage × hour window | render chips |
| 9 | **New device, already clean** | Correct name, room and role on day one | existing cleaner/classifier parity | none |

Not in scope, deliberately: LLM chat, insight feeds, notification spam, voice
assistant, "suggestions" the person must triage.

---

## 2. Data model

Added in **phase 2** (while the schema is being ported) and fed from the event
bus. All tables are household-scoped and per-user.

```sql
-- Time-decayed interaction counters, per user/thing/hour-of-day (0..23 local).
CREATE TABLE interaction_stats (
  household_id TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  thing_id     TEXT    NOT NULL,
  hour_bucket  INTEGER NOT NULL,
  views        REAL    NOT NULL DEFAULT 0,
  commands     REAL    NOT NULL DEFAULT 0,
  undos        REAL    NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id, thing_id, hour_bucket)
);

-- Remembered parameter sets for the last action per user/thing/action.
CREATE TABLE action_defaults (
  household_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  thing_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  params       TEXT NOT NULL,           -- JSON, validated on read
  uses         INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id, thing_id, action)
);

-- Normalized search history for zero-query suggestions and ranking.
CREATE TABLE query_history (
  household_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  query_norm   TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id, query_norm)
);

-- Scene chips: usage by hour bucket.
CREATE TABLE scene_usage (
  household_id TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  scene_id     TEXT    NOT NULL,
  hour_bucket  INTEGER NOT NULL,
  runs         REAL    NOT NULL DEFAULT 0,
  last_run_at  INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id, scene_id, hour_bucket)
);

-- The last order served per user, so hysteresis is stable across requests.
CREATE TABLE home_orders (
  household_id TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  generation   INTEGER NOT NULL,
  order_json   TEXT    NOT NULL,
  issued_at    INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
```

Writes are event-driven (`thing.viewed`, `command.settled`, `command.undone`,
`scene.activated`, `search.performed`) and coalesced in memory before a
transaction, so a chatty home does not cause a write per event.

### Decay

Counters use exponential decay on write, with a **21-day half-life**:

```
value := value * 0.5^(Δt / 21d) + 1
```

Hour buckets are smoothed at read time: weight `1.0` for the current hour,
`0.5` for the adjacent hours, `0` elsewhere. This avoids a hard jump at the top
of the hour.

---

## 3. `GET /home` — one cold-open round trip

Additive endpoint, authenticated, person-scoped. Nothing is pushed for
ordering: the client asks when a screen opens.

```json
{
  "generation": 17,
  "serverTime": 1762760400000,
  "household": { "id": "hh_…", "mode": "home", "timeZone": "Asia/Kolkata" },
  "room": { "id": "area_…", "name": "Kitchen", "reason": "motion" },
  "alerts": { "count": 2, "highest": "warning" },
  "devices": [
    {
      "id": "thg_…",
      "name": "Counter lights",
      "areaId": "area_…",
      "kind": "light",
      "state": { "on": true, "brightnessPct": 60 },
      "hints": { "confirmIntent": false, "defaultParams": { "brightnessPct": 50 } }
    }
  ],
  "scenes": [
    { "id": "scn_…", "name": "Morning", "reason": "time-window" }
  ],
  "usual": [ { "kind": "thing", "id": "thg_…", "name": "Kettle plug" } ],
  "search": { "suggestions": ["kitchen", "lamp", "morning"] }
}
```

Rules:

- Devices are already filtered by the phase-2 visibility helper.
- `room` is chosen from presence/motion/door evidence in this order: active
  motion in a room → most recent door → last room the person controlled →
  null. It is a hint; clients may ignore it.
- `generation` changes only when the served order changes. Clients send
  `If-None-Match: <generation>` and get `304` on the next open, reusing the
  cached body.
- The response is cacheable for a short time (`Cache-Control: private, max-age=5`).

### Ordering algorithm

```
score(t) = 3.0*commands(t) + 1.5*views(t) + 1.0*recency(t) - 0.5*undos(t)
```

- `recency` = `0.5^(hours_since_last_use / 72)`.
- Pinned/favorite devices always sort first (explicit beats learned).
- Visible, available devices only. Hidden/denied never appear.
- Cold start (no stats): favorites → same area as `room` → most recently
  changed → name. Deterministic, never random.

### Hysteresis (the anti-jump rules)

1. Compute the desired order.
2. Compare with `home_orders.order_json`.
3. **Keep the previous position** unless the score advantage over the current
   neighbour is at least **15 %**.
4. An item may move at most **2 positions** per generation.
5. A new generation is issued at most once per **15 minutes** per person, and
   only on an explicit `/home` request. Nothing reorders a screen that is open.
6. `POST /home/order/ack` (optional) lets a client confirm it adopted a
   generation; unacknowledged orders are still valid for the next open.

Tuning is conservative on purpose: the failure mode to design against is
"jumpy", not "dumb". Thresholds live in config (`app.smart.*`), not constants.

---

## 4. Command lifecycle for optimistic clients

The backend already models a requested state; the Kotlin build exposes it as a
first-class lifecycle in REST and `/ws`:

```
requested → dispatched → confirmed
                      ↘ failed
                      ↘ timed_out → (late_confirmed)
                      ↘ cancelled
```

- `command.updated` carries `requestedState`, `actualState?`, `status`, and a
  short public `message` on failure (never HA text).
- Clients render `requestedState` immediately, show a "settling" affordance
  while `dispatched`, and only report failure on `failed`. A `timed_out`
  command keeps a "still trying" affordance; a later `late_confirmed` settles
  it silently.
- Per-entity serialization (phase 5) means the server's order matches the
  order the person tapped; superseded intents coalesce to the last one.

---

## 5. Undo and regret guards

- Undo scope: single device (10 min), scene activation, routine run, group
  action. A group undo restores every member that has a known prior state and
  reports the ones it could not.
- Undo is idempotent and recorded as `undoneBy`, so a double tap cannot undo
  twice.
- **Regret gate** per (person, thing, action): `undo_rate = undos / max(1, commands)`
  with the same 21-day decay, over at least 5 commands. When `undo_rate ≥ 0.3`,
  the served hint sets `confirmIntent: true`; the client requires a **2 s
  press-and-hold** instead of a tap. It clears when the rate decays below
  `0.15`.
- Never gated by regret: lock/unlock (already step-up), or anything the
  household marked sensitive. Regret never blocks a command — it only changes
  the gesture, and a hold always works.
- No explanation is pushed. `GET /home/why?thingId=…&action=…` returns the
  factors on demand (used by a long-press "why?" affordance).

---

## 6. Search

`GET /search?q=…[&kind=thing|entity|scene|routine|area]`

- Normalize: Unicode NFKD, strip accents, lowercase, collapse whitespace.
- Candidate sources: thing/entity names, aliases (generated + user), area
  names, scene/routine names.
- Ranking: exact > prefix > token match > trigram similarity (Jaccard ≥ 0.45);
  boost by the person's `commands/views` at this hour, then recency, then
  `query_history`.
- Always filtered by visibility. Max 20 results.
- Zero-query state: the `usual` list from `/home` (top 4 by score at this
  hour) plus the 3 most recent successful queries.
- An in-memory trigram map is built from the persisted `alias_index`; the
  index is rebuilt on `things.changed`, so cold start is one query.

This fixes L20 without an LLM and without a new UI surface: it is the existing
search field, just better.

---

## 7. Remembered defaults and scene chips

- `action_defaults` stores the **last validated parameters** per
  (person, thing, action), e.g. `brightnessPct=50`, `targetTemp=22.5`,
  `fanSpeed=2`. Values older than 90 days are ignored. A hint is only served
  when the action is currently available and the value passes the same
  validation as a command.
- Client behaviour: prefill, never auto-send. The person still confirms.
- Scene chips: for each scene, score usage in the current hour ±1 and the last
  two weeks; surface at most 3 with `runs ≥ 3` and a time-window bias. Chips
  are computed in `/home`; no new notification or "suggestion" concept.

---

## 8. Shared client library (`alice-client`)

The reason the Kotlin rewrite is worth it. One implementation for Compose and
(later) SwiftUI via KMP:

```
alice-client/
├── core/        models, command state machine, undo window, ranking cache
├── transport/   Ktor HTTP + WS, auth/session cookie or bearer
├── store/       SQLDelight or multiplatform-settings persistence
└── test/        virtual-time chaos harness
```

Responsibilities:

- **Reconnect invisibly**: exponential backoff with jitter, resubscribe to the
  last subscription set, fetch a `resync` token and refetch only what changed.
- **Stale-while-revalidate**: cached values are served with an age; the UI
  desaturates stale values rather than showing a lie. Tombstones for devices
  that vanished.
- **Optimistic commands**: `requested` → render, `dispatched` → settling,
  `confirmed` → settle, `failed` → revert once with a message. A timeout is
  not an error.
- **Offline queue**: commands issued offline get an idempotency key and are
  sent on reconnect, in order, per entity; the person can cancel them.
- **Prefetch**: `/home` on app foreground/room change; the next screen's data
  after a tap.
- **Undo**: exposes the 10-minute window from the server; no local guessing.

Contract tests: virtual time, controllable fake server, dropped sockets,
duplicate delivers, out-of-order command events, and a golden trace per
scenario. The library is versioned with the backend protocol version (phase 7).

---

## 9. Guardrails

- **Explicit beats learned** everywhere: favorites/pins/settings always
  outrank affinity; a manual reorder is stored as a pin.
- **No learning while observed**: reorder on open, defaults on next open, no
  mid-sheet changes.
- **No questions**: no thumbs, no onboarding, no "was this helpful?".
- **Boring, deterministic math**: EWMA + decay + caps, no model framework.
  Every threshold is config and every algorithm has a seeded golden test.
- **Explain on demand only**: `/home/why`, never proactively.
- **Privacy**: per-person counters; excluded from the audit log; deletable per
  person; no device values, no history, nothing sent to a model. Ask Alice's
  optional model path stays separate and opt-in.
- **Kill switches**: `app.smart.ordering|hints|search|scenes` (server config,
  per-household override later). Disabling falls back to the deterministic
  cold-start order.
- **Retention**: counters decay; rows with score `< 0.01` and no use for 180
  days are pruned monthly.

---

## 10. Build order

| Phase | Smart deliverable |
|---|---|
| 2 | `interaction_stats`, `action_defaults`, `query_history`, `scene_usage`, `home_orders` tables; event hooks |
| 5 | command lifecycle + undo scope exposed for optimistic clients |
| 7 | protocol version + resync token |
| 8 | `/home`, `order=smart`, hysteresis, hints, `/search`, zero-query list, scene chips |
| 9 | regret gate calibration, scene-usage wiring |
| 12 | (optional) richer mode suggestions using presence/regret signals |
| parallel | `alice-client` KMP library, starting once phase 7's protocol is fixed |

Cold-start behaviour ships first and must be good without any history; the
learned layer only ever improves an already-usable screen.
