// the profile validators (Node only): the JSON Schemas in the package's schemas/ folder, read at run time and checked
// with ajv (draft 2020-12, formats on). exported from @oceanmetrics/catalog/validate, never from the package index, so a
// browser bundle never pulls ajv in. the Python side (om_extract.schemas) reads the same folder with jsonschema.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/** the folder holding `<name>.schema.json`: `schemas/` beside `src/` and `dist/`. */
export const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url))

const SUFFIX = '.schema.json'

/** the names of the schemas in `SCHEMA_DIR`, sorted. */
export function listProfiles(): string[] {
  return readdirSync(SCHEMA_DIR).filter(f => f.endsWith(SUFFIX)).map(f => f.slice(0, -SUFFIX.length)).sort()
}

/** the parsed schema `<name>.schema.json`; throws naming the known profiles when there is none. */
export function loadSchema(name: string): Record<string, unknown> {
  const path = join(SCHEMA_DIR, `${name}${SUFFIX}`)
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(path))
    throw new Error(`unknown profile ${JSON.stringify(name)}; known: ${listProfiles().join(', ')}`)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

export interface ValidationResult {
  ok: boolean
  /** one line per error, `<json pointer>: <message>` (the pointer is `/` for the document itself). */
  errors: string[]
}

// one ajv for every profile. strict mode fails at compile time on an unknown keyword, an open tuple or a keyword without
// its type, so a schema ajv would read differently from Python's jsonschema never ships; strictRequired is off because
// a then-branch requires keys its own subschema does not list
let ajv: Ajv2020 | null = null
const compiled = new Map<string, ValidateFunction>()

function validatorFor(name: string): ValidateFunction {
  let fn = compiled.get(name)
  if (fn) return fn
  ajv ??= addFormats(new Ajv2020({ allErrors: true, verbose: true, strict: true, strictRequired: false, allowUnionTypes: true }))
  fn = ajv.compile(loadSchema(name))
  compiled.set(name, fn)
  return fn
}

// the combinators whose own message says nothing ("must NOT be valid"): the rule is in the schema's description
const OPAQUE = new Set(['not', 'anyOf', 'oneOf', 'contains'])

/** one ajv error as `<pointer>: <message>`, with the allowed values of an enum or const and the rule of a combinator. */
export function formatError(e: ErrorObject): string {
  let msg = e.message ?? e.keyword
  const p = e.params as Record<string, unknown>
  if (e.keyword === 'enum') msg += `: ${(p.allowedValues as unknown[]).map(v => JSON.stringify(v)).join(', ')}`
  if (e.keyword === 'const') msg += `: ${JSON.stringify(p.allowedValue)}`
  if (e.keyword === 'additionalProperties') msg += `: ${JSON.stringify(p.additionalProperty)}`
  // a not names its rule on its own subschema when it has one, else on the schema holding it
  const own = e.keyword === 'not' ? (e.schema as { description?: unknown } | undefined)?.description : undefined
  const rule = own ?? (e.parentSchema as { description?: unknown } | undefined)?.description
  if (OPAQUE.has(e.keyword) && typeof rule === 'string') msg += ` (${rule})`
  return `${e.instancePath || '/'}: ${msg}`
}

/** check `doc` against profile `name`: `{ ok, errors }`, errors empty when ok. */
export function validate(name: string, doc: unknown): ValidationResult {
  const fn = validatorFor(name)
  const ok = fn(doc) as boolean
  // an if/then failure is reported twice, by the rule inside then and by 'must match "then" schema': keep the rule
  const all = fn.errors ?? []
  const rules = all.filter(e => e.keyword !== 'if')
  return { ok, errors: ok ? [] : (rules.length ? rules : all).map(formatError) }
}
