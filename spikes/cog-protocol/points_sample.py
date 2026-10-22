"""300 random valid full-resolution pixels per file (seed 7), at random positions inside the pixel,
with their GDAL values on the 4326 original: the reference for probe_points.mjs.
usage: python3 points_sample.py <data_dir> > results/points_sample.json"""
import json, sys
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
rng = np.random.default_rng(7)
out = {}
for name in ["score_risk.tif", "729c63f1d05d0515.tif", "9fe6f75498affae1.tif"]:
  ds = gdal.Open(f"{sys.argv[1]}/{name}")
  gt = ds.GetGeoTransform()
  a = ds.ReadAsArray()
  a = a if a.ndim == 3 else a[None]
  nd = ds.GetRasterBand(1).GetNoDataValue()
  rows, cols = np.where(a[0] != nd)
  keep = np.abs(gt[3] + (rows + 0.5) * gt[5]) < 85  # inside the mercator limit
  rows, cols = rows[keep], cols[keep]
  pick = rng.choice(len(rows), 300, replace=False)
  pts = []
  for k in pick:
    r, c = int(rows[k]), int(cols[k])
    lon = gt[0] + (c + rng.uniform(0.02, 0.98)) * gt[1]
    lat = gt[3] + (r + rng.uniform(0.02, 0.98)) * gt[5]
    pts.append({"lon": lon, "lat": lat, "col": c, "row": r,
                "values": [None if v == nd else int(v) for v in a[:, r, c].tolist()]})
  out[name] = pts
json.dump(out, sys.stdout)
