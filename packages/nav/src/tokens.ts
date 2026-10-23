// the bar's theme file: the only place in this package with colour values. each of the bar's own properties
// (`--om-nav-<name>`, set on om-nav by a host that wants another look) falls back to the brand's semantic token of the
// same role (oceanmetrics.css in indicators brand/themes, static/css/tokens/colors.css of the site), then to the Ocean
// Metrics brand v1 value as a light-dark() pair, so a page with no tokens at all still reads right in both themes.
// light-dark() follows the bar's color-scheme, which the element sets from `theme`, <html data-theme> or the OS.

/** role → [the host's semantic tokens, tried in order; light value; dark value] */
export const TOKENS = {
  bg:       [['--bg-surface'],              '#ffffff', '#103a45'],
  border:   [['--border'],                  '#d6ebef', '#234853'],
  text:     [['--text-body'],               '#3c5b64', '#b7d0d6'],
  strong:   [['--text-strong'],             '#082129', '#f1f9fb'],
  brand:    [['--brand-text', '--link'],    '#0c7288', '#86d6e5'],   // teal as text, sky-teal on dark: the mark and the current door
  accent:   [['--accent'],                  '#1aa0bd', '#43b9d2'],   // the current door's rule
  tint:     [['--bg-tint'],                 '#e6f5f8', '#12414d'],   // hover
  control:  [['--control-bg'],              '#ffffff', '#12414d'],   // the search field
  focus:    [['--focus-ring'],              '#1aa0bd', '#43b9d2'],
  overlay:  [['--overlay-bg'],              '#ffffff', '#164755'],   // the phone menu panel stands off the page
  edge:     [['--overlay-border'],          '#c2e0e7', '#4b8999'],
  spark:    [['--om-mark-spark'],           '#f5b528', '#f5b528'],   // the ensō waterline: fixed in both themes
} as const satisfies Record<string, readonly [readonly string[], string, string]>

export type Role = keyof typeof TOKENS

/** the declaration of one role: `--_bg: var(--om-nav-bg, var(--bg-surface, light-dark(#ffffff, #103a45)))` */
export function tokenDecl(role: Role): string {
  const [hosts, light, dark] = TOKENS[role]
  const tail = hosts.reduceRight((inner, t) => `var(${t}, ${inner})`, `light-dark(${light}, ${dark})`)
  return `--_${role}: var(--om-nav-${role}, ${tail});`
}

/** every role's declaration, for the :host rule */
export const TOKEN_CSS = (Object.keys(TOKENS) as Role[]).map(tokenDecl).join('')

/** the shadow of the phone menu panel */
export const OVERLAY_SHADOW = 'var(--overlay-shadow, 0 12px 32px #0821292e, 0 2px 6px #0821291a)'
