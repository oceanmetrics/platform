#!/usr/bin/env node
// om-catalog: check files against the STAC layer profiles.
//   om-catalog profiles                          list the profiles
//   om-catalog validate <profile> <file...>      print each file's errors; exit 1 when any file fails
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { listProfiles, validate } from './validate.js'

export const USAGE = 'usage: om-catalog validate <profile> <file...> | om-catalog profiles'

/** run the command line `args`; returns the exit code and writes through `out` / `err`. */
export function run(args: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): number {
  const [cmd, profile, ...files] = args
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
