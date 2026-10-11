#!/usr/bin/env bash
# Deploy a tagged commit — never the working tree. The tag is checked out into a clean
# temporary worktree and the Docker service is rebuilt from that checkout.
#
# The release gate (scripts/check.sh) must have passed for the tag's exact source tree. If a
# complete gate run already recorded that tree (scripts/check.sh on a clean checkout of the
# same commit or of any commit with an identical tree), it is not repeated; otherwise the
# worktree is installed with `npm ci` and the full gate runs there first.
#
# Usage: scripts/deploy.sh <tag> [--recheck | --skip-checks]
#   --recheck      run the full gate in the clean worktree even if the tree is recorded
#   --skip-checks  deploy without any gate (emergency only)
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:?usage: scripts/deploy.sh <tag> [--recheck | --skip-checks]}"
mode="${2:-}"
git rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null || { echo "Unknown tag: $tag" >&2; exit 1; }
tree="$(git rev-parse "$tag^{tree}")"
record="$(git rev-parse --git-common-dir)/physics-lab-verified/$tree"
dir="$(mktemp -d)"
cleanup() { git worktree remove --force "$dir" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
git worktree add --detach "$dir" "$tag" >/dev/null
echo "Deploying $tag ($(git rev-parse --short "$tag^{commit}")) from a clean checkout"
(
  cd "$dir"
  if [ "$mode" = "--skip-checks" ]; then
    echo "Release gate skipped (--skip-checks)."
  elif [ "$mode" != "--recheck" ] && [ -f "$record" ]; then
    echo "Release gate already passed for this source tree ($(sed -n 's/^verified //p' "$record"), commit $(sed -n 's/^commit //p' "$record" | cut -c1-7)); not repeating it. Use --recheck to force."
  else
    npm ci --silent
    scripts/check.sh
  fi
  docker compose -p physics-lab up -d --build
)
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' physics-lab-physics-lab-1 2>/dev/null || echo unknown)"
  [ "$status" = healthy ] && { echo "Live: $tag (container healthy)"; exit 0; }
  sleep 2
done
echo "Container did not become healthy" >&2; exit 1
