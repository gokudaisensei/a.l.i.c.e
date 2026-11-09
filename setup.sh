#!/usr/bin/env bash
# One-time setup for Alice: checks tools, installs deps, writes env files + keys, and sets up Home Assistant
# (the disposable test instance in Docker, or one you already run). Then use ./run.sh to start everything.
# Re-running is safe: existing env files and a working test HA are kept unless you pass --force.
set -uo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
STATE="$ROOT/.env.alice"   # chosen ports/modes, read by run.sh (gitignored via .env.*)

usage() { cat <<'EOF'
Usage: ./setup.sh [options]
  -y, --yes, --non-interactive   Never prompt; use flags/defaults (fails instead of asking)
      --frontend-port N          Web app port            (default 3000)
      --backend-port N           API + websocket port    (default 3001)
      --ha-port N                Test Home Assistant port (default 8123)
      --host NAME                Hostname you open the app at (default localhost; sets passkey origin)
      --ha MODE                  mock (Docker test HA) | existing | none   (default: mock if Docker works)
      --ha-url URL               Existing HA address, e.g. http://192.168.1.10:8123 (implies --ha existing)
      --ha-token TOKEN           Existing HA long-lived token (or env HA_TOKEN)
      --seed | --no-seed         Fill the test HA with a furnished home (default: seed)
      --install-bun              Install Bun automatically if missing
      --skip-install             Skip `bun install`
      --force                    Regenerate env files/keys and recreate the test HA
      --start                    Run ./run.sh when setup finishes
  -h, --help
EOF
}

# ---------- helpers ----------
if [ -t 1 ]; then B=$'\e[1m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'; else B= R= G= Y= N=; fi
info() { echo "${B}==>${N} $*"; }
ok()   { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*" >&2; }
die()  { echo "${R}✗ $*${N}" >&2; exit 1; }

INTERACTIVE=1; [ -t 0 ] || INTERACTIVE=0
FE_PORT= BE_PORT= HA_PORT= HOST= HA_MODE= HA_URL_ARG= HA_TOKEN_ARG=${HA_TOKEN:-}
SEED=1 INSTALL_BUN=0 SKIP_INSTALL=0 FORCE=0 START=0
while [ $# -gt 0 ]; do
  need() { [ $# -ge 2 ] || die "$1 needs a value"; }
  case $1 in
    -y|--yes|--non-interactive) INTERACTIVE=0 ;;
    --frontend-port) need "$@"; FE_PORT=$2; shift ;;
    --backend-port)  need "$@"; BE_PORT=$2; shift ;;
    --ha-port)       need "$@"; HA_PORT=$2; shift ;;
    --host)          need "$@"; HOST=$2; shift ;;
    --ha)            need "$@"; HA_MODE=$2; shift ;;
    --ha-url)        need "$@"; HA_URL_ARG=${2%/}; HA_MODE=${HA_MODE:-existing}; shift ;;
    --ha-token)      need "$@"; HA_TOKEN_ARG=$2; shift ;;
    --seed) SEED=1 ;; --no-seed) SEED=0 ;;
    --install-bun) INSTALL_BUN=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --force) FORCE=1 ;;
    --start) START=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac; shift
done
case $HA_MODE in ""|mock|existing|none) ;; *) die "--ha must be mock, existing or none" ;; esac

