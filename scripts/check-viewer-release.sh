#!/usr/bin/env bash
#
# check-viewer-release.sh — fail when artifacts/src changed since the last
# release tag but the version was not bumped. Use on a version checkout;
# feature branches carry pending Changesets and are not release candidates.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

version="$(jq -r '.version' artifacts/package.json)"

if [[ "${1:-}" == "--require-tag" ]] && ! git rev-parse -q --verify "refs/tags/v$version" > /dev/null; then
  echo "error: main is at version $version but tag v$version does not exist, so its release identity is not established." >&2
  echo "Run the verified Release workflow after this version commit passes CI." >&2
  exit 1
fi

tag="$(git describe --tags --abbrev=0 --match 'v*' 2> /dev/null || true)"
if [[ -z "$tag" ]]; then
  echo "No release tag yet; nothing to compare."
  exit 0
fi

if [[ "v$version" != "$tag" ]]; then
  echo "Version $version is ahead of $tag; it ships as a new release."
  exit 0
fi

if git diff --quiet "$tag" HEAD -- artifacts/src; then
  echo "artifacts/src unchanged since $tag."
  exit 0
fi

echo "error: artifacts/src changed since $tag but the version is still $version." >&2
echo "Add a bilingual changeset and let pnpm release:version prepare the release PR." >&2
git diff --stat "$tag" HEAD -- artifacts/src >&2
exit 1
