#!/usr/bin/env bash
#
# install-hooks.sh — point git's hooks directory at the committed tools/hooks/
# so the pre-commit sync check is active for this clone. Run once after cloning.
#
#   bash tools/install-hooks.sh
#
# Uses core.hooksPath (committed hooks that ship with the repo) rather than
# .git/hooks/ (per-clone, not committed, easy to forget on a fresh checkout).
# Idempotent — safe to re-run.
#
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "Not inside a git repository." >&2
    exit 1
}

hooks_dir="$root/tools/hooks"
if [ ! -d "$hooks_dir" ]; then
    echo "Missing $hooks_dir — is this the right repo?" >&2
    exit 1
fi

chmod +x "$hooks_dir"/*
git config core.hooksPath "$hooks_dir"
echo "Installed git hooks from $hooks_dir"
echo "  core.hooksPath = $(git config core.hooksPath)"
echo "The pre-commit hook will block commits where the synced reticle regions drift."
echo "To bypass for a throwaway commit: git commit -n"
