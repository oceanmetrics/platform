# @oceanmetrics/status

The status methods of Ocean Metrics indicators: `iea-sd`, `names-pct` and `values`; the period grid, the status
sentences and alt texts; and the quadrant plot rules. TypeScript, no DOM, ESM.

```ts
import { assess, quantile7 } from '@oceanmetrics/status'
```

**One implementation.** This package is the only place a status, trend, sentence or alt text is computed. The coverage
builder (Node) and the viewer import it; Python never computes a status. Statuses are statistical, never
better/worse: captions say "relative to its own record".

**`iea-sd` is ported from ecoidx `PlotTimeSeries()`, not `plot_ts()`.** `plot_ts()` compares the recent mean itself
with 1 SD rather than its departure from the long-term mean, and its +/- captions are reversed. The recent window is
the last `recent` rows of the series (NA rows count), the SD is the sample SD, and a change of exactly 1 SD is not a
change. `ecoidx.test.ts` asserts that `iea-sd` reproduces every series in `fixtures/ecoidx/iea_sd_cciea.json`, which
was made by running the real R function.

Regenerate the ecoidx fixture (needs R and a checkout of ecoidx; see `fixtures/ecoidx/README.md`):

```sh
Rscript fixtures/ecoidx/build_iea_sd_fixtures.R ~/Github/noaa-iea/ecoidx
```

**The words** (0.1.1, `src/words.ts`): `STATUS_WORDS` ("above its own record" ... and `none`: "no status"),
`TREND_WORDS`, `STATUS_NOTE` (what every status is relative to), `METHOD_NOTES` (one sentence per method) and
`statusCaption(status, trend)` ("Within its own record · trend flat"). The indicators viewer and the places page say
them alike through `@oceanmetrics/catalog`'s cards.

`quantile7` (R's `quantile(type = 7)`) is exported for callers that need the same arithmetic as the methods.

Moved from `oceanmetrics/indicators` `src/status/` at commit 8c40f6b on 2026-10-22, with its fixture folder
(`fixtures/ecoidx/`). Source imports use `.js` specifiers so the emitted declarations resolve for every consumer.
Published to npm as `@oceanmetrics/status` 0.1.0 (see CHANGELOG.md).
