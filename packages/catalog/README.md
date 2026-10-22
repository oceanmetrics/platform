# @oceanmetrics/catalog

Readers for the Ocean Metrics catalogs: STAC layers, the indicators manifest and values, and the places index. Today
this package is a scaffold: it exports a `PACKAGE` constant (`{ name, version }`) and one test, nothing else. It gains
the STAC profile validators on Day 2 (2026-10-23) and the values and manifest readers in build week 1 (2026-10-30 to
2026-11-05). Its size budget (5 000 B gzip) is provisional until then.
