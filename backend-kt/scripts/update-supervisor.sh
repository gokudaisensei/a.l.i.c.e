#!/usr/bin/env bash
set -euo pipefail

# Supervisor for Alice update handoff. The server writes `update-requested.json` next to the
# database when an install or rollback is requested; this script carries it out.
#
# Marker: {"kind":"install"|"rollback","version":"x.y.z","artifactSha256":"..."|null,"requestedAt":...}
#
#   install   downloads $ALICE_ARTIFACT_BASE_URL/<version>/alice.tar.gz, checks its sha256, unpacks it beside
#             $ALICE_DIST_DIR, swaps it in (keeping the old one as $ALICE_DIST_DIR.prev.<time>) and restarts.
#             If anything fails the old version is put back and restarted, and the marker is kept.
#   rollback  puts the newest $ALICE_DIST_DIR.prev.* back.
#
# An install with no checksum is refused unless ALICE_ALLOW_UNVERIFIED=1.
#
# Usage:
#   ALICE_DB_PATH=/path/to/alice.db ALICE_SERVICE=alice.service ALICE_DIST_DIR=/opt/alice \
#   ALICE_ARTIFACT_BASE_URL=https://example/releases ./update-supervisor.sh [--once]

DB_PATH="${ALICE_DB_PATH:-data/alice.db}"
SERVICE="${ALICE_SERVICE:-}"
DIST_DIR="${ALICE_DIST_DIR:-}"
ARTIFACT_BASE_URL="${ALICE_ARTIFACT_BASE_URL:-}"
ALLOW_UNVERIFIED="${ALICE_ALLOW_UNVERIFIED:-0}"
ONCE="${1:-}"

log() { echo "[update-supervisor] $*" >&2; }

marker_for_db() {
  if [[ "$1" == ":memory:" ]]; then echo "data/update-requested.json"; else echo "$(dirname "$1")/update-requested.json"; fi
}

service() { [[ -z "$SERVICE" ]] || systemctl "$1" "$SERVICE"; }

fetch_and_unpack() { # version sha dest
  # Each step is checked by hand: this runs inside `||` lists, where `set -e` does not apply.
  local version="$1" sha="$2" dest="$3" tmp
  tmp="$(mktemp)"
  if ! curl -fsSL "$ARTIFACT_BASE_URL/$version/alice.tar.gz" -o "$tmp"; then
    log "could not download $version"; rm -f "$tmp"; return 1
  fi
  if [[ -n "$sha" ]] && ! echo "$sha  $tmp" | sha256sum -c - >/dev/null 2>&1; then
    log "checksum mismatch for $version"; rm -f "$tmp"; return 1
  fi
  rm -rf "$dest"; mkdir -p "$dest"
  if ! tar -xzf "$tmp" -C "$dest"; then
    log "could not unpack $version"; rm -f "$tmp"; return 1
  fi
  rm -f "$tmp"
}

apply_marker() {
  local marker="$1"
  [[ -f "$marker" ]] || return 0
  local kind version sha
  kind=$(jq -r '.kind // "install"' "$marker")
  version=$(jq -r '.version // empty' "$marker")
  sha=$(jq -r '.artifactSha256 // empty' "$marker")
  [[ -n "$version" ]] || { log "invalid marker: missing version"; return 1; }
  [[ -n "$DIST_DIR" ]] || { log "ALICE_DIST_DIR is not set; leaving the request in place"; return 1; }
  log "request: kind=$kind version=$version sha=${sha:-none}"

  local stamp prev
  stamp="$(date +%s)"
  prev="$DIST_DIR.prev.$stamp"

  if [[ "$kind" == "rollback" ]]; then
    local newest
    newest=$(ls -d "$DIST_DIR".prev.* 2>/dev/null | sort | tail -n 1 || true)
    [[ -n "$newest" ]] || { log "nothing to roll back to"; return 1; }
    service stop || true
    mv "$DIST_DIR" "$DIST_DIR.rolledback.$stamp"
    mv "$newest" "$DIST_DIR"
  else
    [[ -n "$ARTIFACT_BASE_URL" ]] || { log "ALICE_ARTIFACT_BASE_URL is not set; leaving the request in place"; return 1; }
    if [[ -z "$sha" && "$ALLOW_UNVERIFIED" != "1" ]]; then
      log "refusing to install $version without a checksum (set ALICE_ALLOW_UNVERIFIED=1 to override)"
      return 1
    fi
    fetch_and_unpack "$version" "$sha" "$DIST_DIR.new" || { rm -rf "$DIST_DIR.new"; return 1; }
    service stop || true
    mv "$DIST_DIR" "$prev"
    mv "$DIST_DIR.new" "$DIST_DIR"
  fi

  if ! service start; then
    log "the new version did not start; restoring the previous one"
    rm -rf "$DIST_DIR.failed" && mv "$DIST_DIR" "$DIST_DIR.failed"
    [[ "$kind" == "rollback" ]] && mv "$DIST_DIR.rolledback.$stamp" "$DIST_DIR" || mv "$prev" "$DIST_DIR"
    service start || true
    return 1
  fi

  rm -f "$marker"
  log "done: $kind $version"
}

MARKER="$(marker_for_db "$DB_PATH")"
log "watching $MARKER"
if [[ "$ONCE" == "--once" ]]; then
  apply_marker "$MARKER"
  exit $?
fi

while true; do
  [[ -f "$MARKER" ]] && { apply_marker "$MARKER" || log "apply failed; will retry"; }
  sleep 10
done
