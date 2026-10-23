#!/usr/bin/env bash
# publish the @oceanmetrics packages to npm, in dependency-light order, stopping at the first failure.
# usage: scripts/publish.sh [otp]     (the one-time password of the npm account; omit when using a token)
# the token fallback: the primary route is .github/workflows/publish.yml (docs/publishing.md).
# prepack builds each package, so dist is always fresh; run the gates (test, typecheck, build, size) first.
set -euo pipefail

cd "$(dirname "$0")/.."

otp_args=()
if [[ -n "${1:-}" ]]; then
  otp_args=(--otp "$1")
fi

# scripts/publish-check.mjs lists what would publish (a version not yet on npm) and refuses a version older than npm's
publishable=$(node scripts/publish-check.mjs changed --names)
if [[ -z "$publishable" ]]; then
  echo "nothing to publish: every package.json version is already on npm"
  exit 0
fi

for pkg in $publishable; do
  echo "== publishing @oceanmetrics/${pkg}"
  npm publish -w "packages/${pkg}" --access public ${otp_args[@]+"${otp_args[@]}"}
  echo "== @oceanmetrics/${pkg} is at version: $(npm view "@oceanmetrics/${pkg}" version)"
done
