// what the atlas would add for COG display without titiler: the protocol (with geotiff.js) and the
// geotiff.js statistics module. maplibre-gl is external (the atlas already ships it).
export { cogProtocol, colorScale, locationValues, setColorFunction } from '@geomatico/maplibre-cog-protocol'
export { overviewStats, pointValues, viewStats } from '../src/stats'
