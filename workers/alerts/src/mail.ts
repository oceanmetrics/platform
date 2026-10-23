// the three mails: the confirmation, the welcome, the digest. plain text and html, the same words ----
import { placeViewHref } from '@oceanmetrics/catalog/cards'
import { changeSentence } from '@oceanmetrics/catalog/changes'
import type { ChangeRow } from '@oceanmetrics/catalog/changes'
import { STATUS_NOTE } from '@oceanmetrics/status'
import { apiBase, site } from './env.js'
import type { Env } from './env.js'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':')

export interface Rendered { subject: string; text: string; html: string; headers?: Record<string, string> }

// links ----

export const confirmUrl = (env: Env, token: string) => `${site(env)}/alerts/confirm/#t=${token}`
export const manageUrl = (env: Env, token: string) => `${site(env)}/alerts/manage/#t=${token}`
export const unsubscribePageUrl = (env: Env, token: string) => `${site(env)}/alerts/manage/#t=${token}&u=all`
/** the RFC 8058 one-click target: the mail client POSTs `List-Unsubscribe=One-Click` to it */
export const oneClickUrl = (env: Env, token: string) => `${apiBase(env)}/v1/unsubscribe?t=${token}`
export const placeUrl = (env: Env, id: string) => `${site(env)}/places/p/${enc(id)}/`
export const indicatorsApp = (env: Env) => `${site(env)}/indicators/`

