// variant C, offline: for zooms 0..6, the h3 ids and values that touch each tile (the same CellIndex lookup
// as variant B), one gzipped columnar h3j JSON per tile ({"h3":[...],"v":[...]}), packed into one PMTiles v3
// archive with tile type 0 (unknown: a custom type, "h3j" in the metadata) and tile compression gzip.
// The writer is the minimal PMTiles v3 layout: 127-byte header, a gzipped root directory (leaf directories
// if it would not fit in the first 16 KiB), JSON metadata, tile data in tile-id order (clustered).
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";
import { CellIndex } from "../src/cellIndex.ts";

const MAXZOOM = 6;
const ds = process.argv[2] ?? "es";
const d = JSON.parse(readFileSync(`public/cells-${ds}.json`, "utf8"));
const idx = new CellIndex({ h3: d.h3, v: d.v });

interface Entry { tileId: number; offset: number; length: number; runLength: number }
const tiles: { tileId: number; data: Buffer }[] = [];
let rawBytes = 0;
const t0 = performance.now();
for (let z = 0; z <= MAXZOOM; z++) {
  let nz = 0;
  for (let x = 0; x < 2 ** z; x++)
    for (let y = 0; y < 2 ** z; y++) {
      const t = idx.tile(z, x, y);
      if (!t.h3.length) continue;
      const json = JSON.stringify({ h3: t.h3, v: t.v });
      rawBytes += json.length;
      tiles.push({ tileId: zxyToTileId(z, x, y), data: gzipSync(json, { level: 9 }) });
      nz++;
    }
  console.log(`z${z}: ${nz} tiles`);
}
tiles.sort((a, b) => a.tileId - b.tileId);

// directory serialization (PMTiles v3 spec)
const varint = (out: number[], n: number) => {
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
};
const serialize = (entries: Entry[]) => {
  const o: number[] = [];
  varint(o, entries.length);
  let last = 0;
  for (const e of entries) { varint(o, e.tileId - last); last = e.tileId; }
  for (const e of entries) varint(o, e.runLength);
  for (const e of entries) varint(o, e.length);
  entries.forEach((e, i) => varint(o, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
  return gzipSync(Buffer.from(o), { level: 9 });
};

const entries: Entry[] = [];
let offset = 0;
for (const t of tiles) { entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 }); offset += t.data.length; }
let root = serialize(entries);
let leaves = Buffer.alloc(0);
if (127 + root.length > 16384) {
  // one level of leaf directories
  for (let size = 512; ; size *= 2) {
    const leafBufs: Buffer[] = [];
    const rootEntries: Entry[] = [];
    let lo = 0;
    for (let i = 0; i < entries.length; i += size) {
      const b = serialize(entries.slice(i, i + size));
      rootEntries.push({ tileId: entries[i].tileId, offset: lo, length: b.length, runLength: 0 });
      leafBufs.push(b);
      lo += b.length;
    }
    root = serialize(rootEntries);
    leaves = Buffer.concat(leafBufs);
    if (127 + root.length <= 16384) break;
  }
}
const meta = gzipSync(JSON.stringify({ format: "h3j", encoding: "columnar json {h3: string[], v: number[]}", h3_resolution: 5, value: d.col, transform: d.transform, domain: d.domain, cells: d.h3.length, source: "obis-h3 v20261012 all res=5" }));
const data = Buffer.concat(tiles.map((t) => t.data));

const h = Buffer.alloc(127);
h.write("PMTiles", 0, "ascii");
h.writeUInt8(3, 7);
const u64 = (pos: number, n: number) => h.writeBigUInt64LE(BigInt(n), pos);
const rootOff = 127, metaOff = rootOff + root.length, leafOff = metaOff + meta.length, dataOff = leafOff + leaves.length;
u64(8, rootOff); u64(16, root.length); u64(24, metaOff); u64(32, meta.length);
u64(40, leafOff); u64(48, leaves.length); u64(56, dataOff); u64(64, data.length);
u64(72, tiles.length); u64(80, tiles.length); u64(88, tiles.length);
h.writeUInt8(1, 96); // clustered
h.writeUInt8(2, 97); // internal compression gzip
h.writeUInt8(2, 98); // tile compression gzip
h.writeUInt8(0, 99); // tile type unknown (h3j)
h.writeUInt8(0, 100); h.writeUInt8(MAXZOOM, 101);
h.writeInt32LE(-180e7, 102); h.writeInt32LE(-85.0511e7, 106); h.writeInt32LE(180e7, 110); h.writeInt32LE(85.0511e7, 114);
h.writeUInt8(1, 118); h.writeInt32LE(0, 119); h.writeInt32LE(0, 123);

const out = Buffer.concat([h, root, meta, leaves, data]);
writeFileSync(`public/h3j-${ds}.pmtiles`, out);
console.log(`${ds}: ${tiles.length} tiles, raw json ${(rawBytes / 1e6).toFixed(2)} MB, archive ${(out.length / 1e6).toFixed(2)} MB (root dir ${root.length} B, leaves ${leaves.length} B), ${((performance.now() - t0) / 1000).toFixed(1)} s`);
