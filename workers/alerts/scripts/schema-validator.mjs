// ajv in tests only: workerd refuses code generated at run time, so the alerts-subscription validator is compiled here,
// in Node, as standalone code, bundled with its ajv runtime helpers into one ESM file (test/generated/, git-ignored),
// and the miniflare tests import it
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import Ajv2020 from 'ajv/dist/2020.js'
import standalone from 'ajv/dist/standalone/index.js'
import addFormats from 'ajv-formats'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const schema = JSON.parse(readFileSync(require.resolve('@oceanmetrics/catalog/schemas/alerts-subscription.schema.json'), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true } })
addFormats(ajv)
const code = standalone(ajv, ajv.compile(schema))
const out = new URL('../test/generated/', import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL('alerts-subscription.cjs', out), code)
await build({ entryPoints: [new URL('alerts-subscription.cjs', out).pathname], bundle: true, format: 'esm', platform: 'neutral', outfile: new URL('alerts-subscription.mjs', out).pathname, logLevel: 'error' })
writeFileSync(new URL('alerts-subscription.d.mts', out), 'declare const validate: ((data: unknown) => boolean) & { errors?: unknown[] | null }\nexport default validate\n')
console.log(`schema-validator: ${schema.$id} -> test/generated/alerts-subscription.mjs`)
