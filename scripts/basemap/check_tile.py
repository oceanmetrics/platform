#!/opt/homebrew/bin/python3
"""check_tile.py: decode one terrain-RGB tile of a PMTiles archive and compare a point with the GEBCO source.

  python3 -I check_tile.py <terrain.pmtiles> <z> <lon> <lat> [<gebco.tif>|<elev_clamped.tif> ...]

Encoding (basemap.ts DEM_ENCODING): elevation = R*65536 + G*256 + B - 10000, 512 px tiles. Prints the tile, the pixel,
the decoded elevation, the tile's min/max, and for each source raster the value at the pixel's centre (gdallocationinfo,
nearest and bilinear). From z8 up (a pixel finer than GEBCO's 15 arc-second cell) the tile is the bilinear value rounded
to 1 m; at the coarser zooms it is the average of the cells in the pixel, so it differs from the point value.
"""
import math, subprocess, sys
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
O = 20037508.342789244
T = 512


def tile_of(z, lon, lat):
    span = 2 * O / 2 ** z
    mx = lon * O / 180
    my = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * O / math.pi
    fx, fy = (mx + O) / span, (O - my) / span
    x, y = int(fx), int(fy)
    return x, y, int((fx - x) * T), int((fy - y) * T)


def decode(png):
    gdal.FileFromMemBuffer("/vsimem/t.png", png)
    a = gdal.Open("/vsimem/t.png").ReadAsArray().astype(np.int64)
    gdal.Unlink("/vsimem/t.png")
    return a[0] * 65536 + a[1] * 256 + a[2] - 10000


def centre_of(z, x, y, px, py):
    """lon, lat of a pixel's centre"""
    span = 2 * O / 2 ** z
    mx = x * span - O + (px + 0.5) * span / T
    my = O - y * span - (py + 0.5) * span / T
    return mx * 180 / O, math.degrees(2 * math.atan(math.exp(my * math.pi / O)) - math.pi / 2)


def source_value(path, lon, lat, resample):
    out = subprocess.run(["gdallocationinfo", "-valonly", "-wgs84", "-r", resample, path, str(lon), str(lat)], capture_output=True, text=True).stdout
    return out.strip()


def main(a):
    pm, z, lon, lat = a[0], int(a[1]), float(a[2]), float(a[3])
    x, y, px, py = tile_of(z, lon, lat)
    png = subprocess.run(["pmtiles", "tile", pm, str(z), str(x), str(y)], capture_output=True).stdout
    if not png:
        sys.exit(f"{pm}: no tile {z}/{x}/{y}")
    e = decode(png)
    clon, clat = centre_of(z, x, y, px, py)
    print(f"{pm} z{z} tile {x}/{y} pixel ({px},{py}) centre ({clon:.5f}, {clat:.5f}): {e[py, px]} m; tile min {e.min()} max {e.max()}; {len(png)} bytes")
    for src in a[4:]:
        print(f"  {src} at the pixel centre: nearest {source_value(src, clon, clat, 'near')} m, bilinear {source_value(src, clon, clat, 'bilinear')} m")


if __name__ == "__main__":
    main(sys.argv[1:])
