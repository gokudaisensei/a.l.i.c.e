# Android app architecture

Status: **adopted**, mock-data phase. This is the model the native app is being built to; the
data layer is currently a mock (`data/mock`) until `backend-kt` reaches parity with `backend`.

Scope: the native Android client in `android/`. It replaces the web frontend in `frontend/`,
not the backend.

---

## 1. Context

Alice is three things:

| Piece | What it is |
|---|---|
| `frontend/` | Next.js web app — the current client |
| `backend/` | Elysia/Bun REST API (`/api/v1/*`) + WebSocket (`/ws`) + Home Assistant bridge |
| `backend-kt/` | The ported backend, being built in parallel to full parity |
| `android/` | The native client — replaces `frontend/`, with more functionality embedded |

`backend-kt` is assumed to reach **full parity** with `backend`: same REST surface, same `/ws`
protocol, same command lifecycle, same permission model. The Android app targets that contract,
not the web app's internals.

## 2. What the web does today (and why we do not copy it)

`frontend/src/lib/store.ts` is one global mutable object `S` (60+ fields) with a `bump()` version
counter; `useS()` subscribes every component to every change. `frontend/src/lib/live.ts` hydrates
`S` from REST and patches it from `/ws`. Screens read and mutate `S` directly.

That store solves a real problem — one source of truth — but it does so by giving up structure:

- `bump()` re-renders everything on every push frame.
- Dependencies are implicit: any screen may read any field.
- Household data and UI state (`view`, `room`, `q`, `sheet`, `pal`, `expanded`) live in the same object.
- Nothing is previewable or testable without the whole store.

**We keep the property (one source of truth), not the implementation.**

## 3. The model

> **An offline-first repository as the single source of truth, per-screen ViewModels exposing an
> immutable `UiState`, unidirectional data flow — and MVI-style sealed events at the boundary.**

In Google's vocabulary: layered architecture (data / domain / UI) with UDF, where the ViewModel
is a state holder. MVI is applied where it earns its keep, not app-wide.

```
        ┌─────────────────────── app-scoped, survives everything ──────────────────────┐
        │  REST client            WS client (subscribe · resubscribe · refetch)        │
        │        └──────────────┬──────────────┘                                       │
        │                 AliceRepository                                              │
        │   normalized cache: devices, areas, people, activity, alerts, energy,        │
        │   household mode, in-flight commands, session + role                         │
        │                 StateFlow<HouseholdState>                                    │
        └───────────────────────────────┬──────────────────────────────────────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
        HomeViewModel            RoomsViewModel            AutomateViewModel
        HomeUiState              RoomsUiState              AutomateUiState
             │                          │                          │
        HomeScreen (stateless)   RoomsScreen               AutomateScreen
             │   events up ─────────────┴──────────────────────────┘
```

Why not the alternatives:

| Option | Why it fails |
|---|---|
| Copy the web's global store | Everything re-renders on every push; implicit dependencies; UI and household state entangle |
| Plain per-screen MVVM (each VM fetches and owns its copy) | `/ws` pushes `entity.updated`, `presence.changed`, `alert.*`, `devices.changed`; independent copies drift — Home says locked, Rooms says open |
| One global MVI state for the app | Rebuilds `S` with a sealed type and a reducer: same god object, more ceremony |

## 4. Layers and dependency rules

```
ui/home, ui/rooms, …   ──▶ domain/model, ui/components, ui/theme
        │
        ▼
     data              ──▶ domain/model
        │
        ▼
  remote / local / mock
```

- **`domain/model`** — plain Kotlin. No Compose, no Android, no JSON. `Device`, `Lock`, `Scene`,
  `Person`, `Event`, `Mode`, `Kind`, `Tod`. Icons are **keys** (`"sun"`, `"moon"`), never
  `ImageVector`; the UI maps them.
- **`data`** — `AliceRepository` (the contract) + `HouseholdState` (one immutable snapshot) +
  implementations. This is the only layer that knows about transport, caching, retries, sockets,
  DTO mapping and the command lifecycle.
