# PROGRESS

Updated: 2026-11-12T17:30:00Z by opencode-agent
Current milestone: M9 complete (M0–M9 done)   Next: owner fixes findings and a re-run; optional soak awaits user

This file is maintained after every task so another agent can resume. Read it first, verify
"Environment currently running", and resume at the first task whose status is not `done`.

## Milestone status

| M | Status | Exit criterion | Evidence |
|---|---|---|---|
| M0 | **done** | ENV-01…05 green; nothing of the user's touched | `.runs/2026-11-12T04-37-16-337Z` |
| M1 | **done** | ENV-06…08 green; report renders all outcomes; noise counted | `.runs/2026-11-12T04-37-16-337Z`; `.runs/m2-noise` |
| M2 | **done** | AUTH/HH/X | `.runs/m2-all-{auth,hh,x}`; F-007…F-016 |
| M3 | **done** | HA/DEV/FAV + T3.1; G1 MET | `.runs/m3-all-{ha,dev,fav}`, `.runs/m3-inv`; F-017…F-025 |
| M4 | **done** | CMD + T4.1 | `.runs/m4-all-cmd`, `.runs/m4-t41`; F-026…F-029 |
| M5 | **done** | WS/NOTE/HIST + T5.1/T5.3 | `.runs/m5-all-{ws,note,hist}`; F-030…F-036 |
| M6 | **done** | AUT + T6.1 | `.runs/m6-all-aut`, `.runs/m6-t61`; F-037…F-039 |
| M7 | **done** | AI/ADM + T7.2 | `.runs/m7-all-{ai,adm}`; F-040…F-043 |
| M8 | **done** | CH fast-tier chaos | `.runs/m8-all-ch`; F-044…F-046 |
| M9 | **done** | Full ENV up/down, verdict G1–G8, expected-diffs review | `.runs/m9-env`, `.runs/m9-verdict` |

## M9 results

- Fresh clean cycle: `env/up.ts` → `--suite env` → `env/down.ts`; **8/8 ENV PASS**, **G1 MET**,
  tidy proof PASS.
- Roll-up run: `.runs/m9-verdict/` over M2–M8 plus the M9 ENV run.
  **82 PASS · 110 FAIL · 26 BLOCKED · 0 FLAKY · 0 DIFF_ACCEPTED** (218 real checks; the six
  SELFTEST fixtures stay in `.runs/m9-env`).
- Gates: **G1 MET, G8 MET**; **G2–G7 NOT MET** (contract/security/capability/truth/resilience).
- Noise: `.runs/m2-noise` 6/6 PASS, **0** TS-vs-TS diffs.
- T4.1 restart recovery: both stacks `failed/interrupted`.
- T6.1 scene equivalence: identical HA end state on both stacks.
- T3.1 inventory: TS 109 / Kotlin 109 Things, 109 compared, 80 capability-metadata differences.
- `expected-diffs.yaml` is **empty**; no difference has been accepted (an agent may not
  self-approve).

**Verdict: full parity is not achieved.** The failures are real Kotlin contract differences, not
harness noise. The top critical findings are F-017 (no live HA state in device views), F-021
(favorites 500), F-026 (command responses 500), F-033 (energy has no meters) and F-040 (AI leaks a
device to a guest); F-044 is the chaos-time 500.

## Last recorded run

- M9: `.runs/m9-env/` (ENV + tidy proof), `.runs/m9-verdict/` (`report.md`, `report.html`,
  `results.json`, `VERDICT.md`, `route-inventory.json`).
- Earlier evidence retained under `.runs/m2-all-*` … `.runs/m8-all-*`.
- Unit tests: `cd backend-kt/e2e && bun test` → 30 pass, 0 fail.
- Inventory: TS 148, Kotlin 161, WS 17 (only-TS 0, only-Kotlin 13).

## Notes for the next agent

- The harness is feature-complete for M0–M9. The remaining work is on the Kotlin side: fix the
  findings, then re-run the affected area(s) with `--suite all --area <AREA>` and update
  `.runs/m9-verdict` by re-running `bun /tmp/m9-verdict.ts` (or re-create the roll-up from the
  per-area runs).
- **Kotlin installDist disappears between sessions.** Rebuild before any run that starts the Kotlin
  stack.
- The HA pair is torn down. Re-run `bun env/up.ts --run-dir <dir>` to bring it back; copy `ha-a.env`
  (and `ha-b.env` for CH) into each area run directory.
- For a real `--suite all`, budget several hours: every card resets both stacks. The M9 verdict
  intentionally rolls up the per-area runs instead of repeating ~100 reset-heavy cards.
- `expected-diffs.yaml` needs the user's `approvedBy` for any accepted difference.
- The optional 2-hour soak has not run and needs the user's explicit approval.
- `backend-kt/data/` pre-existed and is user-owned; do not delete it.

## Open findings

- F-001…F-006 M0/M1 infrastructure notes; F-007…F-016 M2; F-017…F-025 M3; F-026…F-029 M4;
  F-030…F-036 M5; F-037…F-039 M6; F-040…F-043 M7; F-044…F-046 M8.

## Environment currently running

containers: `alice-ha-mock` (user-owned, untouched) only | ports: none owned by the harness | run
dirs: all under `backend-kt/e2e/.runs/` (stacks stopped, HA pair torn down)
