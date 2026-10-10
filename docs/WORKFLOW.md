# Development, release and deployment workflow

## Branches
- `main` holds reviewed, releasable work only.
- Each working session (human or agent) works on its own branch, e.g. `work/<topic>`, ideally in its own worktree (`git worktree add ../physics-lab-<topic> -b work/<topic>`). Two sessions must never edit the same working tree.
- Merge into `main` only after `npm run check` passes on the branch.

## Release gate
`npm run check` (`scripts/check.sh`) runs, in order:
1. TypeScript typecheck.
2. Unit tests (Vitest).
3. Physics validation (`validation/latest.md`).
4. Scale-validation campaign (`validation/scaling.md`).
5. Challenge score guard (`scripts/check-scores.mjs`, compared with `validation/reference-scores.json`).
6. Production build.
7. Browser tests against the production bundle (`scripts/e2e.sh`).

`npm run check:fast` skips the browser tests.

**Score changes.** If a physics or scoring change deliberately alters a challenge's reference result, re-record with `node scripts/check-scores.mjs --update`. Explain the change in the commit message.

**Browser tests** need Chromium's system libraries. Where they are not installed system-wide, `scripts/e2e.sh` uses a user-local bundle in `~/.local/browser-libs` (`usr/lib/x86_64-linux-gnu`, `usr/share/fonts`, `fonts.conf`). Set `PHYSICS_LAB_BROWSER_LIBS` to override the location.

## Deployment
Deploy tags, never the working tree:

```
git tag -a deploy-YYYY-MM-DD -m "…" && git push --tags
scripts/deploy.sh deploy-YYYY-MM-DD
```

`scripts/deploy.sh` does the following:
1. Checks the tag out into a clean temporary worktree.
2. Runs `npm ci` and the full release gate.
3. Rebuilds the `physics-lab` Docker Compose service (port 8080) from that checkout.
4. Waits for the container health check to pass.

Uncommitted or unpushed changes therefore cannot reach the live site.
