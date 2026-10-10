#!/usr/bin/env bash
# Deploy a tagged commit — never the working tree. The tag is checked out into a clean
# temporary worktree, the full release gate runs there, then the Docker service is rebuilt
# from that checkout. Usage: scripts/deploy.sh <tag> [--skip-checks]
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:?usage: scripts/deploy.sh <tag> [--skip-checks]}"
git rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null || { echo "Unknown tag: $tag" >&2; exit 1; }
dir="$(mktemp -d)"
cleanup() { git worktree remove --force "$dir" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
git worktree add --detach "$dir" "$tag" >/dev/null
echo "Deploying $tag ($(git rev-parse --short "$tag^{commit}")) from a clean checkout"
(
  cd "$dir"
  npm ci --silent
  if [ "${2:-}" != "--skip-checks" ]; then scripts/check.sh; fi
  docker compose -p physics-lab up -d --build
)
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' physics-lab-physics-lab-1 2>/dev/null || echo unknown)"
  [ "$status" = healthy ] && { echo "Live: $tag (container healthy)"; exit 0; }
  sleep 2
done
echo "Container did not become healthy" >&2; exit 1
