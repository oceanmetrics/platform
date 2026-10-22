# @oceanmetrics/map

The map stack of the Ocean Metrics apps: MapLibre 6, PMTiles, the bathymetric basemap, and COG and H3 sources. Today
this package is a scaffold: it exports a `PACKAGE` constant (`{ name, version }`) and one test, nothing else. It gains
the renderer (grid slice, COG, H3 source) and the basemap in build week 2, 2026-11-06 to 11-12, after
this first publish (`@oceanmetrics/map` 0.1.0, see CHANGELOG.md). Its size budget (5 000 B gzip) is provisional until the renderer lands.
