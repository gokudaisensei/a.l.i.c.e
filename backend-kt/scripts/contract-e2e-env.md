# Running contract/e2e against backend-kt (reference)

These flows require a **running environment** (not fully automatable in-repo CI without infra).

## Prereqs
- Build backend-kt: `cd backend-kt && ./gradlew :server:installDist :worker:installDist`
- Frontend deps installed in `frontend/` (bun/npm per project)
- Optional: Home Assistant (mock or real) for HA-backed flows; see `backend/dev/ha/docker-compose.yml` and `backend/.env.test` patterns.

## Backend-kt server
- Start server with parity env (origins/cookies/secrets/keys/DB path as in TS backend e2e setup).
- Example: configure `WEBAUTHN_*`, `CORS_ORIGINS`, `DATABASE_PATH`, secrets/keys, `HA_URL`/token as needed.
- Health: `GET /health` -> `{"status":"ok","uptime":...}`

## Frontend e2e (Playwright)
- `frontend/playwright.config.ts` currently launches the **TS backend** (`../backend`). To target Kotlin backend, run an equivalent stack:
  1. Start backend-kt server (+ worker if needed) on a chosen port with a fresh DB and required env.
  2. Start frontend dev/build pointing `BACKEND_URL`/`NEXT_PUBLIC_WS_URL` to that backend.
  3. Run Playwright against that frontend.
- Adapt ports/env/commands from `frontend/playwright.config.ts` for a Kotlin-backend profile in your environment.

## Contract/API parity checks
- Compare `/api/v1/*` responses, status codes, error envelopes, headers/cookies, and WS `/ws` behavior against `backend/` (TS oracle) using the same seeded state/fixtures where possible.
- Backend e2e-style integration tests in `backend/src/**/**.e2e.test.ts` are TS-runtime specific; equivalent validation against Kotlin should be driven via HTTP/WS clients or a dedicated harness in a prepared environment.

## Updates supervisor
- Use `backend-kt/scripts/update-supervisor.sh` as the marker-handoff reference (`update-requested.json`).
- Real install/rollback requires deployment-specific artifact download/verification, service restart, and versioned dist management on target hosts.

## HA/provider validation
- Real HA flows: point `HA_URL`/token to a test HA instance (e.g. local dev HA) and exercise sync/history/energy/backup/update-related behavior.
- Ask Alice model e2e: set `AI_ENABLED`, `AI_API_KEY`, `AI_MODEL` and validate proposal-only behavior/guards with live provider access.