- **`ui`** — screens and ViewModels. A ViewModel depends on `AliceRepository`; a screen depends on
  its ViewModel. **Components depend on neither.**

Hard rules:

1. Components (`ui/components`) are stateless: data in, callbacks out. They never import a
   repository or a ViewModel.
2. Screens never touch the repository or the network. They render `UiState` and emit events.
3. The repository never imports `ui.*`.
4. One repository instance, app-scoped. It survives navigation, config changes and (once it has a
   disk cache) process death.

## 5. State ownership

| State | Lives in | Lifetime |
|---|---|---|
| Devices, locks, scenes, people, activity, alerts, energy, household mode, in-flight commands, session/role | `HouseholdState` in the repository | app process; later also disk |
| Selected tab, expanded activity, toast, per-screen filters/sheets/forms | per-screen `UiState` in the ViewModel | the screen (survives rotation) |
| Popup geometry, scroll offset, drag/morph animators, pull-to-refresh spinner | the composable (`remember`) | the composition |

The split is the whole point: **shared household data must not be duplicated per screen; screen
state must not leak into the shared cache.**

## 6. The command seam (where MVI is applied)

The backend defines a command as a state machine, not a boolean:

```
pending → authorized → dispatched → accepted → confirmed
any non-terminal → failed | timed_out
pending/authorized → cancelled
```

plus an idempotency key per tap, optimistic state, and undo (once, within ten minutes). That is
modelled in the repository, not in a composable:

- the tap applies an **optimistic** update immediately;
- the command is recorded with its id and a revert snapshot;
- `command.confirmed` / `command.failed` / `command.timed_out` from `/ws` reconcile or roll back;
- undo issues `POST /commands/{id}/undo`.

The ViewModel sees only `Device` state. It never sees a command state machine.

**Where a sealed event type is used:** `HomeEvent` is the single entry point into
`HomeViewModel.onEvent(...)`. Every interaction is named, the `when` is exhaustive, and the set of
things a screen can do is closed. That is the MVI discipline — applied at the event boundary, not
as an app-wide state reducer.

## 7. Package map

```
com/alice/home/
├── MainActivity.kt                 app shell: splash handover only
├── di/AppGraph.kt                  service locator (temporary until Hilt/Koin)
├── domain/model/                   plain models, no Compose
│   ├── Device.kt                   Device, Kind
│   ├── Household.kt                Lock, Scene, Person, Event, Mode
│   └── TimeOfDay.kt                Tod, tod()
├── data/
│   ├── HouseholdState.kt           immutable snapshot + derived values (kw, counts)
│   ├── AliceRepository.kt          the contract
│   └── mock/MockAliceRepository.kt current fake data, same contract
└── ui/
    ├── components/                 stateless design system, ~30 files (vocabulary table: design-bible §6)
    ├── theme/                      AliceColors (`Alice.c`), AliceType, AliceTypography
    ├── Motion.kt, Haptics.kt       design-system primitives (curves/springs; named haptic verbs)
    ├── home/                       HomeScreen, HomeViewModel, HomeUiState, HomeEvent, HomeIcons, DevicePopup
    ├── rooms/                      RoomsScreen, RoomsViewModel, RoomsUiState, RoomsEvent
    ├── people/                     PeopleScreen, PeopleViewModel (household, invites, roles)
    ├── settings/                   SettingsSheet (opened from the wordmark, not a tab), SettingsViewModel
    ├── automate/                   AutomateScreen, AutomateViewModel, BuilderEditors (recipe builder)
    └── launch/                     splash + loading screen
```

Screens get their own package as they appear (`ui/home`, `ui/rooms`, `ui/people`, `ui/settings`, `ui/automate` exist; `ui/admin`
is next), each with `XScreen`, `XViewModel`, `XUiState`, `XEvent`. `DevicePopup` lives in
`ui/home` but is used by Rooms too; when a third screen needs it, move it to `ui/components`.
Which screens are Glance and which are Catalogue (and why that changes their layout) is in
design-bible §12.

