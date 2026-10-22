# ecoidx cross-check fixture for the `iea-sd` status method

`iea_sd_cciea.json` records what the original CCIEA plotting function, `PlotTimeSeries()` from
[marinebon/ecoidx](https://github.com/marinebon/ecoidx), draws for 399 time series. The TypeScript status method
(`packages/status/src/ieaSd.ts`) is asserted to reproduce every `expected` block. It is not a re-implementation of the rules:
the glyphs are the `text()` and `points()` calls the real function makes, and `mn`, `sd`, `mn5`, `delta`, `Z`, `Z2` are
the function's own locals, read from its frame on exit.

(`R/plot.R`'s `plot_ts()` in ecoidx is a different, known-wrong function and is not used.)

## What the function does (the contract the fixture pins)

- `mn`, `sd` (sample SD, n - 1): mean and SD of the whole series, or of the years in `stats_years` when given
  (`[start, end]`, inclusive). NA rows are ignored.
- Recent window: the last `period` **rows** (`Y[length(Y) - (period - 1):0]`), NA rows included, so a gap year inside the
  range counts as a row. A series shorter than `period` rows errors.
- Trend: `lm(Y5 ~ X5)` over the non-NA rows of the window, `delta` = last fitted value minus first fitted value,
  `Z = abs(delta) - sd`. Flat (`\->`) when `Z <= 0`; up (`\#H2296`) when `Z > 0` and `delta > 0`; down (`\#H2299`)
  otherwise. **X5 is POSIXct, 1 January of each year**, so the regression runs on real time (leap years make the
  spacing 365 or 366 days), not on the year number. Regressing on the year number gave the same glyph for every series
  in this fixture, but `delta` differs (median 0.04%, 90th percentile 0.3% of `delta`, for complete windows); use days
  since a fixed epoch to match to 1e-9.
- Status: `mn5` = mean of the window (NA removed), `dMean = mn - mn5`, `Z2 = abs(dMean) - sd`. Within (`pch19`, a filled
  point) when `Z2 <= 0`; below (`_`) when `Z2 > 0` and `dMean > 0` (recent mean below the long-term mean); above (`+`)
  when `Z2 > 0` and `dMean < 0`.
- With `stats_years`, ecoidx casts the series to character (`cbind` of year and value) before taking the baseline mean
  and SD, so those two lose precision beyond 15 significant digits. Compare with a relative tolerance of about 1e-9.

## File shape

```json
{ "source", "ecoidx_commit", "created", "r_version", "skipped": [{ "dataset", "variable"?, "why" }],
  "series": [{ "id", "kind", "period", "stats_years": null | [start, end], "note"?,
               "x": [years], "y": [numbers | null], "expected": { status, trend, glyph_status, glyph_trend,
               mn, sd, mn5, delta, Z, Z2 } | null, "error": null | "message" }] }
```

`x` and `y` are the rows given to the function, in order, NA rows as `null`. `expected` is `null` exactly when
`error` is set (the function stopped before drawing). `glyph_trend` is the string the function passes to `text()` (JSON
`"\\->"` is the 3-character string `\->`). Numbers are full double precision.

## Series

| kind | count | what |
|---|---|---|
| `cciea-annual` | 331 | every `cciea_*` dataset in ecoidx `data/` with `time`, `variable`, `value_numeric`: one series per (dataset, variable), annual mean by calendar year (UTC) over the years with at least one numeric value; years missing inside the range are kept as `null` rows; at least 7 numeric years. Includes 10 `PERIOD = 10` runs (`:period10`). |
| `baseline` | 26 | the `stats_years` path: 16 annual series with `[1991, 2020]`, 3 with `[1981, 2010]`, 5 native series, and 2 more `[1991, 2020]` runs with `PERIOD = 10`. |
| `native` | 10 | `groundfish` (9 series) and `ts1` (1 series) in `PlotTimeSeries` format (`year`, `index`, ...), unaggregated, through the function's `dframe` path. |
| `synthetic` | 32 | edge cases, each run through the same function (see `note` on each). |

Series are per `variable` only: datasets with extra grouping columns (location, species, region) are averaged across
them. That is fine for pinning the arithmetic and meaningless as an ecological series; do not publish these as
indicators.

`skipped` lists the datasets of another shape (`cciea_AC_mn`: monthly climatology with `month`; `cciea_HD_Soc_Vuln`:
`social_vulnerability` by `location`) and every (dataset, variable) with fewer than 7 numeric years (mostly the
character-valued variables, which have none).

The synthetic cases: a series for each (status, trend) combination missing from the real data (only below/up was),
trend change of 0.999 and 1.001 sd on each side (`|delta| / sd` solved to that value), recent-mean difference of 0.999
and 1.001 sd on each side, NA inside the window (first row, middle, two rows), NA as the last row, NA before the window,
`PERIOD = 10` with NA, exactly `PERIOD` rows (5 and 10), `PERIOD + 1` rows, a constant series, and random `PERIOD = 10`
series.

## Counts by glyph combination (all 396 series that did not error)

|  | trend up | flat | down |
|---|---:|---:|---:|
| status above | 9 | 31 | 14 |
| within | 62 | 189 | 62 |
| below | 1 | 23 | 5 |

All nine combinations occur. Below/up is the synthetic `synthetic:combo-below-up` (the real data has none).

## Cases that error or look odd in PlotTimeSeries()

- `synthetic:one-value-in-window` (one non-NA value in the window): `subscript out of bounds` (lm has no slope).
- `synthetic:all-na-window`: `0 (non-NA) cases`.
- `synthetic:fewer-than-period-rows` (8 rows, `PERIOD = 10`): `only 0's may be mixed with negative subscripts`.
- `synthetic:constant`: no error; sd = 0, `Z = 0`, `Z2 = 0`, so flat and within. Constant 0.1 is the trap:
  `delta` is about 1e-17, which is greater than sd = 0, so the function draws "down". That is floating-point noise in
  `lm`, not a rule; the TypeScript method may differ there (a documented known divergence).

A port should treat a window with fewer than 2 non-NA values, or fewer rows than `period`, as "no status" rather than
reproduce the R error text.

## Regenerate

```sh
Rscript fixtures/ecoidx/build_iea_sd_fixtures.R ~/Github/noaa-iea/ecoidx
```

Needs R with `librarian` (installs `jsonlite`, `dplyr`) and a checkout of ecoidx; it reads `R/PlotTimeSeries.R` and
`data/*.rda`, never writes there, and records the checkout's commit (`566be8d2b8f98f40b0ef3c271f152af35d0f6402` for this
file). Two runs give identical JSON except the `created` line (the random numbers are seeded and the time zone is fixed
to UTC). The script also prints, without writing, a check of the drawn glyphs against the sign rules above and a
recomputation of `mn`, `sd`, `mn5` and `delta`; both agreed for every series.

## Licence and credit

ecoidx is MIT licensed (Ben Best, Nick Tolimieri). The CCIEA example data are from NOAA's California Current
Integrated Ecosystem Assessment ERDDAP (https://oceanview.pfeg.noaa.gov/erddap/, datasets `cciea_*`), bundled in ecoidx
`data/`; the `groundfish` and `ts1` examples are ecoidx's own. The fixture holds annual means and values derived from
them, no geometry. The generator script and this fixture are MIT like the rest of this repo.
