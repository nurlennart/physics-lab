#!/usr/bin/env bash
# Release gate: everything that must pass before a commit may be tagged or deployed.
# Usage: scripts/check.sh [--no-e2e]
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$1"; }
step "Typecheck";              npx tsc --noEmit -p .
step "Unit tests";             npx vitest run
step "Physics validation";     node scripts/validate-physics.mjs >/dev/null
echo "validation/latest.md updated"
step "Scale validation";       node scripts/validate-scaling.mjs | tail -1
step "Challenge score guard";  node scripts/check-scores.mjs
step "Production build";       npm run build --silent >/dev/null
echo "dist/ built"
if [ "${1:-}" != "--no-e2e" ]; then step "Browser tests"; SKIP_BUILD=1 scripts/e2e.sh; fi
printf '\nAll release checks passed.\n'
