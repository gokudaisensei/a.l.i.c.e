#!/bin/sh
# Pixel comparison of the front end as it is now against a git ref (default HEAD): the same screens, the same mock home,
# standard text size. Usage: sh e2e/compare-with-head.sh [ref]   (from frontend/). Needs the mock Home Assistant (bun run ha:up).
# The old tree is a throwaway git worktree with hard-linked node_modules (Turbopack refuses a symlinked one); the backend is shared.
set -e
REF=${1:-HEAD}
HERE=$(cd "$(dirname "$0")/.." && pwd); ROOT=$(cd "$HERE/.." && pwd)
WORK=$(mktemp -d); trap 'git -C "$ROOT" worktree remove --force "$WORK/old" 2>/dev/null; git -C "$ROOT" worktree prune; echo "work dir $WORK"' EXIT
git -C "$ROOT" worktree add --detach "$WORK/old" "$REF" >/dev/null
rm -rf "$WORK/old/backend"; ln -s "$ROOT/backend" "$WORK/old/backend"
cp -al "$HERE/node_modules" "$WORK/old/frontend/node_modules"
cp "$HERE/e2e/shots.spec.ts" "$WORK/old/frontend/e2e/"; cp "$HERE/playwright.config.ts" "$WORK/old/frontend/"
mkdir -p "$WORK/old-shots" "$WORK/new-shots"
(cd "$WORK/old/frontend" && SHOTS="$WORK/old-shots" npx playwright test e2e/shots.spec.ts 2>&1 | grep -E "passed|failed")
(cd "$HERE" && SHOTS="$WORK/new-shots" npx playwright test e2e/shots.spec.ts 2>&1 | grep -E "passed|failed")
python3 "$HERE/e2e/compare-shots.py" "$WORK/old-shots" "$WORK/new-shots" "$WORK/diff"
echo "diff images (red = old, cyan = new): $WORK/diff"
trap - EXIT; git -C "$ROOT" worktree remove --force "$WORK/old"; git -C "$ROOT" worktree prune
