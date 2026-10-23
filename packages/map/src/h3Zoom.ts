// the h3 resolution each zoom draws (spike 1 condition 3), apart from h3Index.ts so a module that needs only the table
// (h3ReleaseLayer.ts, on the main thread) does not pull h3-js in. RES_FOR_ZOOM is obis-hex's zoom_to_res
// (MarineSensitivity h3-db app.R) at each tile zoom.

/** obis-hex `ZOOM_BREAKS`: 0, 2.2, 3.4, 4.6, 5.8, 7, 8.2, 9.4, 10.6, 11.8, 22 */
export const ZOOM_BREAKS: readonly number[] = Array.from({ length: 11 }, (_, i) => (i === 0 ? 0 : i === 10 ? 22 : 1 + ((13 - 1) * i) / 10))

/** the h3 resolution a view zoom draws: R's findInterval(z, ZOOM_BREAKS) clamped to 1..10 (obis-hex zoomToRes) */
export function zoomToRes(zoom: number): number {
  let k = 0
  for (const b of ZOOM_BREAKS) if (zoom >= b) k++
  return Math.max(1, Math.min(10, k))
}

/** the resolution of each tile zoom 0..12 (index = z) */
export const RES_FOR_ZOOM: readonly number[] = Array.from({ length: 13 }, (_, z) => zoomToRes(z))

/** the resolution a tile at zoom z carries, capped at the finest the data has */
export const resForZoom = (z: number, maxRes = 15): number => Math.min(maxRes, zoomToRes(Math.floor(z)))
