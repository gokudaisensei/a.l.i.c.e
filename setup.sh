#!/usr/bin/env bash
# Alice setup. All the logic is in backend/scripts/setup.ts (run ./setup.sh --help for options);
# this wrapper only makes sure Bun exists, since Bun is what runs the real script.
set -uo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null; then
  install=0; for a in "$@"; do [ "$a" = --install-bun ] && install=1; done
  if [ "$install" = 0 ] && [ -t 0 ]; then
    read -r -p "Bun is required but missing. Install it now (curl -fsSL https://bun.sh/install | bash)? [y/N] " a
    [[ $a =~ ^[Yy] ]] && install=1
  fi
  [ "$install" = 1 ] || { echo "Bun is required: https://bun.sh (or pass --install-bun)" >&2; exit 1; }
  command -v curl >/dev/null || { echo "curl is required to install Bun" >&2; exit 1; }
  curl -fsSL https://bun.sh/install | bash || { echo "Bun install failed. Install it from https://bun.sh and re-run." >&2; exit 1; }
  command -v bun >/dev/null || { echo "Bun installed but not on PATH; open a new shell and re-run." >&2; exit 1; }
fi
exec bun backend/scripts/setup.ts "$@"