ask() { # ask "question" default -> echoes answer
  local a; read -r -p "$1 [$2]: " a </dev/tty || a=; echo "${a:-$2}"
}
confirm() { # confirm "question" default(y/n)
  [ "$INTERACTIVE" = 1 ] || { [ "$2" = y ]; return; }
  local a; a=$(ask "$1 (y/n)" "$2"); [[ $a =~ ^[Yy] ]]
}
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
valid_port() { [[ $1 =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }

# choose_port NAME DEFAULT GIVEN -> echoes the port. A busy default moves to the next free one;
# a busy port you asked for is an error (non-interactive) or a re-prompt (interactive).
choose_port() {
  local name=$1 p=${3:-$2} given=${3:-}
  while :; do
    if [ "$INTERACTIVE" = 1 ] && [ -z "$given" ]; then p=$(ask "$name port" "$p"); fi
    if ! valid_port "$p"; then
      [ "$INTERACTIVE" = 1 ] || die "$name port '$p' is not a valid port (1024-65535)"
      warn "'$p' is not a valid port"; given=; p=$2; continue
    fi
    if port_busy "$p" && ! [ "${REUSE_PORT:-}" = "$p" ]; then
      if [ "$INTERACTIVE" = 1 ]; then warn "port $p is in use"; given=; p=$((p+1)); continue; fi
      [ -z "$given" ] || die "$name port $p is already in use"
      local q=$p; while port_busy "$q"; do q=$((q+1)); done
      warn "$name port $p is in use, using $q"; p=$q
    fi
    echo "$p"; return
  done
}

retry() { # retry N cmd...
  local n=$1 i; shift
  for ((i=1;i<=n;i++)); do "$@" && return 0; [ "$i" -lt "$n" ] && { warn "attempt $i/$n failed, retrying in 5s"; sleep 5; }; done
  return 1
}

ha_token_ok() { curl -fsS -m 8 -H "Authorization: Bearer $2" "$1/api/" >/dev/null 2>&1; }
env_get() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2-; }

# ---------- 1. prerequisites ----------
info "Checking tools"
command -v curl >/dev/null || die "curl is required"
command -v openssl >/dev/null || warn "openssl not found (only needed for a random setup code fallback)"
if ! command -v bun >/dev/null && [ -x "$HOME/.bun/bin/bun" ]; then export PATH="$HOME/.bun/bin:$PATH"; fi
if ! command -v bun >/dev/null; then
  if [ "$INSTALL_BUN" = 1 ] || confirm "Bun is required but missing. Install it now (curl -fsSL https://bun.sh/install | bash)?" n; then
    retry 2 bash -c 'curl -fsSL https://bun.sh/install | bash' || die "Bun install failed. Install it from https://bun.sh and re-run."
    export PATH="$HOME/.bun/bin:$PATH"
    command -v bun >/dev/null || die "Bun installed but not on PATH; open a new shell and re-run."
  else
    die "Bun is required: https://bun.sh (or pass --install-bun)"
  fi
fi
ok "bun $(bun --version)"
command -v node >/dev/null && ok "node $(node --version)" || warn "node not found; Next.js dev server may need it"

DOCKER_OK=0
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then DOCKER_OK=1; ok "docker + compose"
else warn "Docker (with compose, and a running daemon) not available: the test Home Assistant can't be started"; fi

# ---------- 2. choose Home Assistant mode ----------
if [ -z "$HA_MODE" ]; then
  default=mock; [ "$DOCKER_OK" = 1 ] || default=none
  if [ "$INTERACTIVE" = 1 ]; then
    echo "Home Assistant: (mock) disposable test instance in Docker, (existing) connect to one you run, (none) skip"
    while :; do HA_MODE=$(ask "Mode" "$default"); case $HA_MODE in mock|existing|none) break ;; *) warn "choose mock, existing or none" ;; esac; done
  else HA_MODE=$default; fi
fi
if [ "$HA_MODE" = mock ] && [ "$DOCKER_OK" = 0 ]; then
  [ "$INTERACTIVE" = 1 ] || { warn "falling back to --ha none (no Docker)"; HA_MODE=none; }
  if [ "$HA_MODE" = mock ]; then
    HA_MODE=$(ask "Docker unavailable. Use existing or none?" existing)
    case $HA_MODE in existing|none) ;; *) HA_MODE=none ;; esac
  fi
fi

