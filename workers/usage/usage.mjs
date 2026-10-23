#!/usr/bin/env node
// usage.mjs: weekly usage numbers per catalog from the Workers' Analytics Engine datasets (README for the token and the cron).
//   node usage.mjs [--dry-run] [--out <dir>] [--now <ISO date>] [--window 7d|30d]
// the token is CF_AE_TOKEN from the environment or from ~/.config/oceanmetrics/cf-ae.env; never printed, never in the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ID, buildQueries, collect, envFileValue, renderMarkdown } from './lib.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENV_FILE = join(homedir(), '.config', 'oceanmetrics', 'cf-ae.env')

function parseArgs(argv) {
  const a = { dryRun: false, out: join(tmpdir(), 'oceanmetrics'), now: new Date(), only: undefined }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--dry-run') a.dryRun = true
    else if (k === '--out') a.out = resolve(argv[++i] ?? '')
    else if (k === '--now') a.now = new Date(argv[++i] ?? '')
    else if (k === '--window') a.only = argv[++i]
    else throw new Error(`unknown argument: ${k}`)
  }
  if (Number.isNaN(a.now.getTime())) throw new Error('--now is not a date')
  const rel = relative(REPO, a.out)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(`--out ${a.out} is inside the repo; give a path outside it`)
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const days = /** @type {Record<string, number>} */ ({ '7d': 7, '30d': 30 })
  if (args.only && !days[args.only]) throw new Error('--window is 7d or 30d')
  const opts = args.only ? { windows: { [args.only]: days[args.only] } } : {}
  if (args.dryRun) {
    for (const q of buildQueries(args.now, opts)) console.log(`-- ${q.window} ${q.id} ${q.dataset}${q.prefix ? ' ' + q.prefix : ''}\n${q.sql}\n`)
    return
  }
  const token = process.env.CF_AE_TOKEN || (existsSync(ENV_FILE) ? envFileValue(readFileSync(ENV_FILE, 'utf8'), 'CF_AE_TOKEN') : '')
  if (!token) {
    console.error(`no token: set CF_AE_TOKEN or put CF_AE_TOKEN=... in ${ENV_FILE} (Account Analytics Read); --dry-run prints the SQL without one`)
    process.exit(2)
  }
  const report = await collect(args.now, { ...opts, token, account: process.env.CF_ACCOUNT_ID || ACCOUNT_ID, fetchFn: fetch })
  console.log(renderMarkdown(report, { only: args.only }))
  const dir = join(args.out, 'usage')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${args.now.toISOString().slice(0, 10)}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  console.error(`wrote ${file}`)
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1) })
