"""the synthetic griddap slabs of the engine tests, written as ERDDAP writes .parquet: float32 axes, a UTC timestamp.

  stats_3x3x2.parquet  extract/tests/test_stats.py's slab: a 3 x 3 grid (lat 20, 20.05, 20.1; lon -160, -159.95,
                       -159.9) over 2026-01-01 and 01-02 at 12:00Z. SST on the diagonal is -2, 0, 2 (day 1) and NULL, 0,
                       2 (day 2), CLASS 1, 1, 2 then NULL, 3, 3; every off-diagonal cell is 99 (outside the test mask).
  daily_3x3x100.parquet the same grid over the 100 days 2026-01-01 .. 04-10, SST = the day of the year at every cell
                       (so a day's mean is its day of the year, whatever the weights).

run: python make_slabs.py (pyarrow), from this folder. the files are tiny and committed; the tests never write them.
"""
import datetime as dt
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

HERE = Path(__file__).parent
LATS = [20.0, 20.05, 20.1]
LONS = [-160.0, -159.95, -159.9]
UTC = dt.timezone.utc


def table(days, value, klass=None):
  t, la, lo, v, c = [], [], [], [], []
  for d in days:
    for i, lat in enumerate(LATS):
      for j, lon in enumerate(LONS):
        t.append(d); la.append(lat); lo.append(lon); v.append(value(d, i, j))
        if klass: c.append(klass(d, i, j))
  cols = {"time": pa.array(t, pa.timestamp("us", tz="UTC")), "latitude": pa.array(la, pa.float32()),
          "longitude": pa.array(lo, pa.float32()), "SST": pa.array(v, pa.float64())}
  if klass: cols["CLASS"] = pa.array(c, pa.float32())
  return pa.table(cols)


TWO = [dt.datetime(2026, 1, 1, 12, tzinfo=UTC), dt.datetime(2026, 1, 2, 12, tzinfo=UTC)]
SST = [{(0, 0): -2.0, (1, 1): 0.0, (2, 2): 2.0}, {(0, 0): None, (1, 1): 0.0, (2, 2): 2.0}]
CLS = [{(0, 0): 1, (1, 1): 1, (2, 2): 2}, {(0, 0): None, (1, 1): 3, (2, 2): 3}]
k = lambda d: TWO.index(d)
pq.write_table(table(TWO, lambda d, i, j: SST[k(d)].get((i, j), 99.0), lambda d, i, j: CLS[k(d)].get((i, j), 99.0)),
               HERE / "stats_3x3x2.parquet", compression="snappy")

DAYS = [dt.datetime(2026, 1, 1, 12, tzinfo=UTC) + dt.timedelta(days=n) for n in range(100)]
pq.write_table(table(DAYS, lambda d, i, j: float(d.timetuple().tm_yday)), HERE / "daily_3x3x100.parquet", compression="snappy")
print("wrote stats_3x3x2.parquet, daily_3x3x100.parquet")