# ---------- 3. ports and host ----------
info "Choosing ports"
[ -n "$HOST" ] || { HOST=localhost; [ "$INTERACTIVE" = 1 ] && HOST=$(ask "Hostname you'll open the app at" localhost); }
[[ $HOST =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid host '$HOST'"
FE_PORT=$(choose_port "Frontend" 3000 "$FE_PORT") || exit 1
BE_PORT=$(choose_port "Backend" 3001 "$BE_PORT") || exit 1
[ "$FE_PORT" != "$BE_PORT" ] || die "frontend and backend ports must differ"
if [ "$HA_MODE" = mock ]; then
  # our own previous test HA legitimately holds the port when we re-run
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx alice-ha-mock; then REUSE_PORT=${HA_PORT:-$(env_get "$STATE" HA_PORT)}; REUSE_PORT=${REUSE_PORT:-8123}; fi
  HA_PORT=$(choose_port "Test Home Assistant" 8123 "$HA_PORT") || exit 1
  for p in "$FE_PORT" "$BE_PORT"; do [ "$p" != "$HA_PORT" ] || die "ports must all differ"; done
fi
ok "frontend $FE_PORT, backend $BE_PORT${HA_PORT:+, HA $HA_PORT}"

# ---------- 4. install dependencies ----------
if [ "$SKIP_INSTALL" = 0 ]; then
  info "Installing dependencies"
  retry 3 bun install || die "bun install failed (network?). Fix and re-run, or use --skip-install if already installed."
  ok "dependencies installed"
fi

# ---------- 5. env files and keys ----------
info "Writing environment files"
cd "$ROOT/backend"
if [ -f .env ] && [ "$FORCE" = 0 ] && [ -n "$(env_get .env SECRETS_KEY)" ]; then
  warn "backend/.env exists: keeping its keys (use --force to regenerate). Ports/origins are updated."
  # Older setups kept the worker's private key in .env; move it out so the server no longer holds it.
  if [ ! -f .env.worker ]; then
    pk=$(env_get .env ADMIN_SEAL_PRIVATE_KEY)
    [ -n "$pk" ] || die "backend/.env has no ADMIN_SEAL_PRIVATE_KEY and there is no backend/.env.worker; re-run with --force to regenerate keys (existing data tokens become unreadable)."
    cp .env ".env.bak.$(date +%s)"; printf 'ADMIN_SEAL_PRIVATE_KEY=%s\n' "$pk" > .env.worker; chmod 600 .env.worker
    sed -i '/^#\? \?ADMIN_SEAL_PRIVATE_KEY=/d' .env
  fi
else
  [ -f .env ] && cp .env ".env.bak.$(date +%s)" && warn "backed up old backend/.env"
  keys=$(bun run keys:generate 2>&1) || die "key generation failed:"$'\n'"$keys"
  k() { echo "$keys" | grep -E "^$1=" | head -1 | cut -d= -f2-; }
  for v in SECRETS_KEY ADMIN_SEAL_PUBLIC_KEY ADMIN_SEAL_PRIVATE_KEY BACKUP_ENCRYPTION_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
    [ -n "$(k $v)" ] || die "keys:generate did not print $v"
  done
  setup_code=$(openssl rand -hex 6 2>/dev/null || head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > .env <<EOF
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=./data/alice.db
WEBAUTHN_RP_NAME=Alice
SESSION_TTL_HOURS=720
TRUST_PROXY=false
SETUP_CODE=$setup_code
SECRETS_KEY=$(k SECRETS_KEY)
ADMIN_SEAL_PUBLIC_KEY=$(k ADMIN_SEAL_PUBLIC_KEY)
BACKUP_ENCRYPTION_KEY=$(k BACKUP_ENCRYPTION_KEY)
VAPID_PUBLIC_KEY=$(k VAPID_PUBLIC_KEY)
VAPID_PRIVATE_KEY=$(k VAPID_PRIVATE_KEY)
VAPID_SUBJECT=mailto:admin@localhost
EOF
  # The private half goes only to the worker (the point of the server/worker split).
  printf 'ADMIN_SEAL_PRIVATE_KEY=%s\n' "$(k ADMIN_SEAL_PRIVATE_KEY)" > .env.worker
  chmod 600 .env .env.worker
  ok "generated keys and setup code"
fi
# Ports and origins are rewritten on every run so re-running with new ports works.
sed -i '/^\(PORT\|CORS_ORIGINS\|WEBAUTHN_RP_ID\|WEBAUTHN_ORIGIN\)=/d' .env
cat >> .env <<EOF
PORT=$BE_PORT
CORS_ORIGINS=http://$HOST:$FE_PORT
WEBAUTHN_RP_ID=$HOST
WEBAUTHN_ORIGIN=http://$HOST:$FE_PORT
EOF
# A hand-edited .env may lack a setup code; the first sign-up needs one outside production.
grep -q '^SETUP_CODE=.\+' .env || echo "SETUP_CODE=$(openssl rand -hex 6)" >> .env
mkdir -p data
cat > "$ROOT/frontend/.env.local" <<EOF
BACKEND_URL=http://localhost:$BE_PORT
NEXT_PUBLIC_WS_URL=ws://localhost:$BE_PORT/ws
EOF
ok "backend/.env, backend/.env.worker, frontend/.env.local"

# ---------- 6. Home Assistant ----------
HA_URL= HA_TOKEN_OUT=
case $HA_MODE in
mock)
  info "Starting the test Home Assistant (first run pulls a large image; this can take a few minutes)"
  export HA_PORT
  HA_URL="http://127.0.0.1:$HA_PORT"
  if [ "$FORCE" = 1 ]; then bun run ha:down >/dev/null 2>&1; rm -f .env.test; fi
  retry 3 bun run ha:up || die "could not start the test HA container. Check 'docker compose' output above, or re-run with --ha none / --ha existing."
  if [ -f .env.test ] && ha_token_ok "$HA_URL" "$(env_get .env.test HA_TOKEN)" 2>/dev/null; then
    ok "test HA already onboarded, reusing its token"
  else
    rm -f .env.test
    # bootstrap waits up to 3 minutes for HA itself; retry covers slow first boots
    if ! retry 2 env HA_URL="$HA_URL" bun run ha:bootstrap; then
      die "could not onboard the test HA. If it was onboarded earlier without a saved token, reset it: (cd backend && bun run ha:down) then re-run ./setup.sh"
    fi
  fi
  HA_TOKEN_OUT=$(env_get .env.test HA_TOKEN)
  if [ "$SEED" = 1 ]; then
    retry 2 bun run ha:seed && ok "seeded the test home" || warn "seeding failed; Alice still works, rooms/devices just won't be pre-arranged (retry: cd backend && bun run ha:seed)"
  fi ;;
existing)
  HA_URL=${HA_URL_ARG:-}
  while :; do
    if [ -z "$HA_URL" ]; then [ "$INTERACTIVE" = 1 ] || die "--ha existing needs --ha-url"; HA_URL=$(ask "Home Assistant address" "http://homeassistant.local:8123"); fi
    HA_URL=${HA_URL%/}
    [[ $HA_URL =~ ^https?:// ]] || HA_URL="http://$HA_URL"
    if [ -z "$HA_TOKEN_ARG" ]; then
      [ "$INTERACTIVE" = 1 ] || die "--ha existing needs --ha-token (or HA_TOKEN)"
      echo "Create a long-lived token in HA: Profile -> Security -> Long-lived access tokens (an administrator's)."
      read -r -s -p "Token: " HA_TOKEN_ARG </dev/tty; echo
    fi
    if ! curl -fsS -m 8 "$HA_URL/api/onboarding" >/dev/null 2>&1 && ! curl -fsS -m 8 -o /dev/null "$HA_URL/" 2>/dev/null; then
      warn "cannot reach $HA_URL"; ha_bad=1
    elif ! ha_token_ok "$HA_URL" "$HA_TOKEN_ARG"; then warn "$HA_URL is reachable but rejected the token"; ha_bad=1
    else ha_bad=0; fi
    [ "$ha_bad" = 0 ] && break
    if [ "$INTERACTIVE" = 1 ] && confirm "Try again?" y; then HA_URL= HA_TOKEN_ARG=; continue; fi
    [ "$INTERACTIVE" = 1 ] && { warn "continuing without a verified Home Assistant; connect it later in the app"; break; }
    die "Home Assistant check failed (see above)"
  done
  HA_TOKEN_OUT=$HA_TOKEN_ARG
  [ "$ha_bad" = 0 ] && ok "connected to $HA_URL" ;;
none) warn "no Home Assistant configured; connect one in the app later (Alice runs without it)" ;;
esac

# ---------- 7. save state for run.sh ----------
{
  echo "FE_PORT=$FE_PORT"; echo "BE_PORT=$BE_PORT"; echo "HOST=$HOST"; echo "HA_MODE=$HA_MODE"
  [ -n "$HA_PORT" ] && [ "$HA_MODE" = mock ] && echo "HA_PORT=$HA_PORT"
  [ -n "$HA_URL" ] && echo "HA_URL=$HA_URL"
} > "$STATE"
chmod 600 "$STATE"

SETUP_CODE_OUT=$(env_get "$ROOT/backend/.env" SETUP_CODE)
cat <<EOF

${G}${B}Setup complete.${N}
  Start it:        ./run.sh
  Open:            http://$HOST:$FE_PORT
  First sign-up:   setup code  $SETUP_CODE_OUT   (you become the household admin)
EOF
if [ -n "$HA_URL" ]; then
  echo "  Then connect Home Assistant in the app with:"
  echo "    address  ${HA_URL/127.0.0.1/localhost}"
  [ -n "$HA_TOKEN_OUT" ] && echo "    token    $HA_TOKEN_OUT   (also in backend/.env.test for the test HA)"
  [ "$HA_MODE" = mock ] && echo "    HA login admin / alice-test-only (the test instance only)"
fi
echo

[ "$START" = 1 ] && exec "$ROOT/run.sh"
exit 0
