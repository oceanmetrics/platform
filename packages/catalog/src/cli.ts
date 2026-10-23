#!/usr/bin/env node
// om-catalog: check files against the STAC layer profiles.
//   om-catalog profiles                          list the profiles
//   om-catalog validate <profile> <file...>      print each file's errors; exit 1 when any file fails
//   om-catalog rewrite-storage --from <host>[,<host>...] --to <host> [--write] <file...>
//                                                count (and with --write rewrite in place) the storage urls of each file
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { rewriteStorageUrlsCounted } from './storage.js'
import { listProfiles, validate } from './validate.js'

export const USAGE = 'usage: om-catalog validate <profile> <file...> | om-catalog profiles | om-catalog rewrite-storage --from <host>[,<host>] --to <host> [--write] <file...>'

/**
 * `rewrite-storage`: each file as text through rewriteStorageUrls (its bytes kept apart from the hosts). prints
 * `<count>\t<file>` per file and a total line; --write rewrites in place the files with a url to move. the hosts are
 * host urls or setting names (`S3_PATH_STYLE`, `STORAGE_HOST`, `s3`, `storage`, ...). om-publish.sh rewrite calls this.
 */
function rewriteStorage(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  let from: string[] = []
  let to = ''
  let write = false
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--from') from = (args[++i] ?? '').split(',').filter(Boolean)
    else if (a === '--to') to = args[++i] ?? ''
    else if (a === '--write') write = true
    else files.push(a)
  }
  if (!from.length || !to || !files.length) {
    err(USAGE)
    return 2
  }
  let total = 0
  let changed = 0
  for (const file of files) {
    let r: { value: string; count: number }
    try {
      r = rewriteStorageUrlsCounted(readFileSync(file, 'utf8'), { from, to })
    } catch (e) {
      err(`FAIL ${file}\n  ${(e as Error).message}`)
      return 2
    }
    out(`${r.count}\t${file}`)
    total += r.count
    if (r.count) {
      changed++
      if (write) writeFileSync(file, r.value)
    }
  }
  out(`${total} urls in ${changed} of ${files.length} files${write ? ' rewritten' : ' (dry run)'}`)
  return 0
}

/** run the command line `args`; returns the exit code and writes through `out` / `err`. */
export function run(args: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): number {
  const [cmd, profile, ...files] = args
  if (cmd === 'rewrite-storage') return rewriteStorage(args.slice(1), out, err)
  if (cmd === 'profiles') {
    listProfiles().forEach(p => out(p))
    return 0
  }
  if (cmd !== 'validate' || !profile || files.length === 0) {
    err(USAGE)
    return 2
  }
  if (!listProfiles().includes(profile)) {
    err(`unknown profile ${JSON.stringify(profile)}; known: ${listProfiles().join(', ')}`)
    return 2
  }
  let failed = 0
  for (const file of files) {
    let doc: unknown
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      err(`FAIL ${file}\n  ${(e as Error).message}`)
      failed++
      continue
    }
    const { ok, errors } = validate(profile, doc)
    if (ok) out(`ok   ${file}`)
    else {
      failed++
      err(`FAIL ${file}\n${errors.map(e => `  ${e}`).join('\n')}`)
    }
  }
  if (files.length > 1) out(`${files.length - failed} of ${files.length} valid against ${profile}`)
  return failed ? 1 : 0
}

// run only as the bin (argv[1] may be the npm .bin symlink), not when a test imports run()
const self = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : ''
if (self === import.meta.url) process.exit(run(process.argv.slice(2)))
