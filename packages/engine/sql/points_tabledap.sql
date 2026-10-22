-- one row per masked sampling station, for the map layer of a tabledap run.
--   {{expr}}  the value expression over the slab alias `s`
--   {{slab}}  the registered tabledap file (parquet) or view
--   {{mask}}  the station table: latitude, longitude
-- a tabledap window holds many casts at the same position and many depths per cast, so the map
-- shows each **station**: its mean value over the window, the number of measurements behind it and
-- the last time it was sampled.
SELECT
  m.latitude                                             AS latitude,
  m.longitude                                            AS longitude,
  1.0                                                    AS weight,
  avg({{expr}})                                          AS value,
  count({{expr}})                                        AS n,
  make_timestamp(epoch_ms(max(s."time")) * 1000)::DATE   AS date
FROM {{slab}} s
JOIN {{mask}} m
  ON  ROUND(s.latitude::DOUBLE,  5) = ROUND(m.latitude::DOUBLE,  5)
  AND ROUND(s.longitude::DOUBLE, 5) = ROUND(m.longitude::DOUBLE, 5)
WHERE {{expr}} IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2
