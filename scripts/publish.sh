#!/usr/bin/env bash
# publish the four @oceanmetrics packages to npm, in dependency-light order, stopping at the first failure.
# usage: scripts/publish.sh [otp]     (the one-time password of the npm account; omit when using a token)
# prepack builds each package, so dist is always fresh; run the gates (test, typecheck, build, size) first.
set -euo pipefail

cd "$(dirname "$0")/.."

otp_args=()
if [[ -n "${1:-}" ]]; then
  otp_args=(--otp "$1")
fi

for pkg in status places map catalog; do
  echo "== publishing @oceanmetrics/${pkg}"
  npm publish -w "packages/${pkg}" --access public ${otp_args[@]+"${otp_args[@]}"}
  echo "== @oceanmetrics/${pkg} is at version: $(npm view "@oceanmetrics/${pkg}" version)"
done
