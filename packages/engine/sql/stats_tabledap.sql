-- monthly key statistics for one place from an ERDDAP **tabledap** slab (point samples).
--   {{expr}}  the value expression over the slab alias `s` (e.g. s."measurement_value")
--   {{slab}}  the registered tabledap file (parquet) or view
--   {{mask}}  the station table: latitude, longitude (weight is 1 — a point is in or out)
-- tabledap points are sparse and irregular, so the roll-up is by **month**, not by day: a CalCOFI
-- quarterly cruise gives a handful of days a year, and a daily grouping would be mostly empty.
-- `n_casts` counts the distinct sampling events (time x position) behind the n measurements, since
-- one cast contributes many depths.
-- the join is an exact equality on ROUND(x, 5): the station positions come back out of DuckDB, go
-- through the JS point-in-polygon mask and come back in, so five decimals (~1 m) is exact here.
WITH pts AS (
  SELECT
    -- utc, via epoch_ms because duckdb-wasm ships without icu: TIMESTAMPTZ::DATE is unimplemented there
    make_timestamp(epoch_ms(s."time") * 1000) AS ts,
    s.longitude::DOUBLE                       AS longitude,
    s.latitude::DOUBLE                        AS latitude,
    {{expr}}                                  AS value
  FROM {{slab}} s
  JOIN {{mask}} m
    ON  ROUND(s.latitude::DOUBLE,  5) = ROUND(m.latitude::DOUBLE,  5)
    AND ROUND(s.longitude::DOUBLE, 5) = ROUND(m.longitude::DOUBLE, 5)
  WHERE {{expr}} IS NOT NULL
)
SELECT
  date_trunc('month', ts)::DATE                  AS date,
  count(value)                                   AS n,
  count(DISTINCT (ts, longitude, latitude))      AS n_casts,
  avg(value)                                     AS mean,
  stddev_samp(value)                             AS sd,
  min(value)                                     AS min,
  max(value)                                     AS max,
  quantile_cont(value, 0.10)                     AS p10,
  quantile_cont(value, 0.90)                     AS p90
FROM pts
GROUP BY 1
ORDER BY 1