/** List-Unsubscribe with the one-click POST (RFC 8058) and the page, on every mail that has a manage token */
export const unsubscribeHeaders = (env: Env, manage: string): Record<string, string> => ({
  'List-Unsubscribe': `<${oneClickUrl(env, manage)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
})

function page(title: string, body: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<meta name="color-scheme" content="light dark"><title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:24px 16px;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif">` +
    `<div style="max-width:600px;margin:0 auto">${body}` +
    `<hr style="border:0;border-top:1px solid #8884;margin:32px 0 16px">` +
    `<div style="font-size:13px;opacity:.8">${footer}</div></div></body></html>`
}

const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#0b5c8a;color:#fff;text-decoration:none">${esc(label)}</a></p>`

// the confirmation (double opt-in) ----

export function confirmMail(env: Env, token: string, watch: string): Rendered {
  const url = confirmUrl(env, token)
  const subject = 'Confirm your Ocean Metrics alert'
  const text = [
    'Someone, hopefully you, asked for Ocean Metrics alerts at this address on:',
    `  ${watch}`,
    '',
    'To confirm, open this page and press the Confirm button:',
    url,
    '',
    'If you did not ask, ignore this mail: nothing is sent, and the request is deleted in 48 hours.',
  ].join('\n')
  const html = page(subject,
    `<h1 style="font-size:20px">Confirm your alert</h1><p>Someone, hopefully you, asked for Ocean Metrics alerts at this address on:</p>` +
    `<p><strong>${esc(watch)}</strong></p>${button(url, 'Open the confirmation page')}` +
    `<p>The page has a Confirm button: opening this mail or its link alone confirms nothing.</p>`,
    'If you did not ask, ignore this mail: nothing is sent, and the request is deleted in 48 hours.')
  return { subject, text, html }
}

// the welcome, after the confirmation ----

export function welcomeMail(env: Env, manage: string, watch: string, cadence: string): Rendered {
  const subject = 'Your Ocean Metrics alert is on'
  const text = [
    `Confirmed. You will get at most one mail ${cadence === 'weekly' ? 'a week (Mondays)' : 'a day'} when something changes in:`,
    `  ${watch}`,
    '',
    STATUS_NOTE,
    '',
    `Manage: ${manageUrl(env, manage)}`,
    `Unsubscribe: ${unsubscribePageUrl(env, manage)}`,
  ].join('\n')
  const html = page(subject,
    `<h1 style="font-size:20px">Your alert is on</h1><p>You will get at most one mail ${cadence === 'weekly' ? 'a week (Mondays)' : 'a day'} when something changes in:</p>` +
    `<p><strong>${esc(watch)}</strong></p><p>${esc(STATUS_NOTE)}</p>`,
    footerHtml(env, manage, [watch]))
  return { subject, text, html, headers: unsubscribeHeaders(env, manage) }
}

const footerText = (env: Env, manage: string, watches: string[]) => [
  `You get this because you asked for Ocean Metrics alerts on: ${watches.join('; ')}.`,
  STATUS_NOTE,
  `Manage: ${manageUrl(env, manage)}`,
  `Unsubscribe: ${unsubscribePageUrl(env, manage)}`,
].join('\n')

const footerHtml = (env: Env, manage: string, watches: string[]) =>
  `<p>You get this because you asked for Ocean Metrics alerts on: ${esc(watches.join('; '))}.</p><p>${esc(STATUS_NOTE)}</p>` +
  `<p><a href="${esc(manageUrl(env, manage))}">Manage</a> · <a href="${esc(unsubscribePageUrl(env, manage))}">Unsubscribe</a></p>`

// the digest: one mail per address per day at most, the changes grouped by place ----

export interface DigestInput {
  rows: ChangeRow[]
  /** the watches the rows came from, in words */
  watches: string[]
  manage: string
  cadence: 'daily' | 'weekly'
}

const lineOf = (r: ChangeRow) => r.sentence || changeSentence(r)

/** the most lines a place gets in one digest; the rest are counted and linked (the catalog's first OBIS day was 868 rows) */
export const MAX_PER_PLACE = 10
const more = (n: number) => `and ${n} more change${n === 1 ? '' : 's'} at this place`

export function digestMail(env: Env, d: DigestInput): Rendered {
  const byPlace = new Map<string, ChangeRow[]>()
  for (const r of d.rows) byPlace.set(r.place_id, [...(byPlace.get(r.place_id) ?? []), r])
  const places = [...byPlace.entries()].map(([id, rs]) => ({ id, name: rs[0].place_name || id, rows: rs }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const dates = [...new Set(d.rows.map((r) => r.seen))].sort()
  const when = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0]
  const n = d.rows.length
  const where = places.length === 1 ? places[0].name : `${places.length} places`
  const subject = `Ocean Metrics: ${n} change${n === 1 ? '' : 's'} at ${where} (${when})`
  const app = indicatorsApp(env)
  const text = [
    `${n} change${n === 1 ? '' : 's'} in the indicators you watch, seen ${when}.`,
    '',
    ...places.flatMap((p) => [
      `${p.name}  ${placeUrl(env, p.id)}`,
      ...p.rows.slice(0, MAX_PER_PLACE).map((r) => `  - ${lineOf(r)}\n    ${placeViewHref(r.place_id, r.coll, r.indicator, app)}`),
      ...(p.rows.length > MAX_PER_PLACE ? [`  - ${more(p.rows.length - MAX_PER_PLACE)}\n    ${placeViewHref(p.id, p.rows[0].coll, null, app)}`] : []),
      '',
    ]),
    footerText(env, d.manage, d.watches),
  ].join('\n')
  const html = page(subject,
    `<h1 style="font-size:20px">${n} change${n === 1 ? '' : 's'} in the indicators you watch</h1><p style="opacity:.8">Seen ${esc(when)}.</p>` +
    places.map((p) =>
      `<h2 style="font-size:17px;margin:24px 0 8px"><a href="${esc(placeUrl(env, p.id))}">${esc(p.name)}</a></h2><ul style="padding-left:20px">` +
      p.rows.slice(0, MAX_PER_PLACE).map((r) => `<li style="margin:6px 0">${esc(lineOf(r))} <a href="${esc(placeViewHref(r.place_id, r.coll, r.indicator, app))}">View</a></li>`).join('') +
      (p.rows.length > MAX_PER_PLACE ? `<li style="margin:6px 0"><a href="${esc(placeViewHref(p.id, p.rows[0].coll, null, app))}">${esc(more(p.rows.length - MAX_PER_PLACE))}</a></li>` : '') +
      '</ul>').join(''),
    footerHtml(env, d.manage, d.watches))
  return { subject, text, html, headers: unsubscribeHeaders(env, d.manage) }
}
