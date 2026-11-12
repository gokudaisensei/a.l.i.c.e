# Alice backend parity harness (`backend-kt/e2e/`)

Executable harness for [E2E_PARITY_PLAN.md](../docs/E2E_PARITY_PLAN.md) as
scripted by [E2E_RUNBOOK.md](../docs/E2E_RUNBOOK.md). Everything here runs
against throwaway `alice-parity-*` resources only; it never touches the user's
real containers, volumes, ports or data (RUNBOOK R1–R5).

## Quick start

```sh
bun e2e/env/preflight.ts          # M0: refuse on conflict, write baseline
bun e2e/env/up.ts                 # start the two throwaway HA instances, bootstrap + seed
bun e2e/env/stack.ts up           # start TS + Kotlin servers/workers
bun e2e/env/stack.ts down         # stop them
bun e2e/env/down.ts               # remove the HA instances
bun e2e/run.ts --help             # scenario entry point (M1+)
```

State lives under `e2e/.runs/<timestamp>/` (git-ignored). `PROGRESS.md` is the
resume protocol; `FINDINGS.md` collects every FAIL/BLOCKED with a cause.
