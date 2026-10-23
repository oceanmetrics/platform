# usage: weekly numbers per catalog from Analytics Engine

A Node script (not a Worker, nothing deployed) that asks the Analytics Engine SQL API what the two Workers metered:
`om_gazetteer` (the storage Worker, `places/worker/src/meter.ts`) and `om_alerts` (the alerts Worker,
`workers/alerts/src/http.ts`). Account `af075785741eb60e6e4d482a71fa592d`. Week 5 step 5 of the restructure.

```sh
node workers/usage/usage.mjs                      # both windows, Markdown to stdout, JSON to <out>/usage/<date>.json
node workers/usage/usage.mjs --window 7d          # one window
node workers/usage/usage.mjs --dry-run            # print the SQL, call nothing, needs no token
node workers/usage/usage.mjs --out ~/Library/Logs/oceanmetrics   # default: $TMPDIR/oceanmetrics; a path inside this repo is refused
node workers/usage/usage.mjs --now 2026-10-30T00:00:00Z          # windows end at this instant (default: now)
```

## The token

An API token with **Account Analytics: Read** (the Analytics Engine SQL API needs nothing more), created in the
Cloudflare dashboard (My Profile, API Tokens) for the Ocean Metrics account. The script reads `CF_AE_TOKEN` from the
environment, else from `~/.config/oceanmetrics/cf-ae.env` (`CF_AE_TOKEN=...`, mode 600). It is never printed, never in
an error message, never in the report, never in this repo. `CF_ACCOUNT_ID` overrides the account.

The storage Worker's monthly rollup (`rollupUsage`, which fills the KV usage totals the caps read) needs the same scope
as a Worker secret `CF_API_TOKEN` plus `CF_ACCOUNT_ID`; one token can serve both, but keep a separate one if the caps
should keep working when this file is rotated.

## What it reports

For the last 7 days and the last 30 days (half-open `[now - N days, now)`, whole seconds, UTC):

- per catalog prefix (`blob8`: `gazetteer`, `indicators`, `atlas`, `obis-h3`, `basemap`, `marine-atlas`) and for
  `unlisted` apart: requests `SUM(_sample_interval)`, bytes `SUM(_sample_interval * double1)`, the 206 share (206 of
  200 + 206), the keyed share (`blob1 != ''`) and the anonymous share (the rest);
- the top 5 keys per catalog (`blob1` and its app `blob2`; keyless requests are the anonymous share, not a key);
- errors by prefix and status (`double2 >= 400`);
- the prefixes that are neither a catalog nor `unlisted` (`issues`, `atlas-restricted`, `root`, probing such as
  `backups`);
- `om_alerts`: calls and counts by route and outcome, and the digests sent (route `send`, outcome `digest`: one point
  per mail, `double2` its rows). No address is ever in a point, so none is in the report.

Honest limit: until `storage.oceanmetrics.io` routes to the Worker, or the apps read the Worker URL with their keys,
`om_gazetteer` holds only preview and test traffic. The numbers go into the ledger and the log, not into a repo.

The SQL uses `IF()`, `toDateTime()`, `NOT IN` and `FORMAT JSON`, as the rollup stub does; it has been unit-tested against a
fixture response, and has not yet run against the live API (no token existed on 2026-10-23). If the API rejects a
function, the error text names it (`analytics engine sql 400: ...`) and the fix is in `lib.mjs` only.

## Weekly job on the Mac mini (not installed)

Mondays 07:00 local, the table in `~/Library/Logs/oceanmetrics/usage/last.md`, the JSON in
`~/Library/Logs/oceanmetrics/usage/<date>.json`. Save as `~/Library/LaunchAgents/io.oceanmetrics.usage.plist`, then
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.oceanmetrics.usage.plist`. launchd has no shell profile, so the
token comes from `cf-ae.env`; the log folder is in the home volume (launchd jobs may not write to the external one).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.oceanmetrics.usage</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/bbest/Github/oceanmetrics/platform/workers/usage/usage.mjs</string>
    <string>--out</string>
    <string>/Users/bbest/Library/Logs/oceanmetrics</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/bbest/Library/Logs/oceanmetrics/usage/last.md</string>
  <key>StandardErrorPath</key><string>/Users/bbest/Library/Logs/oceanmetrics/usage/last.err</string>
</dict>
</plist>
```

`mkdir -p ~/Library/Logs/oceanmetrics/usage` first (launchd does not create the folder of `StandardOutPath`). Check the
node path with `command -v node`.

## Develop and test

```sh
npm test -w workers/usage        # vitest in Node: the SQL text per prefix, the date windows, the escaping of a prefix,
                                 # the collector and the table on a fixture response, the token never in a request body or error
npm run typecheck -w workers/usage   # tsc over the .mjs files (JSDoc types)
npm run build -w workers/usage       # node --check: there is nothing to bundle
```

The layouts in `lib.mjs`'s header must follow the Workers' comments. Change a blob's meaning in a Worker and this script
and its tests change in the same commit.
