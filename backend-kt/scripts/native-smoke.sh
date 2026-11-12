#!/usr/bin/env bash
set -euo pipefail
# Best-effort local native-image smoke build for backend-kt server.
# Requires GraalVM/native-image and a built install distribution.
# Usage: cd backend-kt && ./scripts/native-smoke.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./gradlew :server:installDist --console=plain

CP="$(find server/build/install/server/lib -name '*.jar' | tr '\n' ':')"
OUT="${1:-/tmp/alice-native-smoke}"

native-image -cp "$CP" alice.server.MainKt -o "$OUT" \
  --no-fallback \
  --enable-url-protocols=http,https \
  --initialize-at-build-time=kotlin.DeprecationLevel \
  --report-unsupported-elements-at-runtime \
  -H:+ReportExceptionStackTraces || {
    echo "native-image build failed (best-effort smoke). Check reachability/reflection needs for your GraalVM version." >&2
    exit 1
  }

echo "native smoke binary: $OUT"
