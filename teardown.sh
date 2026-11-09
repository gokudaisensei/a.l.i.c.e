#!/usr/bin/env bash
# Stops Alice and removes what ./setup.sh and ./run.sh created. See ./teardown.sh --help; use --dry-run first.
set -uo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null || { echo "bun not found; nothing here can run without it" >&2; exit 1; }
exec bun backend/scripts/teardown.ts "$@"
