import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, USAGE } from './cli.js'
import { DEFAULT_INDICATORS_BASE } from './manifest.js'
import {
  countStorageUrls, DEFAULT_STORAGE_HOST, parseStorageHost, resolveStorageHost, rewriteStorageUrls, rewriteStorageUrlsCounted,
  S3_PATH_STYLE, S3_VIRTUAL_HOST, STORAGE_ENV, STORAGE_HOST, STORAGE_HOSTS, storageUrl, WORKER_PREVIEW,
} from './storage.js'

// the case table om_extract.storage is held to as well (oceanmetrics/extract tests/test_storage.py)
const CASES = JSON.parse(readFileSync(new URL('../fixtures/storage/cases.json', import.meta.url), 'utf8')) as {
  parse: { name: string; value: string; output: string | null }[]
  storageUrl: { name: string; key: string; host?: string; apiKey?: string; output: string }[]
  rewrite: { name: string; from: string | string[]; to: string; input: string; output: string; count: number }[]
}

describe('storage: the hosts', () => {
  it('names the two hosts and the preview as constants', () => {
    expect(STORAGE_HOST).toBe('https://storage.oceanmetrics.io')
    expect(S3_PATH_STYLE).toBe('https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public')
    expect(S3_VIRTUAL_HOST).toBe('https://oceanmetrics.io-public.s3.amazonaws.com')
    expect(WORKER_PREVIEW).toBe('https://om-gazetteer.ben-f07.workers.dev')
    expect(Object.keys(STORAGE_HOSTS)).toEqual(['storage', 's3', 's3-virtual', 'preview'])
  })
  it('defaults to storage.oceanmetrics.io since the cutover of 2026-10-23 (path-style S3 in 0.5.1)', () => {
    expect(DEFAULT_STORAGE_HOST).toBe(STORAGE_HOST)
    expect(storageUrl('indicators/indicators.json')).toBe('https://storage.oceanmetrics.io/indicators/indicators.json')
  })
  it('the indicators base follows the default host', () => {
    expect(DEFAULT_INDICATORS_BASE).toBe(storageUrl('indicators/'))
    expect(DEFAULT_INDICATORS_BASE).toBe('https://storage.oceanmetrics.io/indicators/')
  })
  it('names the override each app reads once', () => {
    expect(STORAGE_ENV).toEqual({ vite: 'VITE_OM_STORAGE', node: 'OM_STORAGE', attribute: 'data-om-storage' })
  })
})

describe('storage: parseStorageHost (the case table)', () => {
  for (const c of CASES.parse) it(c.name, () => expect(parseStorageHost(c.value)).toBe(c.output))
  it('null and undefined are no setting', () => {
    expect(parseStorageHost(null)).toBeNull()
    expect(parseStorageHost(undefined)).toBeNull()
  })
})

describe('storage: resolveStorageHost', () => {
  it('the first well-formed candidate wins, a malformed one is skipped', () => {
    expect(resolveStorageHost(undefined, 'nope', 'preview', 'storage')).toBe(WORKER_PREVIEW)
  })
  it('no candidate is the default', () => {
    expect(resolveStorageHost()).toBe(DEFAULT_STORAGE_HOST)
    expect(resolveStorageHost('', null, ' ')).toBe(DEFAULT_STORAGE_HOST)
  })
})

describe('storage: storageUrl (the case table)', () => {
  for (const c of CASES.storageUrl) it(c.name, () => expect(storageUrl(c.key, { host: c.host, apiKey: c.apiKey })).toBe(c.output))
})

describe('storage: rewriteStorageUrls (the case table, text)', () => {
  for (const c of CASES.rewrite) {
    it(c.name, () => {
      const { value, count } = rewriteStorageUrlsCounted(c.input, { from: c.from, to: c.to })
      expect(value).toBe(c.output)
      expect(count).toBe(c.count)
      expect(countStorageUrls(c.input, c.from)).toBe(c.count)
    })
  }
})

