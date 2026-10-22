// a Node DuckDB-WASM (the same package the browser runs, its node-blocking bundle) as the engine's `Duck`, so the tests
// run the SQL in the engine the browser uses (obis-hex tests/helpers/nodeDb.ts pattern). the blocking bindings answer
// synchronously; the Engine awaits either.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Duck } from '../../src/engine.js'
import { Engine } from '../../src/engine.js'

const require = createRequire(import.meta.url)

export async function nodeDuck(): Promise<Duck> {
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh : { mainModule: join(dist, 'duckdb-eh.wasm'),  mainWorker: '' },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  )
  await db.instantiate()
  return { db, conn: db.connect() }
}

/** an Engine on a fresh node DuckDB-WASM */
export const nodeEngine = () => new Engine(nodeDuck)

/** the version of the DuckDB-WASM package under test */
export const duckdbWasmVersion = (): string => {
  // its exports map has no ./package.json: read it beside the dist folder
  const dist = dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  return JSON.parse(readFileSync(join(dist, '..', 'package.json'), 'utf8')).version
}
