# Changelog

## 0.2.0 (2026-10-23)

- New: analytics, off unless the page passes an id. `<om-nav data-ga="G-…">` loads Google Analytics (GA4) for the page
  once; `data-ga-keep="view,…"` names the query or hash keys kept in page_location. No id ships in the package or in
  any consumer: each reads a build variable (`VITE_GA_ID`, the site's `GA_ID`).
- New: `installGa(id, { anonymize, pageView, keep, win })` (also `@oceanmetrics/nav/ga`, a page without the bar):
  the async gtag.js script, a config with `anonymize_ip: true`, `allow_google_signals: false`,
  `allow_ad_personalization_signals: false` and `send_page_view: false`, its own page_view on load and, with
  `pageView: 'history'` (the default), on each change of the location (pushState, replaceState, popstate, hashchange).
  Every hit carries a rebuilt `page_location` (origin + path + the kept keys): no query or fragment reaches Google.
  Nothing loads for a malformed id, a second call, `window.__om_ga_disabled`, Do Not Track or Global Privacy Control.
  Also `gaLocation`, `gaAllowed`, `GA_ID_RE`, `GA_SRC`.
- The GA4 stream's enhanced measurement "Page changes based on browser history events" must be off (README "Analytics").
- 5,777 B gzip bundled and minified (budget 6,000; 0.1.0 was 4,947).

## 0.1.0 (2026-10-23)

- New: `<om-nav>`, the one navigation bar of the Ocean Metrics apps and site (build week 5 step 3, decision D7). A
  framework-free custom element in Shadow DOM: the ensō mark and wordmark, the three doors (Places, Indicators, Atlas)
  with `current` marked `aria-current="page"`, a place search that goes to `https://oceanmetrics.io/places/?q=<text>`
  on Enter (`search-href`; a cancelable `om-nav-search` event first), "What changed" (`changes-href`, default the
  site's /docs/ until the change feed page lands), Docs, and a slot on the right for the app's own controls.
- Items from the `items` attribute (a JSON array of `{id, label, href, door?}`; bad JSON keeps the defaults); an
  instance's own `mark` and `label`; `home-href`; `nosearch`.
- Styled by the host's semantic tokens (`--bg-surface`, `--text-body`, `--brand-text`, ...), each behind its own
  `--om-nav-<role>` and falling back to the brand v1 light-dark() pair; light and dark from `theme`, else the page's
  `<html data-theme>` (watched), else `prefers-color-scheme`. No external font or stylesheet.
- Below `collapse-at` (860 px) the bar collapses to the mark, the app's controls and a menu button (`.narrow`), the doors,
  search and links in a panel; Escape closes it and returns focus.
- `defineNav(tag?)` and the side-effect entry `@oceanmetrics/nav/define`. The pure rules are exported too:
  `parseItems`, `searchUrl`, `isNarrow`, `schemeOf`, `DEFAULT_ITEMS`, `TOKENS`, `tokenDecl`.
- 4,947 B gzip bundled and minified (budget 6,000).
