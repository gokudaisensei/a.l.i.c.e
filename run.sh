#!/usr/bin/env bash
# Starts Alice (backend, config-worker, frontend) using what ./setup.sh chose. Ctrl-C stops everything.
# Options: --prod (build + next start instead of next dev), --no-ha (don't touch the test HA container).
set -uo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
PROD=0 NO_HA=0
for a in "$@"; do case $a in --prod) PROD=1 ;; --no-ha) NO_HA=1 ;; -h|--help) sed -n 2,3p "$0"; exit 0 ;; *) echo "unknown option $a" >&2; exit 1 ;; esac; done

[ -f .env.alice ] && [ -f backend/.env ] || { echo "Not set up yet: run ./setup.sh first." >&2; exit 1; }
set -a; . ./.env.alice; set +a
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null || { echo "bun not found; re-run ./setup.sh --install-bun" >&2; exit 1; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in $FE_PORT $BE_PORT; do
  port_busy "$p" && { echo "Port $p is already in use (is Alice already running?). Stop it or re-run ./setup.sh with other ports." >&2; exit 1; }
done

mkdir -p .logs
PIDS=()
cleanup() { trap - EXIT INT TERM; echo; echo "Stopping..."; for p in "${PIDS[@]}"; do kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null; done; wait 2>/dev/null; exit 0; }
trap cleanup EXIT INT TERM
start() { # start name dir cmd...   (own process group so children die with it)
  local name=$1 dir=$2; shift 2
  (cd "$dir" && exec setsid "$@" >"$ROOT/.logs/$name.log" 2>&1) &
  PIDS+=($!)
}
wait_port() { # wait_port port name pid
  for _ in $(seq 1 120); do
    port_busy "$1" && return 0
    kill -0 "$3" 2>/dev/null || { echo "$2 exited early; last log lines:" >&2; tail -n 15 ".logs/$2.log" >&2; exit 1; }
    sleep 1
  done
  echo "$2 did not open port $1 in 2 minutes; see .logs/$2.log" >&2; exit 1
}

if [ "$HA_MODE" = mock ] && [ "$NO_HA" = 0 ]; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    (cd backend && HA_PORT=$HA_PORT bun run ha:up >/dev/null 2>&1) && echo "Test HA: http://localhost:$HA_PORT" || echo "Warning: could not start the test HA; continuing without it." >&2
  else echo "Warning: Docker is not running; continuing without the test HA." >&2; fi
fi

start backend backend bun run start
wait_port "$BE_PORT" backend "${PIDS[0]}"
# The worker holds the private admin-token key; without it nothing is written to HA, but Alice still works.
start worker backend bun --env-file=.env.worker src/worker/index.ts

if [ "$PROD" = 1 ]; then
  (cd frontend && BACKEND_URL=http://localhost:$BE_PORT NEXT_PUBLIC_WS_URL=ws://localhost:$BE_PORT/ws bun run build >"$ROOT/.logs/frontend-build.log" 2>&1) \
    || { echo "Frontend build failed; see .logs/frontend-build.log" >&2; exit 1; }
  start frontend frontend bun run start -- -p "$FE_PORT"
else
  start frontend frontend bun run dev -- -p "$FE_PORT"
fi
wait_port "$FE_PORT" frontend "${PIDS[-1]}"

echo "Alice is running: http://$HOST:$FE_PORT   (logs in .logs/, Ctrl-C to stop)"
wait "${PIDS[-1]}"
