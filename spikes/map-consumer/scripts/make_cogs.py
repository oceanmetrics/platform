# the COG fixtures of the consumer check, in data/cogs/: a synthetic two-band EPSG:3857 COG (band 1 a constant 10,
# band 2 four stripes 0/33/66/100 by longitude, the southern quarter nodata 255) for atlas:bidx, and the points of
# the AquaMaps native 3857 copy (spike 3's make_3857.sh output) the page checks: one inside the species range, one
# outside (nodata 0), each the centre of a uniform 7x7 block so the pixel holds at any zoom it is drawn at.
# usage: uv run --with rasterio --with numpy python scripts/make_cogs.py <3857 dir>
import json, os, shutil, sys
import numpy as np
import rasterio
from rasterio.shutil import copy as rcopy
from rasterio.transform import from_bounds

src_dir = sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/claude-501/-Users-bbest-Github-oceanmetrics/451534d5-abb8-4d50-8339-03e8d78abf49/scratchpad/cogs/3857'
out = 'data/cogs'
os.makedirs(out, exist_ok=True)
for f in ['729c63f1d05d0515.tif']:
  shutil.copy(os.path.join(src_dir, f), os.path.join(out, f))
# the 4326 original, for the refusal (never fetched: cogSlot throws first)
orig = os.path.join(os.path.dirname(src_dir.rstrip('/')), '729c63f1d05d0515.tif')
if os.path.exists(orig): shutil.copy(orig, os.path.join(out, '729c63f1d05d0515_4326.tif'))

# ---- the two-band synthetic ----
E = 20037508.342789244
n = 1024
b1 = np.full((n, n), 10, dtype=np.uint8)
cols = np.arange(n) * 4 // n
b2 = np.tile(np.array([0, 33, 66, 100], dtype=np.uint8)[cols], (n, 1))
b1[3 * n // 4:, :] = 255
b2[3 * n // 4:, :] = 255
profile = dict(driver='GTiff', width=n, height=n, count=2, dtype='uint8', crs='EPSG:3857', nodata=255,
               transform=from_bounds(-E, -E, E, E, n, n), tiled=True, blockxsize=256, blockysize=256)
tmp = os.path.join(out, '_two_band.tif')
with rasterio.open(tmp, 'w', **profile) as dst:
  dst.write(b1, 1)
  dst.write(b2, 2)
rcopy(tmp, os.path.join(out, 'two_band_3857.tif'), driver='COG', TILING_SCHEME='GoogleMapsCompatible', BLOCKSIZE=256,
      COMPRESS='DEFLATE', OVERVIEW_RESAMPLING='NEAREST', ADD_ALPHA='NO')
os.remove(tmp)

# ---- points of the AquaMaps copy ----
def lonlat(x, y):
  lon = x / E * 180
  lat = np.degrees(2 * np.arctan(np.exp(y / E * np.pi)) - np.pi / 2)
  return float(lon), float(lat)

with rasterio.open(os.path.join(out, '729c63f1d05d0515.tif')) as ds:
  a = ds.read(1)
  nd = ds.nodata
  pts = {}
  k = 3
  def uniform(r, c):
    blk = a[r - k:r + k + 1, c - k:c + k + 1]
    return blk.size == (2 * k + 1) ** 2 and (blk == blk[0, 0]).all()
  rows, cols_ = np.nonzero(a != nd)
  order = np.argsort(-a[rows, cols_].astype(int), kind='stable')
  for i in order:
    r, c = int(rows[i]), int(cols_[i])
    if uniform(r, c):
      x, y = ds.xy(r, c)
      pts['inside'] = {'row': r, 'col': c, 'value': int(a[r, c]), 'lonlat': lonlat(x, y)}
      break
  # outside: nodata, in the middle of the raster's rows (inside the mercator view), far from the range
  rr, cc = np.nonzero(a == nd)
  mid = [(r, c) for r, c in zip(rr[::97], cc[::97]) if 200 < r < 500 and uniform(r, c)]
  r, c = mid[len(mid) // 2]
  x, y = ds.xy(r, c)
  pts['outside'] = {'row': int(r), 'col': int(c), 'value': int(a[r, c]), 'lonlat': lonlat(x, y)}
  pts['nodata'] = nd
  pts['bounds'] = list(ds.bounds)
  pts['crs'] = str(ds.crs)
json.dump(pts, open(os.path.join(out, 'points.json'), 'w'), indent=1)
print(json.dumps(pts))
with rasterio.open(os.path.join(out, 'two_band_3857.tif')) as ds:
  print('two_band', ds.count, ds.crs, ds.overviews(1), ds.block_shapes, ds.nodata)
