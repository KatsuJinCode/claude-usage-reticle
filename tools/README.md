# tools/ — single-source-of-truth sync for the reticle artifacts

## Why this exists

The project ships the reticle logic in three artifacts that run in different
contexts but share the same fragile pieces (the claude.ai bar selectors and the
reset-block/title finders):

| artifact | context |
|---|---|
| `usage-reticle.user.js` | Tampermonkey userscript (canonical source) |
| `extension/content/usage-reticle.content.js` | browser extension content script |
| `bookmarklet.html` | zero-install bookmarklet (embedded core) |

When claude.ai changes its DOM, all three break at once — and historically only
some of them got fixed, because the same logic was hand-maintained in three
places. **Issue #8** (the usage-page redesign) was the exact failure this exists
to prevent: the userscript and extension were fixed but the bookmarklet was
missed.

## What gets synced

Only the breakage-prone selector/finder logic, in two marked regions:

- `selectors` — `ALL_BAR_SELECTOR`, `BAR_SELECTOR`
- `finders` — `RESET_RE`, `WEEKDAY_TIME_RE`, `findResetBlock`, `findTitle`, `getWindowHours`

Everything else (multi-provider router, settings panel, rendering, extension
hooks) is **intentionally allowed to differ** between artifacts. The extension
has a trimmed settings panel; the bookmarklet is a lean single-platform build.
Sync does not touch those.

## How to use it

### One-time setup (after cloning)

```bash
bash tools/install-hooks.sh
```

Points git's `core.hooksPath` at `tools/hooks/` so the pre-commit sync check is
active. Idempotent — safe to re-run.

### When editing the selector/finder logic

1. Edit `usage-reticle.user.js` (the canonical source).
2. Run `node tools/sync.js` — regenerates the extension + bookmarklet regions.
3. Stage all three files and commit.

### If a commit is blocked

The pre-commit hook runs `node tools/sync.js --check`. If it blocks:

```
ERROR: synced regions have drifted between the reticle artifacts.
```

You edited one file without syncing the others. Run `node tools/sync.js`,
stage the regenerated files, and re-commit. To bypass for a throwaway commit:
`git commit -n` (never push a `-n` commit that touches the synced regions).

## How it works

The canonical source (`usage-reticle.user.js`) carries marker comments:

```js
// @sync-region selectors
var ALL_BAR_SELECTOR = '...';
var BAR_SELECTOR = '...';
// @sync-end
```

Each target carries the same markers around its copy of that logic.
`sync.js` extracts the body of every region from the source and overwrites the
matching region body in each target, so the three can never diverge.

`--check` mode does the same extraction but only *compares* — it writes nothing
and exits non-zero on drift. That's what the pre-commit hook runs.
