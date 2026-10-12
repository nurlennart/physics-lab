# Development, release and deployment workflow

## Branches
- `main` holds reviewed, releasable work only.
- Each working session (human or agent) works on its own branch, e.g. `work/<topic>`, ideally in its own worktree (`git worktree add ../physics-lab-<topic> -b work/<topic>`). Two sessions must never edit the same working tree.
- Merge into `main` only after `npm run check` passes on the branch.

## Test tiers
| Command | What runs | Typical use |
| --- | --- | --- |
| `npm run check:quick` | Incremental typecheck; Vitest files affected by uncommitted changes (module graph) | Inner development loop |
| `npm run test:changed` / `npx vitest run --changed main` | Tests affected by uncommitted changes / by the whole branch | Before committing |
| `npx vitest run <file>` · `scripts/e2e.sh --grep "<title>"` | One unit file · selected browser tests against the production build | Focused regression |
| `npm run test:e2e:quick` | Browser tests without the `@slow` tag (63 of 76; about 2 min): every UI workflow, starter, save/reload and regression except long scored, rigid-body and drive runs | UI changes |
| `npm run check:fast` | Release gate without browser tests | Before merging physics changes |
| `npm run check` | Full release gate | Before tagging (required) |

## Release gate
`npm run check` (`scripts/check.sh`) runs, in order:
1. TypeScript typecheck (incremental; cache in `node_modules/.cache`).
2. Unit and integration tests (Vitest, one worker per core).
3. Physics validation (`validation/latest.md`), scale-validation campaign (`validation/scaling.md`), challenge score guard (`scripts/check-scores.mjs`, compared with `validation/reference-scores.json`), preset operating campaign (`validation/presets.json`) and shaft events (`validation/shaft-events.json`), side by side as five processes.
4. Production bundle (`vite build`; the typecheck already ran).
5. Browser tests against the production bundle (`scripts/e2e.sh`), including the `@slow` tier (complete scored challenges, rigid-body and drive starters). One Playwright worker: the browser simulations are CPU-bound, and two workers on this two-core host were no faster and timed out under load (`PHYSICS_LAB_E2E_WORKERS` overrides).

Each step prints its duration. Validation reports are only rewritten when a result changes, so re-running the gate leaves a clean tree clean.

**Release record.** A complete pass on a clean working tree, with `node_modules` matching `package-lock.json`, writes `<git dir>/physics-lab-verified/<tree hash>`. The record names the source tree, not the commit: a fast-forward merge or a tag of the same tree reuses it.

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
2. If a release record exists for the tag's source tree, the gate already passed on exactly these sources and is not repeated. Otherwise it runs `npm ci` and the full release gate in the worktree (`--recheck` forces this).
3. Rebuilds the `physics-lab` Docker Compose service (port 8080) from that checkout. The image only bundles (`vite build`); the npm download cache persists between builds.
4. Waits for the container health check (probed every second while starting).

Uncommitted or unpushed changes therefore cannot reach the live site.
