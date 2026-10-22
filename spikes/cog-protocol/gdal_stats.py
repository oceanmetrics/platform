"""reference statistics with GDAL (numpy over every valid pixel): per band min, max, mean,
population stddev, valid_percent and a 32-bucket equal-width histogram from min to max, for the
full-resolution image and for each overview, of the 4326 originals and the 3857 copies.
usage: python3 gdal_stats.py <data_dir> > results/gdal_stats.json"""
import json, sys, time
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
N_BUCKETS = 32


def summarise(a, nodata, edges=None):
  v = a[a != nodata] if nodata is not None else a.ravel()
  v = v.astype(np.float64)
  n = a.size
  if v.size == 0:
    return {"valid_percent": 0.0}
  lo, hi = float(v.min()), float(v.max())
  out = {"minimum": lo, "maximum": hi, "mean": float(v.mean()), "stddev": float(v.std()),
         "valid_percent": 100.0 * v.size / n, "valid": int(v.size), "pixels": int(n),
         "histogram": hist(v, lo, hi)}
  if edges is not None:
    out["histogram_ref_edges"] = hist(v, *edges)
  return out


def hist(v, lo, hi):
  # bucket = floor((v - lo) / (hi - lo) * N), the top edge folded into the last bucket; values
  # outside [lo, hi] are clamped into the end buckets (same rule as src/stats.ts)
  span = hi - lo if hi > lo else 1.0
  k = np.clip(np.floor((v - lo) / span * N_BUCKETS), 0, N_BUCKETS - 1).astype(int)
  return {"count": N_BUCKETS, "min": lo, "max": hi, "buckets": np.bincount(k, minlength=N_BUCKETS).tolist()}


def file_stats(path):
  ds = gdal.Open(path)
  res = {"path": path, "width": ds.RasterXSize, "height": ds.RasterYSize, "bands": []}
  for b in range(1, ds.RasterCount + 1):
    band = ds.GetRasterBand(b)
    nd = band.GetNoDataValue()
    t = time.perf_counter()
    full = summarise(band.ReadAsArray(), nd)
    full["ms"] = round(1000 * (time.perf_counter() - t), 1)
    edges = (full.get("minimum", 0), full.get("maximum", 1))
    ovs = []
    for o in range(band.GetOverviewCount()):
      ov = band.GetOverview(o)
      s = summarise(ov.ReadAsArray(), nd, edges)
      s.update(width=ov.XSize, height=ov.YSize)
      ovs.append(s)
    res["bands"].append({"band": b, "name": band.GetDescription(), "nodata": nd, "full": full, "overviews": ovs})
  return res


if __name__ == "__main__":
  d = sys.argv[1]
  names = ["score_risk.tif", "729c63f1d05d0515.tif", "9fe6f75498affae1.tif"]
  out = {"gdal": gdal.__version__, "files": {}}
  for n in names:
    out["files"][n] = {"4326": file_stats(f"{d}/{n}"), "3857": file_stats(f"{d}/3857/{n}")}
  json.dump(out, sys.stdout, indent=1)
