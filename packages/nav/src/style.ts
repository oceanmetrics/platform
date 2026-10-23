// the bar's stylesheet, in its shadow root. colours only through the --_<role> tokens of tokens.ts; no font is
// loaded (the host's fonts are used when it has them, the system stacks otherwise). `.narrow` is the phone layout
// (the mark, the app's controls, the menu button; the doors, search and links in a panel), set by the element from
// its own width; `.open` shows the panel.
import { OVERLAY_SHADOW, TOKEN_CSS } from './tokens.js'

export const STYLE = `
:host{display:block;${TOKEN_CSS}font-family:var(--om-nav-font,inherit);font-size:14px;line-height:1.3}
:host([hidden]){display:none}
.bar{color-scheme:light dark;position:relative;box-sizing:border-box;display:flex;align-items:center;gap:12px;min-height:var(--om-nav-height,48px);padding:0 16px;background:var(--_bg);color:var(--_text);border-bottom:1px solid var(--_border)}
.bar[data-scheme=light]{color-scheme:light}
.bar[data-scheme=dark]{color-scheme:dark}
a{color:inherit;text-decoration:none}
svg{fill:currentColor;display:block}
:focus-visible{outline:2px solid var(--_focus);outline-offset:2px}
.home{flex:none;display:flex;align-items:center;gap:7px;color:var(--_brand);border-radius:6px}
.mark{width:26px;height:26px}
.mark .s{fill:var(--_spark)}
.word{font-size:17px;line-height:1;white-space:nowrap;color:var(--_strong)}
.oc{font-family:Fraunces,Georgia,serif;font-weight:600}
.me{font-family:ui-monospace,'IBM Plex Mono',Menlo,monospace;font-weight:500;font-size:.9em;color:var(--_brand);margin-left:1px}
.p{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
ul{display:flex;gap:2px;margin:0;padding:0;list-style:none}
.p a{display:block;padding:6px 8px;border-radius:6px;white-space:nowrap}
.p a:hover{background:var(--_tint);color:var(--_strong)}
.p a[aria-current]{color:var(--_strong);box-shadow:inset 0 -2px var(--_accent);border-radius:6px 6px 0 0}
.doors a{font-weight:600}
.links{margin-left:auto}
form{position:relative;flex:0 1 15rem;min-width:8rem;margin:0}
form svg{position:absolute;left:8px;top:8px;width:16px;height:16px;pointer-events:none}
input{box-sizing:border-box;width:100%;height:32px;padding:0 8px 0 30px;font:inherit;color:var(--_strong);background:var(--_control);border:1px solid var(--_border);border-radius:6px}
input::placeholder{color:var(--_text);opacity:1}
input:focus-visible{outline-offset:0}
.end{flex:none;display:flex;align-items:center;gap:8px}
.menu{display:none;flex:none;align-items:center;justify-content:center;width:36px;height:36px;padding:0;color:var(--_strong);background:none;border:1px solid var(--_border);border-radius:6px;cursor:pointer}
.menu svg{width:20px;height:20px}
.menu .x,.open .menu .m{display:none}
.open .menu .x{display:block}
.narrow{gap:8px;padding:0 12px}
.narrow .word{display:none}
.narrow .end{margin-left:auto}
.narrow .menu{display:inline-flex;order:3}
.narrow .p{display:none;position:absolute;z-index:30;top:100%;left:0;right:0;flex-direction:column;align-items:stretch;gap:8px;padding:12px 16px 16px;background:var(--_overlay);border-bottom:1px solid var(--_edge);box-shadow:${OVERLAY_SHADOW}}
.narrow.open .p{display:flex}
.narrow ul{flex-direction:column}
.narrow .links{margin-left:0}
.narrow form{flex:none}
.narrow input{height:44px}
.narrow form svg{top:14px}
.narrow .p a{padding:12px 8px}
.narrow .p a[aria-current]{box-shadow:inset 3px 0 var(--_accent);border-radius:0 6px 6px 0}
`
