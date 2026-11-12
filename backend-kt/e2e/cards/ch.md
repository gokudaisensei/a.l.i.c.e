# CH — resilience and chaos

Cards for plan §4.15 (`E2E_PARITY_PLAN.md`) and runbook M8. Chaos actions run against the
**throwaway** `alice-parity-ha-b`; the user's containers are never touched.

## Coverage

| Catalogue bullet (plan §4.15) | Cards |
|---|---|
| HA paused 30 s, then unpaused: status drops, server stays up, reconnects | CH-01 |
| HA restarted: reconnect and devices return | CH-02 |
| Token revoked in HA: auth-failed status, no crash loop | **BLOCKED** — revoking a long-lived token needs its HA token id/websocket admin call; not exposed by the harness (F-044) |
| 5 s latency proxy: a command times out instead of hanging | CH-03 |
| kill -9 during a command, then restart (T4.1) | covered by `m4-t41` |
| Worker kill/restart and config-job recovery | **BLOCKED** — config sync needs an admin token + worker apply (T6.2/T6.3 deferred) |
| Disk full | **BLOCKED** — needs sudo/loop mount; R9 forbids it |
| 200 WS clients | **BLOCKED** — the server caps connections at 10 per user, so this needs 20 accounts; not meaningful at M8 scale |
| 1,000 rapid commands | **BLOCKED** — throughput is covered by T4.2; F-026 blocks the light command path |
| Slow tier: undo expiry, left-open 10 min, session expiry | **BLOCKED** — real-time windows (10 min / 1 h) and no shared TTL knob; Kotlin-only step-up TTL (AUTH-14) |
| Soak (optional) | **BLOCKED** — 2 hours; needs explicit user approval before starting |

---

### E2E-CH-01  Pausing Home Assistant does not take the backend down
- Capability: connection health under a paused HA     Oracle: HA, TS
- Needs: household world + `ha-b.env`
- Steps:
  1. connect both stacks to HA-B, wait for `connected` and at least 10 devices
  2. `docker pause alice-parity-ha-b`
  3. `/health` is still 200 and `GET /devices` still answers; a command sent during the freeze resolves as timed out/failed instead of staying pending
  4. `docker unpause`, then wait for the device list to return and a fresh command to confirm
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: chaos     Pass when: the server survives and reconnects

### E2E-CH-02  Restarting Home Assistant reconnects
- Capability: reconnect after an HA restart     Oracle: HA, TS
- Needs: household world + `ha-b.env`
- Steps:
  1. connect to HA-B and wait for devices
  2. `docker restart alice-parity-ha-b`
  3. within 120 s the status is `connected` again and at least 10 devices are visible
- Error twin: none
- Normalize: ids, timestamps
- Both stacks: yes     Timing: chaos     Pass when: the backend reconnects without a restart

### E2E-CH-03  A slow Home Assistant times a command out instead of hanging the API
- Capability: command timeout under 5 s latency     Oracle: HA, TS
- Needs: household world + `ha-b.env`
- Steps:
  1. start the 3193 latency proxy in front of HA-B (5 s per chunk) and save that URL as the connection
  2. wait for `connected`; send a switch `turn_off`
  3. the command reaches a terminal state, `timed_out`, within 30 s
  4. `/health` answers during the wait; restore the direct HA-B URL
- Error twin: the timeout is the error
- Normalize: ids, timestamps
- Both stacks: yes     Timing: chaos     Pass when: the command is resolved as timed out and the server stays responsive
