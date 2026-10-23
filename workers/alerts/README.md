# om-alerts Worker

The email alerts of the Ocean Metrics indicators: confirmed opt-in, then at most one mail a day (or a week) per address
when the indicators catalog's change files hold something the address watches. Week 5 plan step 2 (decisions D1 Resend
behind a one-function adapter, D2 a KV namespace of its own with the addresses encrypted, D6 here in platform, D8 kinds
`status` and `new` and cadence daily, D9 workers.dev until the zone is active).

**Status (2026-10-23): built and tested; not deployed with its secrets.** The KV namespace `ALERTS`
(`480d45d67202420c9fe94d071dbe904f`) exists on the Ocean Metrics Cloudflare account. Until `ALERTS_KEY` is set every
POST route answers 503 `not_configured` and the cron waits (metric `cron/not_configured`). With `PROVIDER=log` no mail
leaves the Worker: the mails go to the console (addresses redacted) and Analytics Engine. Steps that need the account,
the provider or DNS are marked **BEN-DOES**.

What is watched is the report spec's own selection rules (`@oceanmetrics/catalog/report`: places `*`, `coll:<slug>`,
`set:<id>` or a place id; indicators `*`, `all`, `cat:<term>`, `series:<id>[:*]` or an id; each with excludes), so a
subscription picks up what is published later, and the cron selects exactly the cells the Report view expands for the
same keys (`selectRows`).

## Routes

