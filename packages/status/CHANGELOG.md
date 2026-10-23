# Changelog

## 0.1.1 (unreleased)

- The status words, moved here so the indicators viewer and the places page say them alike: `STATUS_WORDS` (above,
  within, below and `none`: "no status"), `TREND_WORDS`, `STATUS_NOTE`, `METHOD_NOTES` (one sentence per method) and
  `statusCaption(status, trend)` ("Within its own record · trend flat"). `@oceanmetrics/catalog` 0.3.0's cards use them.

## 0.1.0 (2026-10-22)

- First release. Moved from `oceanmetrics/indicators` `src/status/` (commit 8c40f6b) with its fixture folder
  (`fixtures/ecoidx/`); ported from ecoidx `PlotTimeSeries()`, not `plot_ts()`.
- The status methods `iea-sd`, `names-pct` and `values`, the period grid, the status sentences and alt texts, and the
  quadrant plot rules; `quantile7` (R's `quantile(type = 7)`) is exported for callers that need the same arithmetic.
- `iea-sd` reproduces every series of the ecoidx cross-check fixture `fixtures/ecoidx/iea_sd_cciea.json`.