describe('storage: rewriteStorageUrls (JSON values)', () => {
  const doc = {
    type: 'Collection',
    'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/key': 1,
    links: [
      { rel: 'self', href: `${S3_PATH_STYLE}/obis-h3/collection.json` },
      { rel: 'license', href: 'https://www.marineregions.org/disclaimer.php' },
    ],
    assets: { data: { href: `${S3_PATH_STYLE}/obis-h3/v1/a.parquet`, 'file:size': 10, roles: ['data'] } },
    flag: true,
    none: null,
  }
  it('rewrites string values at any depth and returns a new value', () => {
    const out = rewriteStorageUrls(doc, { from: 's3', to: 'storage' })
    expect(out.links[0].href).toBe('https://storage.oceanmetrics.io/obis-h3/collection.json')
    expect(out.assets.data.href).toBe('https://storage.oceanmetrics.io/obis-h3/v1/a.parquet')
    expect(out.links[1].href).toBe('https://www.marineregions.org/disclaimer.php')
    expect(out.assets.data['file:size']).toBe(10)
    expect(out.flag).toBe(true)
    expect(out.none).toBeNull()
    expect(doc.links[0].href).toBe(`${S3_PATH_STYLE}/obis-h3/collection.json`)
  })
  it('leaves keys alone', () => {
    const out = rewriteStorageUrls(doc, { from: 's3', to: 'storage' })
    expect(Object.keys(out)).toEqual(Object.keys(doc))
  })
  it('counts the same urls as the text form', () => {
    expect(countStorageUrls(doc, 's3')).toBe(2)
    expect(countStorageUrls(JSON.stringify(doc), 's3')).toBe(3) // the text form also sees the key
  })
  it('a round trip is the identity', () => {
    const there = rewriteStorageUrls(doc, { from: S3_PATH_STYLE, to: STORAGE_HOST })
    expect(rewriteStorageUrls(there, { from: STORAGE_HOST, to: S3_PATH_STYLE })).toEqual(doc)
  })
  it('a malformed host is an error naming it', () => {
    expect(() => rewriteStorageUrls('x', { from: 'bucket', to: 'storage' })).toThrow('not a host: "bucket"')
    expect(() => rewriteStorageUrls('x', { from: 's3', to: 'ftp://x' })).toThrow('not a host: "ftp://x"')
  })
})

describe('om-catalog rewrite-storage', () => {
  const lines = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, o: (s: string) => out.push(s), e: (s: string) => err.push(s) }
  }
  const files = () => {
    const dir = mkdtempSync(join(tmpdir(), 'om-storage-'))
    const a = join(dir, 'a.json')
    const b = join(dir, 'b.json')
    writeFileSync(a, `{"href": "${S3_PATH_STYLE}/indicators/x.parquet", "via": "${S3_PATH_STYLE}/indicators/"}\n`)
    writeFileSync(b, '{"href": "https://erddap.oceanmetrics.io/erddap/griddap/x.csv"}\n')
    return { a, b }
  }
  it('counts per file and in total, and writes nothing without --write', () => {
    const { a, b } = files()
    const before = readFileSync(a, 'utf8')
    const l = lines()
    expect(run(['rewrite-storage', '--from', 'S3_PATH_STYLE', '--to', 'STORAGE_HOST', a, b], l.o, l.e)).toBe(0)
    expect(l.out).toEqual([`2\t${a}`, `0\t${b}`, '2 urls in 1 of 2 files (dry run)'])
    expect(readFileSync(a, 'utf8')).toBe(before)
  })
  it('--write rewrites in place, the bytes apart from the hosts kept', () => {
    const { a } = files()
    const l = lines()
    expect(run(['rewrite-storage', '--from', 's3,s3-virtual', '--to', 'storage', '--write', a], l.o, l.e)).toBe(0)
    expect(readFileSync(a, 'utf8')).toBe('{"href": "https://storage.oceanmetrics.io/indicators/x.parquet", "via": "https://storage.oceanmetrics.io/indicators/"}\n')
    expect(l.out.at(-1)).toBe('2 urls in 1 of 1 files rewritten')
  })
  it('a missing argument prints the usage, a bad host names it', () => {
    const l = lines()
    expect(run(['rewrite-storage', '--to', 'storage', 'x.json'], l.o, l.e)).toBe(2)
    expect(l.err).toEqual([USAGE])
    const { a } = files()
    expect(run(['rewrite-storage', '--from', 'bucket', '--to', 'storage', a], l.o, l.e)).toBe(2)
    expect(l.err.at(-1)).toContain('not a host: "bucket"')
  })
})