Base: `https://om-alerts.ben-f07.workers.dev` (then `https://alerts.oceanmetrics.io`, D9). Every body is JSON, at most
16 kB. A browser call from an Origin other than `https://oceanmetrics.io`, `https://www.oceanmetrics.io`,
`http://localhost:*`, `http://127.0.0.1:*` (and `ALLOWED_ORIGINS`) is refused with 403 `origin_not_allowed` before
anything is read or written, preflight included, and gets no CORS headers. A call with no Origin (curl, a mail
client's one-click POST) passes.

| Route | Body | Answer |
|---|---|---|
| `POST /v1/subscribe` | `email`; what is watched as `rules` (`{places:{include,exclude}, indicators:{include,exclude}}`), or `params` (the report's URL keys `{pi, px, ii, ix}`), or `place` (one id), else the default (`coll:places` × `*`); `kinds` (`status`, `new`, `period`; default `["status","new"]`); `cadence` (`daily` default, `weekly`); `title` (≤ 200, no `@`); `source` (`place`, `report`, `alerts`); `turnstile` (the widget's token) | **202** `{ok, status:"pending", expires_in:172800}`, the same for a new, known, suppressed or rate-capped address (no enumeration); the confirmation mail is sent. `x-om-turnstile: skipped` when `TURNSTILE_SECRET` is unset. 400 `bad_email`/`bad_rules`/`bad_kinds`/`bad_cadence`/`bad_title`/`bad_json`; 403 `turnstile_failed`; 429 `rate_limited` with `Retry-After`; 502 `send_failed` |
| `POST /v1/confirm` | `token` (the `t=` of `/alerts/confirm/#t=…`, 43 chars) | **200** `{ok, status:"confirmed", already, manage, subscription}`; the welcome mail with the manage link. A second confirm answers `already: true` and sends nothing; the same watch confirmed twice stays one subscription. 404 `invalid_or_expired` (unknown, or older than 48 h); 400 `bad_token` |
| `POST /v1/manage` | `token` (the manage token), `action`: `list` (default), `update` (`id` + any of `rules`/`params`/`place`, `kinds`, `cadence`, `title`), `delete` (`id`), `unsubscribe` (all) | **200** `{ok, status, subscriptions:[{id, title, rules, kinds, cadence, source, status, confirmed_at, created_at, last_sent}]}` (never the hmac or the address). 403 `bad_token`; 404 `not_found` (unsubscribed, or an old link after a re-subscription) |
| `POST /v1/unsubscribe?t=<manage token>` | `List-Unsubscribe=One-Click` (form encoded, RFC 8058), or JSON `{token}` from the manage page | **200** `{ok, status:"unsubscribed"}`, again on a second call. Ends every subscription of the address. 403 `bad_token`. Not rate limited (the token is the guard) |
| `GET /v1/unsubscribe?t=…` | | **303** to `https://oceanmetrics.io/alerts/manage/#t=…&u=all` (a GET never changes state) |
| `POST /v1/provider-events` | Resend's webhook, Svix-signed (`svix-id`, `svix-timestamp`, `svix-signature`) | **200**; `email.bounced` (not `Transient`) or `email.complained` ends the address's subscriptions and suppresses it. 401 `bad_signature` (or older than 5 min); 503 without `RESEND_WEBHOOK_SECRET` |
| `GET /v1/health` | | **200** `{ok, service, version, provider, turnstile:"on"|"skipped", keyed}` |
| `OPTIONS *` | | 204 with CORS for an allowed Origin |

Other methods are 405, other paths 404. Mail headers: every welcome and digest mail carries
`List-Unsubscribe: <https://…/v1/unsubscribe?t=<manage token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
a plain-text part, and a footer with why it was sent (the watch in words), Manage, Unsubscribe and the status note
("Relative to its own record, not better or worse").

### Tokens

- **Confirm**: 32 random bytes, base64url. Only its SHA-256 is stored (`tok:`), 48 h. It rides in the URL fragment of a
  static page (`/alerts/confirm/#t=`), so it never reaches a server log; only the page's button POSTs it, so a mail link
  scanner confirms nothing.
- **Manage**: `m1.<hmac>.<epoch>.<HMAC-SHA256>`, stateless, signed with a key derived from `ALERTS_KEY`. It names the
  address by its hmac, never the address. When every subscription of an address ends, the epoch moves, so an old link
  cannot manage or end a later re-subscription. The one-click URL carries it in the query (RFC 8058 needs a plain URL),
  which Cloudflare's request logs may show to the account owner.

## The digest (the hourly cron, `0 * * * *`)

1. Read `CHANGES_BASE` `changes/latest.json`. If its `date` is the `cursor`'s and nothing waits (`cursor.pending` 0),
   stop: one fetch, one KV read. A confirm or a manage update clears the cursor so the next run reads again.
2. List the confirmed subscriptions and group them by address (hmac).
3. For each subscription, the change files of `latest.recent` dated after its `last_sent` (or, before its first mail,
   on or after the day it was confirmed). A weekly subscription is due on Mondays (UTC) only.
4. Pick the rows: `selectRows(rules, rows, {indicators, sets})` (the indicators' series, leads and tags and the place
   sets, read from `indicators.json` once per manifest version and kept in KV as `ctx:<version>`), then the
   subscription's kinds. The rows of all due subscriptions of an address are merged (deduplicated by `changeKey`).
5. No rows: the subscriptions' `last_sent` moves to the newest file, no mail. Rows: **one mail per address per day at
   most**: `sent:<hmac>:<day>` is written as `pending` before the send and `sent` after it; a later file of the same
   day waits for the next day. The digest groups the lines by place (name order, at most 10 a place, then a count and
   a link), each line the change file's `sentence` (`changeSentence`) with its card link (`placeViewHref`) and the
   place's Place page (`/places/p/<id>/`).
6. A provider 429, 5xx or network error leaves the marker `pending`: the next hour retries the same files with the
   same idempotency key (`digest:<hmac>:<day>`), so a send that did go through is not sent twice. A 4xx refusal stops
   for the day without moving the window.

## KV layout (`ALERTS`)

| key | value | TTL |
|---|---|---|
| `sub:<id>` | the subscription record, schema `alerts-subscription` 1.0 (`@oceanmetrics/catalog/schemas`): `id, hmac, kinds, cadence, rules, title, source, confirmed_at, created_at, last_sent`; no address, name, organization or ip | 48 h while pending |
| `addr:<hmac>` | `{enc, subs, epoch}`: the address, AES-GCM 256 (`v1.<iv>.<ciphertext>`, the hmac as additional data), and its subscription ids | 48 h while it has no confirmed subscription |
| `tok:<sha256(token)>` | `{id, hmac, exp, used}` | 48 h |
| `sent:<hmac>:<YYYY-MM-DD>` | `{state, upto, at, rows, attempts}` | 40 days |
| `supp:<hmac>` | `{reason: unsubscribed|bounce|complaint, at, epoch}`: what is left of an address that left (a bounce or complaint is never mailed again; an unsubscribed address may subscribe anew) | none |
| `ctx:<manifest version>` | the rules' context | 3 days |
| `cursor` | `{date, pending, checked_at}` | none |
| `rl:<route>:<hmac(ip)[:16]>:<window>` | a request count (the ip is never stored) | the window + 60 s |

The hmac is HMAC-SHA256 of the address trimmed and lower-cased. AES, HMAC, token and ip keys are all derived from the
one secret `ALERTS_KEY` (HKDF-SHA256, salt `om-alerts`). The address appears in plaintext only in the Worker's memory
while a mail is sent, and in the provider's request.

## Limits and metering

- Rate limits (KV counters, approximate as KV is eventually consistent): subscribe 5 per 10 min per ip, confirm 20,
  manage 30; three confirmation mails an hour per address whatever the ip (beyond that the answer is the same 202 and
  no mail); 20 subscriptions per address.
- Analytics Engine `om_alerts`, one point per route call, mail and cron run: `index1` route; `blob1` route, `blob2`
  outcome (`pending`, `confirmed`, `again`, `duplicate`, `rate_limited`, `turnstile_failed`, `suppressed`, `one_click`,
  `digest`, `digest_retry`, `logged`, `idle`, `run`, …), `blob3` provider, `blob4` origin; `double1` http status (0 for
  the cron), `double2` count (rows of a digest, subscriptions ended). Never an address (a test asserts no `@` in any
  point or log line).

## Develop and test

```sh
# from the platform root: `npm test` runs every package's vitest, then this Worker's own `npm test`
npm test -w workers/alerts       # builds status and catalog (dist), checks for addresses, compiles the schema validator, vitest in workerd
npm run typecheck -w workers/alerts
npm run build -w workers/alerts  # wrangler deploy --dry-run --minify to dist/ (the size line in scripts/size-budget.mjs)
```

The tests run in workerd (`@cloudflare/vitest-plugin`) over the real local KV, with a fake network (Resend, Turnstile,
the catalog files in `test/fixtures/`), a fixed clock and a fake Analytics Engine; storage is reset after each test.
`scripts/schema-validator.mjs` compiles the `alerts-subscription` schema with ajv into standalone code in
`test/generated/` (git-ignored; workerd refuses code generated at run time), and the tests validate every `sub:`
record written. `scripts/no-addresses.mjs` fails on any address in this folder but `alerts@mail.oceanmetrics.io` and
RFC 2606 examples, with a seeded fault. Locally: put a throwaway `ALERTS_KEY="$(openssl rand -base64 32)"` in
`.dev.vars` (git-ignored), `npx wrangler dev --test-scheduled`, then `curl localhost:8787/__scheduled?cron=0+*+*+*+*`.

## Runbook

1. **Done 2026-10-23**: `npx wrangler kv namespace create ALERTS` → `480d45d67202420c9fe94d071dbe904f` (in `wrangler.toml`).
   Analytics Engine is on for the account (`om_gazetteer`); `om_alerts` is created on first write.
2. Deploy in log mode (no secret): `npx wrangler deploy` from `workers/alerts/` on the mini. `curl <base>/v1/health`
   says `provider: log, keyed: false`; the POST routes answer 503 until step 3.
3. **BEN-DOES** the secrets, from `~/.config/oceanmetrics/alerts.env` on the mini (mode 600, never in a repo or chat,
   the `r2.env` pattern), each with `wrangler secret put <NAME>` reading stdin, e.g.
   `set -a; . ~/.config/oceanmetrics/alerts.env; set +a; printf %s "$ALERTS_KEY" | npx wrangler secret put ALERTS_KEY`:
   - `ALERTS_KEY`: `openssl rand -base64 32`, made once. **Keep a copy in `alerts.env` and never rotate it casually**:
     a new key cannot decrypt the stored addresses and changes every hmac (all subscriptions orphaned); a rotation needs
     a re-encrypt script that is not written.
   - `TURNSTILE_SECRET`: the widget for `oceanmetrics.io` and `localhost` (dashboard, Turnstile). The site key is public
     and goes in the alerts form page. Until it is set the check is skipped and every subscribe answer says
     `x-om-turnstile: skipped`.
   - `RESEND_KEY`: a sending-only key scoped to `mail.oceanmetrics.io` (step 4).
   - `RESEND_WEBHOOK_SECRET` (optional, `whsec_…`): Resend dashboard, Webhooks, endpoint
     `<base>/v1/provider-events`, events `email.bounced` and `email.complained`.
   - `REPLY_TO` (optional): a var or secret, never committed.
4. **BEN-DOES** Resend (D1, the free plan): an account on Ben's oceanmetrics.io address; add the domain
   `mail.oceanmetrics.io` (region us-east-1); publish the records the dashboard shows, at Squarespace (authoritative)
   and in the pending Cloudflare zone, both, so the nameserver switch drops nothing:
   - DKIM: TXT `resend._domainkey.mail` = the `p=…` key from the dashboard;
   - the bounce (return-path) domain: MX `send.mail` → `feedback-smtp.us-east-1.amazonses.com` priority 10, and TXT
     `send.mail` = `v=spf1 include:amazonses.com ~all` (take the exact values from the dashboard);
   - DMARC: the root `_dmarc.oceanmetrics.io` covers the subdomain; DKIM signs as `mail.oceanmetrics.io`, so it aligns.
   Verify in the dashboard, then create the sending-only key (step 3).
5. Switch: set `PROVIDER = "resend"` in `wrangler.toml` (or `--var PROVIDER:resend`) and deploy. Smoke: subscribe
   Ben's own address through the alerts page, confirm, wait for the next cron with a change; Gmail "Show original"
   reads SPF, DKIM and DMARC PASS; `curl <base>/v1/health` says `provider: resend, turnstile: on, keyed: true`.
6. Later (D9): once the zone is active, uncomment the `routes` custom domain `alerts.oceanmetrics.io`, set
   `API_BASE` to it, and change the pages' `om-alerts-api` meta. Mails sent before keep working: the old workers.dev
   URL stays up. When the storage Worker serves `storage.oceanmetrics.io/indicators/`, `CHANGES_BASE` may move there.

**Cost: $0 at pilot size.** Workers Free (100,000 requests a day, cron included, 10 ms CPU an invocation); KV free
(100,000 reads and 1,000 writes a day: a subscribe is about 5 writes, a confirm 4, a digest 2 plus one per
subscription); Analytics Engine free; Turnstile free; Resend free (3,000 mails a month, 100 a day). Beyond that: Resend
Pro $20 a month (50,000, no daily cap), Workers Paid $5 a month if a cron run passes Free's CPU limit (watch it with
`wrangler tail` on a day with a large change file: the 868-row OBIS day of 2026-10-23 ran in a local smoke) or
needs more than Free's 50 subrequests a run (one per change file and mail).

## The pages (for the website)

The confirm and manage pages are static pages on oceanmetrics.io that POST; their HTML is in `pages/`, to port into
the Hugo layouts with the scripts as they are:

- [`pages/confirm.html`](pages/confirm.html): `/alerts/confirm/#t=<token>`. One button, Confirm; then a link to
  manage. 0.7 kB gzip of script.
- [`pages/manage.html`](pages/manage.html): `/alerts/manage/#t=<manage token>` (and `&u=all` from the Unsubscribe
  link and the GET redirect, which shows the Unsubscribe from all button first). Lists the address's alerts on load
  (read only), changes the kinds and the cadence of one, deletes one, or unsubscribes from all. 1.7 kB gzip of script.

The website also needs `/alerts/` (the form: the address, what is watched read from the query, `?place=NMS:CINMS` or
the report keys `pi px ii ix` with `title`, the kinds and cadence, the Turnstile widget, a POST to `/v1/subscribe` as
in the table above) and `/alerts/privacy/` (what is kept: the KV layout above, in words; pending requests 48 h; an
unsubscribe deletes the record and keeps only the address's fingerprint). Each page reads the API base from
`<meta name="om-alerts-api" content="https://om-alerts.ben-f07.workers.dev">`.
