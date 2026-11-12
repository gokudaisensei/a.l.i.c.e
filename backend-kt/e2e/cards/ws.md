# WS — realtime `/ws`

Cards for plan §4.7 (`E2E_PARITY_PLAN.md`). Written before `scenarios/ws.ts` (RUNBOOK §6.1).
The transcript is recorded as one synthetic exchange per server message (`type` + payload keys), so
the differential suite compares the message grammar and ordering without live values.

## Coverage

| Catalogue bullet (plan §4.7) | Cards |
|---|---|
| Connect/auth by cookie; origin; unauthenticated refusal | WS-01 |
| Subscription grammar, acknowledgements, ping/pong | WS-01 |
| `entity.updated` for a change made outside, through HA | WS-02 |
| Command events (`created → confirmed`, `requestedState`) | WS-03 |
| Per-person filtering (guest sees only allowed devices) | WS-04 |
| Reconnect / no replay by design; REST refetch | WS-05 |
| Backpressure, idle timeout, 10-connection cap, hub restart | **BLOCKED** — chaos/soak work (M8) |
| `alerts`/`notifications`/`activity` pushes | NOTE-01/02 and M5 follow-up; the grammar is the same path as WS-02/03 |

---

### E2E-WS-01  The socket authenticates, says hello, and answers the grammar
- Capability: `/ws` upgrade + protocol     Oracle: TS, SPEC, SEC
- Needs: HA-connected household world
- Steps:
  1. an upgrade with no session cookie → 401 and no socket
  2. an authenticated socket receives `hello {userId, role, resources}`
  3. `subscribe devices` → `subscribed` with the same `requestId`
  4. `ping` → `pong`
  5. a garbage frame → `error` with code `bad_message`, and the socket stays open
- Error twin: steps 1 and 5
- Normalize: userId
- Both stacks: yes     Timing: normal     Pass when: the handshake and grammar match the documented protocol

### E2E-WS-02  A change made in Home Assistant is pushed to subscribers
- Capability: `entity.updated`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. connect, subscribe `devices`
  2. from HA itself, turn `input_boolean.test_switch` on
  3. receive `entity.updated` with that `entityId` and a values object
  4. `unsubscribe devices` → `unsubscribed`; changing it again produces no further message
- Error twin: none
- Normalize: timestamps, values
- Both stacks: yes     Timing: normal     Pass when: an outside change reaches the socket and unsubscribing stops it

### E2E-WS-03  A command is followed over the socket to confirmation
- Capability: `command.*` events     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. connect, subscribe `commands` and `devices`
  2. send a switch `turn_off` over REST
  3. receive `command.created` and `command.confirmed` (and, between them, dispatch/accepted events on the oracle)
  4. the confirmed command carries the public shape with `requestedState`
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the lifecycle is observable over the socket

### E2E-WS-04  A guest does not receive devices they cannot see
- Capability: per-person filtering     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. admin and guest sockets subscribe `devices` and `commands`
  2. admin turns a device on in HA
  3. admin receives `entity.updated`; the guest receives none
  4. the guest subscribing to that specific device gets an `error` with code `not_found`
- Error twin: step 4
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: visibility is enforced on the socket, not only on REST

### E2E-WS-05  There is no replay after a reconnect
- Capability: reconnect / refetch     Oracle: TS, SPEC
- Needs: HA-connected household world
- Steps:
  1. connect and subscribe, then close the socket
  2. change the device in HA while disconnected
  3. reconnect and subscribe again
  4. no `entity.updated` for the missed change arrives, but `GET /devices` already carries the new value
- Error twin: none
- Normalize: ids, values
- Both stacks: yes     Timing: normal     Pass when: the reconnected client must refetch, by design
