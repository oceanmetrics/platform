# Changelog

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
