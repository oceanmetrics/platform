// the {{named}}-parameter SQL templates of sql/, rendered without DuckDB. moved from erddap-places `app/src/lib/sql.ts`:
// the templates come from the generated sqlTemplates.ts (built from sql/*.sql by scripts/sql-templates.mjs) instead of
// Vite's import.meta.glob; `lit` and `render` are unchanged, so the browser, the precompute and om_extract (which
// carries byte-identical copies of the same .sql files) run the same text.
import { TEMPLATES } from './sqlTemplates.js'

/** the names of the shipped templates */
export type TemplateName = 'stats_daily' | 'stats_categorical' | 'last_step' | 'stats_tabledap' | 'points_tabledap'

export function template(name: string): string {
  const t = TEMPLATES[name]
  if (t === undefined) throw new Error(`no SQL template ${name} (have: ${Object.keys(TEMPLATES).join(', ')})`)
  return t
}
export function templateNames(): string[] {
  return Object.keys(TEMPLATES).sort()
}

export type Param = string | number | boolean | null
export interface Params { [k: string]: Param }

/** params spliced literally (identifiers and expressions: table/column names); everything else quoted. */
const RAW = new Set(['var', 'expr', 'slab', 'mask', 'src'])
export function lit(v: Param): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}
export function render(name: string, params: Params): string {
  const body = template(name)
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in params)) throw new Error(`template ${name}: missing param ${k}`)
    return RAW.has(k) ? String(params[k]) : lit(params[k])
  }).trim()
}