## 8. Mock → real

The mock exists only because `backend-kt` is being built in parallel. Nothing above the data layer
changes when it lands.

| Today | When `backend-kt` reaches parity |
|---|---|
| `MockAliceRepository` | `DefaultAliceRepository` |
| in-memory `MutableStateFlow` | + Room cache, hydrated on cold start |
| `refresh()` no-op | `GET /api/v1/...` on socket (re)connect — `/ws` has **no replay** |
| `toggleDevice`, `commitLevel`, … mutate a list | optimistic update → `POST` with idempotency key → reconcile from `command.*` |
| no socket | `/ws`: `hello`, `subscribe` per resource (`devices`, `commands`, `household`, `activity`, `alerts`), resubscribe + refetch on reconnect |
| `role` unused | role gates UI (`admin` / `member` / `guest`); sockets are closed server-side on revocation |
| `AppGraph` | Hilt modules |

`backend-kt` stays the authority. If embedded functionality later needs a direct Home Assistant or
local-control path, it is a second **data source behind the same repository interface** — never a
shortcut from a screen.

## 9. Conventions

See also `android/docs/design-bible.md` for the visual/interaction rules (colour semantics, type roles, motion, haptics, level-setting gestures, screen archetypes, component vocabulary) that every screen must follow. Where the code does not yet meet the bible, the gap is a numbered open issue there (§13), not a silent exception.

- Immutable state: `data class` + `copy`. No public mutable properties on a ViewModel.
- One `onEvent` per ViewModel; events are named for what the user did, not what to set.
- Components take only what they draw: no `vm`, no repository, no `HouseholdState` whole.
- Derived values (`kw`, `unlocked`, `newActivityCount`) are computed once in `HouseholdState`,
  not re-derived in composables.
- One-off effects (toast, navigation) are explicit in `UiState` and cleared by an event — never a
  fire-and-forget callback from inside a composable.
- Every new screen ships with `@Preview`able content that takes `UiState` + callbacks, not a VM.
- A gesture component may play the haptic for its own gesture (a press, a drag step); a screen must
  not play haptics or toasts for command *outcomes*: those come from state or an event.
- Every event a ViewModel accepts must be reachable from the UI. (Today `RoomsEvent.ToggleFavourite`,
  `ToggleVoice` and most of `SetHidden` are not: design-bible D3.)

## 10. Testing

| Layer | Test |
|---|---|
| `domain/model`, `HouseholdState` | plain JUnit — derived values, invariants |
| repository | fake transport; command lifecycle, optimistic rollback, reconnect refetch |
| ViewModel | fake repository; event → `UiState` transitions, no Android dependencies |
| components | Compose screenshot/behaviour tests; no VM required |
| screen | Compose test with a `UiState` fixture |

## 11. Known deviations (to close during the port)

- `di/AppGraph` is a hand-rolled locator; replace with Hilt when the data layer grows.
- `MockAliceRepository` is synchronous. Real commands are asynchronous with optimistic state; the
  ViewModel contract is already shaped for that (it never assumes a command completed).
- `Scene`/`Mode` icon keys are mapped in the UI; the mapping must stay in sync with the backend's
  icon vocabulary (`sun`, `moon`, `exit`, `play`, …).
- No disk cache yet, so a cold start has no last-known state; `loading` handling will be added with
  the real repository.
- **Locks have no command path of their own.** `RoomsEvent.ToggleDevice` and the popup treat a lock
  like any switch, so a lock can be unlocked with one tap. The backend requires a fresh passkey to
  unlock (`step_up_required`) and never for locking. The repository needs a `lock`/`unlock` pair, and
  unlocking must be able to answer "needs passkey" (design-bible §0.9, D2).
- A command's outcome (confirmed, failed, timed out) has no UI yet: toasts and the "undo" action wait
  for the real command lifecycle (design-bible D14).
- The design-system components are in the app module. If a second client or a preview-only module
  needs them, they move to their own module; nothing in them depends on `ui/home` or `ui/rooms`.
