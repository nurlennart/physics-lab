#!/usr/bin/env bash
# Release gate: everything that must pass before a commit may be tagged or deployed.
# Usage: scripts/check.sh [--no-e2e]
#
# A complete pass (browser tests included) on a clean working tree records the tree hash in
# <git dir>/physics-lab-verified/. scripts/deploy.sh accepts that record for a tag with the
# identical tree instead of re-running the same gate on the same sources.
set -euo pipefail
cd "$(dirname "$0")/.."
started=$SECONDS
step() { printf '\n== %s\n' "$1"; step_started=$SECONDS; }
took() { printf '   (%ss)\n' "$((SECONDS - step_started))"; }

tree="" clean_tree=""
if git rev-parse -q --verify HEAD >/dev/null && [ -z "$(git status --porcelain)" ]; then
  tree="$(git rev-parse 'HEAD^{tree}')" clean_tree=1
fi

step "Typecheck"
mkdir -p node_modules/.cache
npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc.tsbuildinfo -p .; took

step "Unit and integration tests"
npx vitest run; took

# The Node campaigns are independent single-threaded processes: run them side by side.
step "Physics validation, scale validation, challenge score guard, preset campaign, shaft events, solar and hybrid energy"
logs="$(mktemp -d)"
node scripts/validate-physics.mjs >"$logs/physics" 2>&1 & physics=$!
node scripts/validate-scaling.mjs >"$logs/scaling" 2>&1 & scaling=$!
node scripts/check-scores.mjs >"$logs/scores" 2>&1 & scores=$!
node scripts/check-presets.mjs >"$logs/presets" 2>&1 & presets=$!
node scripts/check-shaft-events.mjs >"$logs/shaft" 2>&1 & shaft=$!
node scripts/check-solar.mjs >"$logs/solar" 2>&1 & solar=$!
node scripts/check-hybrid.mjs >"$logs/hybrid" 2>&1 & hybrid=$!
failed=0
for job in "physics:$physics" "scaling:$scaling" "scores:$scores" "presets:$presets" "shaft:$shaft" "solar:$solar" "hybrid:$hybrid"; do
  if ! wait "${job#*:}"; then failed=1; echo "-- ${job%%:*} FAILED:"; cat "$logs/${job%%:*}"; fi
done
tail -1 "$logs/physics"; tail -1 "$logs/scaling"; tail -1 "$logs/scores"; tail -1 "$logs/presets"; echo "shaft events: $(grep -c '"pass": true' "$logs/shaft") passed"
tail -1 "$logs/solar"; tail -1 "$logs/hybrid"
rm -rf "$logs"
[ "$failed" = 0 ] || exit 1
took

step "Production build"
npx vite build --logLevel warn; took

if [ "${1:-}" = "--no-e2e" ]; then
  printf '\nFast checks passed in %ss (browser tests skipped; no release record written).\n' "$((SECONDS - started))"
  exit 0
fi
step "Browser tests"; SKIP_BUILD=1 scripts/e2e.sh; took

# Record the verified tree only if nothing changed while the gate ran.
if [ -n "$clean_tree" ] && [ -z "$(git status --porcelain)" ] && [ "$(git rev-parse 'HEAD^{tree}')" = "$tree" ]; then
  if node scripts/installed-matches-lock.mjs; then
    record="$(git rev-parse --git-common-dir)/physics-lab-verified"
    mkdir -p "$record"
    printf 'commit %s\nverified %s\nnode %s\n' "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(node --version)" >"$record/$tree"
    echo "Recorded release-gate pass for tree $tree."
  fi
else
  echo "Working tree was not clean: no release record written (deploy will re-run the gate)."
fi
printf '\nAll release checks passed in %ss.\n' "$((SECONDS - started))"
