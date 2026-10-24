#!/usr/bin/env bash
# Retired 2026-10-24: the npm token this script used was revoked by Ben and its env file deleted.
# Every publish of @oceanmetrics/* goes through .github/workflows/publish.yml (trusted publishing, provenance,
# Ben's approval in the `npm` environment). See docs/publishing.md.
echo "scripts/publish.sh is retired: publish with" >&2
echo "  gh workflow run publish.yml -R oceanmetrics/platform -f package=<name> -f dry-run=false" >&2
echo "and ask Ben to approve the run (docs/publishing.md)." >&2
exit 2
