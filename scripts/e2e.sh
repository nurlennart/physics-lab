#!/usr/bin/env bash
# Browser tests against the production build (vite preview), independent of /tmp.
# Uses system Chromium libraries when present; otherwise a user-local library bundle
# (PHYSICS_LAB_BROWSER_LIBS, default ~/.local/browser-libs with usr/lib/x86_64-linux-gnu
# and fonts.conf). Extra arguments are passed to `playwright test`.
set -euo pipefail
cd "$(dirname "$0")/.."
LIBS="${PHYSICS_LAB_BROWSER_LIBS:-$HOME/.local/browser-libs}"
if [ -d "$LIBS/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$LIBS/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  [ -f "$LIBS/fonts.conf" ] && export FONTCONFIG_FILE="$LIBS/fonts.conf"
fi
PORT="${PHYSICS_LAB_E2E_PORT:-4173}"
[ "${SKIP_BUILD:-}" = 1 ] || npm run build --silent >/dev/null
npx vite preview --host 127.0.0.1 --port "$PORT" --strictPort >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
PHYSICS_LAB_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
