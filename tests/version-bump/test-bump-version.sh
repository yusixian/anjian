#!/usr/bin/env bash
# The old arbitrary bump contract is replaced by Changesets + manifest synchronization.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
node --test tests/versioning/*.test.mjs
bash scripts/bump-version.sh --check
if bash scripts/bump-version.sh 9.9.9; then
  echo 'Legacy bump unexpectedly accepted an independent version' >&2
  exit 1
fi
