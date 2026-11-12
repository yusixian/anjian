#!/usr/bin/env bash
# Compatibility entry point. Changesets alone decides the product version.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  --check | --audit) node "$REPO_ROOT/scripts/release/versions.mjs" --check ;;
  --sync) node "$REPO_ROOT/scripts/release/versions.mjs" --sync ;;
  *)
    echo 'Use pnpm release:version to consume Changesets, or bump-version.sh --check / --sync.' >&2
    exit 1
    ;;
esac
