# Publishing `@oceanmetrics/*` to npm

Publishing is `.github/workflows/publish.yml`: npm **trusted publishing** (OIDC, no token) with provenance, and a GitHub
environment reviewer as the human step (decision D11). `scripts/publish.sh` with a token is the fallback until the
steps below are done. Why now: npm ends direct publishing with 2FA-bypass tokens around January 2027
([GitHub changelog, 2026-07-08](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/));
the granular token in use expires 2027-01-20.

## What the workflow does

`Actions` -> `publish` -> `Run workflow`, from `main` (the jobs refuse any other ref):

| input | values | default |
| --- | --- | --- |
| `package` | `changed`, `status`, `places`, `map`, `catalog`, `engine`, `nav` | `changed` |
| `dry-run` | true / false | **true** |

1. **`check` job** (no environment, so a dry run never waits for anyone): Node 22 and npm 11, `npm ci`, then the gates
   `npm run build`, `npm test`, `npm run typecheck`, `npm run size` (build first: catalog imports status from its
   `dist/`). Then `scripts/publish-check.mjs` and `npm publish --dry-run` for each package it lists. It fails when the
   requested package's `version` is already on npm, or is older than the highest version there, or when `changed` finds
   nothing to publish. The step summary lists what would publish.
2. **`publish` job**, only when `dry-run` is unticked: `environment: npm` (the reviewer approves before the job starts),
   `permissions: id-token: write, contents: read`, `npm ci`, `npm run build`, the check again (the registry may have moved),
   then `npm publish -w packages/<name> --provenance --access public` per package in dependency order (status, places,
   map, catalog, engine, nav). There is no token: no `registry-url`, no `NODE_AUTH_TOKEN`, so npm exchanges the job's OIDC
   token for a short-lived publish credential. The step summary gets, per package, the npm page and the Sigstore
   transparency-log entry, then the registry's `dist.attestations` URL.

`scripts/publish-check.mjs [changed|<name>] [--names]` is the same check from a shell. It reads `packages/*/package.json`
and `npm view @oceanmetrics/<name> versions --json`, prints one row per package (`publish`, `published` or `older`) and
changes nothing. `scripts/publish.sh` calls it too, so the token fallback publishes only what is not on npm yet.

## One-time setup (Ben)

Do these in order. Nothing here is done by the workflow or by Claude.

### 1. GitHub: the `npm` environment (create it before the first run)

`oceanmetrics/platform` -> Settings -> Environments -> New environment -> `npm`.

- **Required reviewers**: add `bbest`. If Ben is the only collaborator, also untick "Prevent self-review", or no run
  can ever be approved.
- **Deployment branches and tags**: selected branches, `main` only.
- No secrets, no variables.

If the environment does not exist when the first run reaches `publish`, GitHub creates it **without** a reviewer and the
job goes straight through. The first run is a dry run by default (the `publish` job is skipped), but create the
environment first anyway.

### 2. npmjs.com: a trusted publisher on each package (six times)

For each of `@oceanmetrics/status`, `places`, `map`, `catalog`, `engine`, `nav` (all exist on npm as `0.0.0-stage`
placeholders or later): package page -> Settings -> Publishing access -> Trusted Publisher -> GitHub Actions, and enter

| field | value |
| --- | --- |
| Organization or user | `oceanmetrics` |
| Repository | `platform` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |

Changing trusted publishing configuration needs your 2FA at that moment. The workflow filename is case sensitive and
must be the file name only (`publish.yml`, not the path). Leave "Require two-factor authentication and disallow tokens"
alone for now: it also blocks the fallback.

### 3. The first provenance publish: a test on `@oceanmetrics/status`

1. On a branch, bump `packages/status` to the next patch (`0.1.1` -> `0.1.2`) with its `CHANGELOG.md` entry, as for any
   release; merge to `main` once CI is green.
2. Run `publish` with `package: status`, `dry-run` true. Read the step summary: `status` is the only package listed.
3. Run it again with `dry-run` false, approve the deployment, and wait for the job.
4. Check the result:
   ```sh
   npm view @oceanmetrics/status@0.1.2 dist.attestations
   ```
   shows a provenance attestation, and the npm page for that version says "Built and signed on GitHub Actions".
5. If npm answers 404 or "unable to authenticate", the trusted publisher entry does not match: re-check the four fields
   above (the repository and the workflow name are the usual slips) and re-run; nothing was published.
6. Repeat for the other packages as each needs a release (`package: changed` publishes every package whose version is
   not on npm; the trusted publisher entry must exist on each of them first, or that package fails and the run stops).

### 4. Then the token goes

After step 3 works for `status` and the other five have their entries:

1. npmjs.com -> Access Tokens: **revoke** the granular token (it expires 2027-01-20 anyway).
2. On the mini: delete the `_authToken` line from `~/.npmrc`, and delete `~/.config/oceanmetrics/npm.env`.
3. Per package, set "Require two-factor authentication and disallow tokens" (Settings -> Publishing access).
4. Tell the next session so `CLAUDE.md` and the README stop naming the token route, and `scripts/publish.sh` goes or
   becomes a pointer to this page.

## The fallback until then

`scripts/publish.sh` with the token (`~/.npmrc` on the mini) or with a one-time password:

```sh
npm ci && npm run build && npm test && npm run typecheck && npm run size
node scripts/publish-check.mjs          # what would publish
scripts/publish.sh [otp]                # only the packages whose version is not on npm yet
```

## If npm changes the flow

D11 chose `npm publish --provenance` with the environment reviewer as the approval. If npm later requires staged
publishing (`npm stage publish`, approved by a human with `npm stage approve <id>`), only the `npm publish` line of the
`publish` job changes; the environment, the check and the OIDC permissions stay. This workflow was written without a
live run: the first test publish in step 3 is also its first execution.
