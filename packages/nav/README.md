# @oceanmetrics/nav

The one navigation bar of the Ocean Metrics apps and site (decision D7): `<om-nav>`, a framework-free custom element in
Shadow DOM. It shows the Ocean Metrics mark, the three doors (Places, Indicators, Atlas) with the current app marked, a
place search, "What changed", Docs, and a slot on the right for the app's own controls. Places, the indicators viewer,
the atlas (off for an instance whose `instance.json` says `"nav": false`) and the Hugo site all use it, so the bar is
written once and cannot drift when one app restyles.

```ts
import '@oceanmetrics/nav/define'           // registers <om-nav> (once; a no-op without custom elements)
// or
import { defineNav } from '@oceanmetrics/nav'
defineNav()                                 // or defineNav('om-platform-bar') for another tag
```

```html
<om-nav current="indicators">
  <button type="button">Theme</button>      <!-- the app's own controls, on the right -->
</om-nav>
```

No framework, no external font or stylesheet, no network request. 4.9 kB gzip bundled and minified (see Size).

## API

### Attributes

| attribute | default | what it does |
|---|---|---|
| `current` | none | the id of the item to mark as the page (`aria-current="page"`): `places`, `indicators`, `atlas`, or any id of `items` |
| `items` | the five below | a JSON array of `{ "id", "label", "href", "door"? }`. Doors (`"door": true`) sit left of the search, links right of it. An entry without `id`, `label` or `href` is dropped; bad JSON, or no valid entry, keeps the defaults |
| `changes-href` | `https://oceanmetrics.io/docs/` | the href of the item whose id is `changes` ("What changed"). It points at the site's /docs/ until the change feed page lands (build week 5 step 3, the front page's "What changed"); then the site and the apps set it |
| `search-href` | `https://oceanmetrics.io/places/` | where the place search goes: this url with `q=<text>` set (its other keys kept); relative urls resolve against the page |
| `nosearch` | absent | drop the search field |
| `home-href` | `https://oceanmetrics.io/` | where the mark goes |
| `mark` | the inline ensō mark | an image url to show instead of the mark (an instance's own mark) |
| `label` | `Ocean Metrics` | the wordmark text and the accessible names ("`<label>` home", the nav landmark). With the default, the wordmark is the brand's two textures, "Ocean" and "Metrics" |
| `theme` | absent | `light` or `dark` pins the bar's scheme. Absent: the page's `<html data-theme>` (watched, so a theme toggle is followed), else `prefers-color-scheme` |
| `collapse-at` | `860` | the bar's width in px below which it collapses to the mark, the app's controls and a menu button (390 px is a phone) |

The default items:

| id | label | href | door |
|---|---|---|---|
| `places` | Places | https://oceanmetrics.io/places/ | yes |
| `indicators` | Indicators | https://oceanmetrics.io/indicators/ | yes |
| `atlas` | Atlas | https://oceanmetrics.io/atlas/ | yes |
| `changes` | What changed | https://oceanmetrics.io/docs/ (`changes-href`) | no |
| `docs` | Docs | https://oceanmetrics.io/docs/ | no |

### Events, properties, methods

- **`om-nav-search`** (bubbles, composed, cancelable), `detail: { q, url }`: fired on Enter in the search field with
  non-blank text. Unless a listener calls `preventDefault()`, the bar then goes to `url` (`location.assign`). Places
  cancels it and routes in-app.
- `el.items` (read only): the items on display, after `items` and `changes-href`.
- `el.open`, `el.toggle(force?)`: the phone menu panel.
- `el.search(text)`: the same as typing `text` and Enter.
- `el.render()`: redraw (attribute changes already do).

### Keyboard

Every entry is a native link, field or button in document order: the mark, the menu button (phone only), the doors, the
search field, the links, then the app's slotted controls. The menu button carries `aria-expanded` and `aria-controls`;
Escape closes the panel and gives focus back to the button; following a link closes it. The focus ring is
`--focus-ring` (3:1 or more on the bar in both themes).

### Styling

The bar reads the brand's semantic tokens the host page already defines (custom properties reach into the shadow root),
so it wears the host's theme with no setup. Each role falls back in this order: the bar's own property, the host's
semantic token, then the Ocean Metrics brand v1 value as a `light-dark()` pair (`src/tokens.ts`, the package's only
colour values).

| role | bar property | host token | light / dark default |
|---|---|---|---|
| background | `--om-nav-bg` | `--bg-surface` | #ffffff / #103a45 |
| rule under the bar | `--om-nav-border` | `--border` | #d6ebef / #234853 |
| text | `--om-nav-text` | `--text-body` | #3c5b64 / #b7d0d6 |
| strong text, current | `--om-nav-strong` | `--text-strong` | #082129 / #f1f9fb |
| mark ring, "Metrics" | `--om-nav-brand` | `--brand-text`, then `--link` | #0c7288 / #86d6e5 |
| current door's rule | `--om-nav-accent` | `--accent` | #1aa0bd / #43b9d2 |
| hover | `--om-nav-tint` | `--bg-tint` | #e6f5f8 / #12414d |
| search field | `--om-nav-control` | `--control-bg` | #ffffff / #12414d |
| focus ring | `--om-nav-focus` | `--focus-ring` | #1aa0bd / #43b9d2 |
| phone panel | `--om-nav-overlay`, `--om-nav-edge` | `--overlay-bg`, `--overlay-border`, `--overlay-shadow` | #ffffff / #164755, #c2e0e7 / #4b8999 |
| mark waterline | `--om-nav-spark` | `--om-mark-spark` | #f5b528 (both) |

Also `--om-nav-font` (default: inherit the page's font), `--om-nav-height` (48px), and the parts `bar`, `home`,
`doors`, `search`, `links`, `menu`, `end` for `::part()`. Fonts: "Ocean" asks for Fraunces then Georgia, "Metrics"
for the monospace stack with IBM Plex Mono; the bar loads none of them, so a page that has them shows them.

To keep the page from shifting before the element is defined, reserve its row:

```css
om-nav:not(:defined) { display: block; min-height: 48px; }
```

## Integration

Nothing here edits the apps or the site; each makes its own change. Once 0.1.0 is on npm, each adds
`"@oceanmetrics/nav": "^0.1.0"`.

### 1. A Svelte app (places web)

`src/main.ts` registers the element; `src/App.svelte` replaces its `<header class="site-header">` with the bar and puts
its own page links and the theme toggle in the slot. Places is the search target itself, so it cancels the event and
routes in-app (the Home reads `?q=`).

```svelte
<script lang="ts">
  import '@oceanmetrics/nav/define'
  import { onMount } from 'svelte'
  import { navigate } from './lib/router.svelte'
  let bar: HTMLElement
  onMount(() => {
    const onSearch = (e: Event) => {
      const u = new URL((e as CustomEvent<{ url: string }>).detail.url)
      if (u.origin === location.origin) { e.preventDefault(); navigate(u.pathname + u.search) }
    }
    bar.addEventListener('om-nav-search', onSearch)
    return () => bar.removeEventListener('om-nav-search', onSearch)
  })
</script>

<om-nav bind:this={bar} current="places">
  <nav aria-label="Places">
    {#each nav as n}<a href={withBase(n.href, BASE)} aria-current={here === n.name ? 'page' : undefined}>{n.label}</a>{/each}
  </nav>
  <button class="theme-toggle" type="button" onclick={toggleTheme}>…</button>
</om-nav>
```

An app whose build budget has no room in its entry loads it lazily, and only where it shows (the indicators viewer,
whose MBON instance never shows it):

```ts
if (brand !== 'mbon') import('@oceanmetrics/nav/define')
```

### 2. The Hugo site (oceanmetrics.github.io)

`package.json` pins the package; `hugo.yaml` mounts its `dist/` into the assets, and Hugo's own `js.Build` bundles,
minifies and fingerprints it (a pin, not a vendored copy; `deploy.yml` already runs `npm ci` before `hugo`):

```yaml
# hugo.yaml (re-declare the default assets mount when adding one)
module:
  mounts:
    - { source: assets, target: assets }
    - { source: node_modules/@oceanmetrics/nav/dist, target: assets/om-nav }
```

```go-html-template
{{/* layouts/partials/header.html: the doors, then the studio menu as links; the theme toggle and the CTA in the slot */}}
{{ $items := slice
  (dict "id" "places" "label" "Places" "href" ("places/" | absURL) "door" true)
  (dict "id" "indicators" "label" "Indicators" "href" ("indicators/" | absURL) "door" true)
  (dict "id" "atlas" "label" "Atlas" "href" ("atlas/" | absURL) "door" true)
  (dict "id" "changes" "label" "What changed" "href" ("docs/" | absURL))
  (dict "id" "docs" "label" "Docs" "href" ("docs/" | absURL)) }}
{{ $current := "" }}
{{ range site.Menus.main }}
  {{ $items = $items | append (dict "id" (.Name | urlize) "label" .Name "href" .URL) }}
  {{ if or ($.IsMenuCurrent "main" .) ($.HasMenuCurrent "main" .) }}{{ $current = .Name | urlize }}{{ end }}
{{ end }}
{{ if eq .RelPermalink "/docs/" }}{{ $current = "docs" }}{{ end }}
{{/* nine items and two controls need about 1,100 px: collapse below that */}}
<om-nav items="{{ $items | jsonify }}" current="{{ $current }}" home-href="{{ "" | absURL }}" collapse-at="1100">
  <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch theme"><i class="fas fa-moon" aria-hidden="true"></i></button>
  <a class="btn btn--sm" href="{{ "contact" | relURL }}">Work with me</a>
</om-nav>
{{ with resources.Get "om-nav/define.js" | js.Build (dict "minify" true "format" "esm") | fingerprint }}
  <script type="module" src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
{{ end }}
```

### 3. The atlas, per instance

The atlas names no brand in `src/`: the bar's presence, items and mark come from `instance.json`. The schema gains a
required `nav` (so each instance states it), `false` for an instance without the bar:

```json
// instances/instance.schema.json, under "properties" (and "nav" added to "required")
"nav": {
  "description": "the Ocean Metrics bar (@oceanmetrics/nav) above the top bar, or false for an instance without it",
  "oneOf": [
    { "const": false },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["current"],
      "properties": {
        "current": { "type": "string" },
        "items": { "type": "array", "items": { "type": "object", "required": ["id", "label", "href"], "additionalProperties": false,
          "properties": { "id": { "type": "string" }, "label": { "type": "string" }, "href": { "type": "string" }, "door": { "type": "boolean" } } } },
        "mark": { "$ref": "#/$defs/relativeUrl" },
        "label": { "type": "string" },
        "changes_href": { "$ref": "#/$defs/https" }
      }
    }
  ]
}
```

```json
// instances/oceanmetrics/instance.json          // instances/marinesensitivity/instance.json
"nav": { "current": "atlas" }                    "nav": false
```

```svelte
<!-- src/shell/Shell.svelte, above <header class="topbar">; NAV from src/lib/brand/instance.ts
     (export const NAV = INSTANCE.nav === false ? null : INSTANCE.nav) -->
{#if NAV}
  {#await import('@oceanmetrics/nav/define') then}
    <om-nav current={NAV.current} items={NAV.items ? JSON.stringify(NAV.items) : undefined}
      mark={NAV.mark} label={NAV.label} changes-href={NAV.changes_href}></om-nav>
  {/await}
{/if}
```

The import is dynamic and behind the flag, so the marinesensitivity build's static path does not change.

### 4. Plain HTML

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@oceanmetrics/nav@0.1.0/dist/define.js"></script>
<om-nav current="places" changes-href="https://oceanmetrics.io/indicators/#changes"></om-nav>
```

## The mark and the glyphs

`src/glyphs.ts` is generated, never typed: `npm run glyphs -w packages/nav` reads the published brand kit from the site
checkout beside platform (`static/img/logos/ocean-metrics-mark.svg` and `static/brand/v1/icons/om-icons.svg`, served at
https://oceanmetrics.io/brand/v1/icons/; `OM_SITE_DIR` or an argument for another path). The bar draws three sprite
glyphs byte for byte (`ui-search`, `ui-more` for the menu button, `ui-close`), and the mark with its numbers rounded to
0.1 of its 2048 grid (at most 0.05 off, 0.0008 px at the bar's 26 px; 1,100 B gzip instead of 1,554).
`test/glyphs.test.ts` fails when `src/glyphs.ts` is stale and checks the rounding, number by number (skipped without the
site checkout).

## Size

`npm run size` has two lines: `nav`, the summed `dist/**/*.js` (7,776 B gzip at 0.1.0 with comments, budget 12,000), and
`nav/define`, what a page fetches: `src/define.ts` bundled alone and minified (4,947 B, budget 6,000, the 0.1.0
target; `test/size.test.ts` holds it too). The mark is 1,100 B of it. The week 5 plan's 3 kB holds only without the
inline mark (an `<img>` of the mark would not take the page's theme), so the budget is the target, 6 kB.

## Licence

MIT, Copyright (c) 2026 Ocean Metrics LLC. The MDI glyphs: Material Design Icons (Pictogrammers, Apache-2.0).
