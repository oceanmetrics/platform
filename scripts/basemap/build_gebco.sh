#!/usr/bin/env bash
# build_gebco.sh: the GEBCO 2025 sea-floor tiers @oceanmetrics/map's basemap reads (basemap.ts DEFAULT_TILES), for the
# globe at every zoom the apps use and a deeper tier over the 18 national marine sanctuaries:
#
#   gebco/far.pmtiles               terrain-RGB, the globe, z0-5, 512 px tiles
#   gebco/core.pmtiles              terrain-RGB, the globe, z0-8 (its z0-5 tiles are far's own, copied)
#   gebco/core-sanctuaries.pmtiles  terrain-RGB, the sanctuaries' boxes padded 1 degree (PMNM in two), z9-10: the
#                                   style's `regional` list, drawn over core from z9
#   gebco/contours.pmtiles          isobaths (ele, level; source layer `contours`), the globe, z0-10, every level at the
#                                   full 15" resolution, zoom-gated in the tiles (level 3 from z0, 2 from z5, 1 from z7, 0 from z9)
#   osm/land.pmtiles                OpenStreetMap land polygons, the globe (source layer `land`), z0-LAND_ZMAX (default 10)
#   gebco/names.pmtiles             the IHO-IOC GEBCO gazetteer of undersea feature names (source layer `names`: label =
#                                   name + generic term, rank 1-3), the globe, from fetch_gazetteer.py
#
# The recipe is CalCOFI workflows `scripts/build_bathymetry_tiles.py` (explore's tiers, plan 2026-08-31) moved from a
# California box to the globe, in shell, with GDAL (>= 3.8: gdalwarp, gdal_calc.py, gdal_translate to MBTiles,
# gdal_contour, ogr2ogr), tippecanoe and the pmtiles CLI. Its rules are kept:
#   - terrain is two archives, not one sparse: MapLibre never fetches a parent tile as a fallback, so a sparse archive's
#     missing z6-8 children leave the far field blank. far is the globe at z0-5 (a small first-paint tier), core the globe
#     at z0-8, and the style draws far under core.
#   - land is clamped to exactly 0 m before any resampling, and an encoded tile is never resampled (an averaged
#     terrain-RGB byte is not an averaged elevation): each zoom is warped from the elevation to that zoom's exact 512 px
#     WebMercator grid (`average` coarser than GEBCO's 15" cell, `bilinear` finer), then encoded. no source data = +1 m.
#     Each zoom is warped in blocks of 16 x 16 tiles (8192 px square), JOBS blocks at a time, so z8 (131072 px square)
#     never exists as one raster.
#   - the custom 1 m encoding: elevation = R*65536 + G*256 + B - 10000 (R is 0 for any sea floor), half the bytes of
#     mapbox's 0.1 m. It saturates at -10000 m: the Challenger Deep (-10,7xx m) and the other trench floors deeper than
#     10 km decode as -10000 m (the depth ramp ends at -6500 m, so nothing shows).
#   - the isobath levels are gated by zoom in the tiles as in the style (basemap.ts CONTOUR_LEVELS). ele and level are
#     written as doubles.
#
# Vector tiers (contours, land, names) are written with tippecanoe, as CalCOFI's recipe did (zoom filter on `level`,
# simplification only at low zooms): GDAL's MVT writer neither simplifies nor limits a tile's size.
#
# Run on the mini on 2026-10-23 (build week 2), then the outputs go to https://storage.oceanmetrics.io/basemap/ (step
# `upload`, through scripts/om-publish.sh).
#
# usage:
#   scripts/basemap/build_gebco.sh <gebco_dir> <out_dir> [steps]
#     gebco_dir  the GEBCO 2025 global grid as GeoTIFF tiles (gebco_2025_geotiff.zip, unzipped; any *.tif)
#     out_dir    the archives under <out_dir>/gebco and <out_dir>/osm; work files under <out_dir>/work, or $WORK
#     steps      comma-separated, default prep,far,core,regional,contours,land,names,verify; `upload` sends the archives
#                through om-publish.sh (both stores; UPLOAD_MODE=--dry-run only lists) to
#                  basemap/<set>/v<YYYYMMDD>/<file>.pmtiles   the versioned keys (set = gebco, osm): the storage Worker
#                                                             caches a v<digits>/ folder at the edge for a year; @oceanmetrics/map
#                                                             >= 0.3.5 reads these (BASEMAP_VERSION in packages/map/src/basemap.ts)
#                  basemap/<set>/<file>.pmtiles               the unversioned keys, still written for map <= 0.3.4
#                the date is BASEMAP_VERSION, else the newest modification date (UTC) of the archives: the date of the build.
#                A version folder is immutable: uploading other bytes under a date already published exits 3 (om-publish);
#                a rebuild gets a new date, and map gets a new BASEMAP_VERSION.
#   environment: OM_PUBLISH (the publisher; default scripts/om-publish.sh), UPLOAD_MODE, BASEMAP_VERSION (YYYYMMDD), WORK (work dir), RAW (downloads: land-polygons-split-4326.zip, gazetteer/), PYTHON (default python3),
#                JOBS (parallel blocks, default 8), LAND_ZMAX (default 10)
set -euo pipefail

SRC_DIR=${1:?usage: build_gebco.sh <gebco_dir> <out_dir> [steps]}
OUT=${2:?usage: build_gebco.sh <gebco_dir> <out_dir> [steps]}
STEPS=${3:-prep,far,core,regional,contours,land,names,verify}
WORK=${WORK:-$OUT/work}
RAW=${RAW:-$OUT/raw}
JOBS=${JOBS:-8}
mkdir -p "$WORK" "$OUT/gebco" "$OUT/osm"

TILE=512
BLOCK=16                                  # tiles per block side
FAR_ZMAX=5
CORE_ZMAX=8
REGIONAL_ZMIN=9
REGIONAL_ZMAX=10
PAD=1.0                                   # degrees around each sanctuary box: room to pan
O=20037508.342789244                      # WebMercator half-extent (m)
NATIVE_M=463.3                            # a GEBCO 15" cell in mercator x units
LEVELS="50 100 200 300 400 500 750 1000 1500 2000 2500 3000 3500 4000 4500 5000 5500 6000 6500 7000 7500 8000 8500 9000 9500 10000"
CITATION="GEBCO Compilation Group (2025) GEBCO 2025 Grid (doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29)"
OSM_ZIP_URL=https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip

# the 18 national marine sanctuaries (gazetteer group NMS:*, places index bboxes, 2026-10-22), w s e n. PMNM crosses
# the antimeridian (177.8 to 199.0 unwrapped), so it is two boxes.
BOXES=$(cat <<'EOF'
CBNMS -123.99988 37.76687 -123.08237 38.29989
CHNMS -121.705002 33.823772 -119.93333 35.19279
CINMS -120.64208 33.36241 -118.90712 34.20707
FGBNMS -94.30888 27.78357 -91.97273 28.35456
FKNMS -83.149885 24.300408 -80.066471 25.650458
GFNMS -124.3335 37.49418 -122.627937 39.000002
GRNMS -80.921201 31.362732 -80.828143 31.421064
HIHWNMS -159.599848 19.72766 -155.822341 22.28481
LONMS -77.3881144 43.2700149 -76.05881 44.1128878
MBNMS -123.14009 35.5 -121.103558 37.881633
MBPR -77.3226942 38.3973056 -77.25651 38.4855385
MNMS -75.417921 34.998235 -75.401255 35.014901
NMSAS -171.140903 -15.38615 -167.283526 -10.9976
OCNMS -125.681663 47.129166 -124.183899 48.50589
PMNM_W 177.8 19.2345784 180 31.7978642
PMNM_E -180 19.2345784 -161.0 31.7978642
SBNMS -70.597366 42.0933 -70.035064 42.766715
TBNMS -84.3333321 44.5117378 -82.3295193 45.833334
WSCNMS -87.88778470000001 43.3151851 -87.3438818 44.352801
EOF
)

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
has() { [[ ",$STEPS," == *",$1,"* ]]; }

# a box padded by PAD, clamped to the globe and to WebMercator's latitude limit: "w s e n"
padded() { awk -v w="$1" -v s="$2" -v e="$3" -v n="$4" -v p="$PAD" 'BEGIN {
  w -= p; s -= p; e += p; n += p
  if (w < -180) w = -180; if (e > 180) e = 180; if (s < -85.0511) s = -85.0511; if (n > 85.0511) n = 85.0511
  printf "%.6f %.6f %.6f %.6f\n", w, s, e, n }'; }

# the xyz tile range covering a lon/lat box at zoom z: "x0 y0 x1 y1" (y from the top), as tile_range() in the recipe
tile_range() { awk -v w="$1" -v s="$2" -v e="$3" -v n="$4" -v z="$5" -v O="$O" 'function my(lat,  r) { r = lat * 3.141592653589793 / 180; return log(sin(r) / cos(r) + 1 / cos(r)) * O / 3.141592653589793 }
  function fl(x) { return x < 0 && x != int(x) ? int(x) - 1 : int(x) }
  BEGIN { span = 2 * O / 2 ^ z; eps = 1e-9 * span; m = 2 ^ z - 1
    x0 = fl((w * O / 180 + O) / span); x1 = fl((e * O / 180 - eps + O) / span)
    y0 = fl((O - my(n)) / span); y1 = fl((O - my(s) - eps) / span)
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > m) x1 = m; if (y1 > m) y1 = m
    print x0, y0, x1, y1 }'; }

# ---- prep: one elevation raster, land clamped to 0 ----
ELEV="$WORK/elev_clamped.tif"
prep() {
  [[ -f "$ELEV" ]] && { log "prep: $ELEV exists"; return; }
  gdalbuildvrt -q "$WORK/gebco.vrt" "$SRC_DIR"/*.tif
  log "prep: clamp land to 0 m"
  gdal_calc.py --quiet -A "$WORK/gebco.vrt" --calc="minimum(A,0)" --type=Int16 --NoDataValue=-32768 --outfile="$ELEV" \
    --co TILED=YES --co COMPRESS=DEFLATE --co PREDICTOR=2 --co BIGTIFF=YES --co NUM_THREADS=ALL_CPUS
}

# ---- terrain: blocks of tiles, each warped to its exact tile grid, encoded, written as one MBTiles ----
# terrain_block <tag> <z> <x0> <y0> <x1> <y1> -> $WORK/terrain/<tag>_z<z>_x<x0>_y<y0>.mbtiles (tile ranges inclusive, y from the top)
terrain_block() {
  local tag=$1 z=$2 x0=$3 y0=$4 x1=$5 y1=$6
  local base="$WORK/terrain/${tag}_z${z}_x${x0}_y${y0}"
  [[ -f "$base.mbtiles" ]] && return
  read -r xmin ymin xmax ymax res alg < <(awk -v x0="$x0" -v y0="$y0" -v x1="$x1" -v y1="$y1" -v z="$z" -v O="$O" -v T="$TILE" -v nat="$NATIVE_M" \
    'BEGIN { span = 2 * O / 2 ^ z; res = span / T; printf "%.6f %.6f %.6f %.6f %.10f %s\n", x0 * span - O, O - (y1 + 1) * span, (x1 + 1) * span - O, O - y0 * span, res, (res > nat ? "average" : "bilinear") }')
  log "terrain $tag z$z: tiles x$x0-$x1 y$y0-$y1 ($alg)"
  gdalwarp -q -overwrite -t_srs EPSG:3857 -te "$xmin" "$ymin" "$xmax" "$ymax" -tr "$res" "$res" -r "$alg" \
    -ot Float32 -dstnodata nan -wo NUM_THREADS=2 -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER "$ELEV" "$base.tif"
  # v = round(elevation + 10000), no data = +1 m; R = 0, G = v >> 8, B = v & 255
  gdal_calc.py --quiet -A "$base.tif" --hideNoData --type=Byte --NoDataValue=none --outfile="$base.rgb.tif" --overwrite \
    --calc="0*A" \
    --calc="floor(clip(rint(where(isnan(A),1,A)+10000),0,65535)/256)" \
    --calc="clip(rint(where(isnan(A),1,A)+10000),0,65535)%256" \
    --co TILED=YES --co COMPRESS=LZW
  # the raster is on the zoom's tile grid already: NEAREST only so the driver never resamples an encoded byte
  rm -f "$base.part"
  gdal_translate -q -of MBTILES -co TILE_FORMAT=PNG -co ZLEVEL=9 -co BLOCKSIZE=$TILE -co ZOOM_LEVEL_STRATEGY=AUTO \
    -co RESAMPLING=NEAREST "$base.rgb.tif" "$base.part"
  rm -f "$base.tif" "$base.rgb.tif"
  mv "$base.part" "$base.mbtiles"
}

# blocks <tag> <z> <x0> <y0> <x1> <y1>: one job line per BLOCK x BLOCK piece of the tile range
blocks() {
  local tag=$1 z=$2 x0=$3 y0=$4 x1=$5 y1=$6 x y
  for ((y = y0; y <= y1; y += BLOCK)); do
    for ((x = x0; x <= x1; x += BLOCK)); do
      echo "$tag $z $x $y $(( x + BLOCK - 1 < x1 ? x + BLOCK - 1 : x1 )) $(( y + BLOCK - 1 < y1 ? y + BLOCK - 1 : y1 ))"
    done
  done
}

# run_blocks: the job lines on stdin, JOBS at a time
run_blocks() { xargs -P "$JOBS" -L1 bash -c 'set -euo pipefail; terrain_block "$@"' _; }

# merge_mbtiles <out.mbtiles> <name> <minzoom> <maxzoom> <bounds> <inputs...>: one MBTiles of every input's tiles
merge_mbtiles() {
  local out=$1 name=$2 zmin=$3 zmax=$4 bounds=$5; shift 5
  rm -f "$out"
  sqlite3 "$out" "CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    INSERT INTO metadata VALUES ('name', '$name'), ('format', 'png'), ('type', 'baselayer'), ('version', '1'), ('minzoom', '$zmin'), ('maxzoom', '$zmax'),
      ('bounds', '$bounds'), ('attribution', '$CITATION'),
      ('description', 'GEBCO 2025 sea floor as terrain-RGB (custom 1 m encoding: R*65536 + G*256 + B - 10000), 512 px tiles, land clamped to 0 m');"
  local f
  for f in "$@"; do
    sqlite3 "$out" "ATTACH '$f' AS s; INSERT OR IGNORE INTO tiles SELECT zoom_level, tile_column, tile_row, tile_data FROM s.tiles; DETACH s;"
  done
}

to_pmtiles() {
  local mbt=$1 pm=$2
  rm -f "$pm"
  pmtiles convert "$mbt" "$pm"
  pmtiles verify "$pm"
  log "$(basename "$pm"): $(du -h "$pm" | cut -f1), $(sqlite3 "$mbt" 'SELECT count(*) FROM tiles') tiles"
}

# the terrain blocks of the globe at zooms $1..$2, as job lines
globe_blocks() { local tag=$1 z; for z in $(seq "$2" "$3"); do blocks "$tag" "$z" 0 0 $(( (1 << z) - 1 )) $(( (1 << z) - 1 )); done; }
# the block files of a tag at zooms $1..$2
block_files() { local tag=$1 z; for z in $(seq "$2" "$3"); do ls "$WORK"/terrain/${tag}_z${z}_x*.mbtiles; done; }

far() {
  mkdir -p "$WORK/terrain"
  globe_blocks far 0 $FAR_ZMAX | run_blocks
  # shellcheck disable=SC2046
  merge_mbtiles "$WORK/far.mbtiles" "gebco_2025_far" 0 $FAR_ZMAX "-180,-85.0511,180,85.0511" $(block_files far 0 $FAR_ZMAX)
  to_pmtiles "$WORK/far.mbtiles" "$OUT/gebco/far.pmtiles"
}

# core: the globe z0-8, far's z0-5 blocks plus z6-8 of its own
core() {
  mkdir -p "$WORK/terrain"
  globe_blocks far 0 $FAR_ZMAX | run_blocks
  globe_blocks core $((FAR_ZMAX + 1)) $CORE_ZMAX | run_blocks
  # shellcheck disable=SC2046
  merge_mbtiles "$WORK/core.mbtiles" "gebco_2025_core" 0 $CORE_ZMAX "-180,-85.0511,180,85.0511" $(block_files far 0 $FAR_ZMAX) $(block_files core $((FAR_ZMAX + 1)) $CORE_ZMAX)
  to_pmtiles "$WORK/core.mbtiles" "$OUT/gebco/core.pmtiles"
}

# regional: the sanctuaries' padded boxes at z9-10
regional() {
  mkdir -p "$WORK/terrain"
  local tag w s e n pw ps pe pn z x0 y0 x1 y1
  while read -r tag w s e n; do
    read -r pw ps pe pn < <(padded "$w" "$s" "$e" "$n")
    for z in $(seq $REGIONAL_ZMIN $REGIONAL_ZMAX); do
      read -r x0 y0 x1 y1 < <(tile_range "$pw" "$ps" "$pe" "$pn" "$z")
      blocks "reg_$tag" "$z" "$x0" "$y0" "$x1" "$y1"
    done
  done <<< "$BOXES" | run_blocks
  # shellcheck disable=SC2046
  merge_mbtiles "$WORK/regional.mbtiles" "gebco_2025_core_sanctuaries" $REGIONAL_ZMIN $REGIONAL_ZMAX "$(boxes_bounds)" $(block_files 'reg_*' $REGIONAL_ZMIN $REGIONAL_ZMAX)
  to_pmtiles "$WORK/regional.mbtiles" "$OUT/gebco/core-sanctuaries.pmtiles"
}

# the union bounding box of the padded boxes: "w,s,e,n"
boxes_bounds() {
  local tag w s e n pw ps pe pn
  while read -r tag w s e n; do padded "$w" "$s" "$e" "$n"; done <<< "$BOXES" |
    awk 'NR == 1 || $1 < w { w = $1 } NR == 1 || $2 < s { s = $2 } NR == 1 || $3 > e { e = $3 } NR == 1 || $4 > n { n = $4 } END { printf "%s,%s,%s,%s\n", w, s, e, n }'
}

# ---- contours ----
# ele (m, positive down) and level (0 = 50 m, 1 = 100-750, 2 = 500-multiples, 3 = 1000-multiples), as doubles (tippecanoe's
# -j filter refuses to compare an integer-typed attribute)
LEVEL_SQL="CAST(-ELEV AS REAL) AS ele, CAST(CASE WHEN CAST(-ELEV AS INTEGER) % 1000 = 0 THEN 3 WHEN CAST(-ELEV AS INTEGER) % 500 = 0 THEN 2 WHEN -ELEV >= 100 THEN 1 ELSE 0 END AS REAL) AS level"
# the zoom gate of CONTOUR_LEVELS (basemap.ts): 1000s from z0, 500s from z5, 100-750 from z7, 50 from z9
CONTOUR_FILTER='{"*":["any",["==","level",3],["all",[">=","$zoom",5],["==","level",2]],["all",[">=","$zoom",7],["==","level",1]],["all",[">=","$zoom",9],["==","level",0]]]}'

# contour_chunk <i> <j>: the 45 x 45 degree chunk (column i of 8, row j of 4) of the clamped grid, every level, to a
# FlatGeobuf. a chunk reaches one cell into its neighbours so the lines meet at the seams.
contour_chunk() {
  local i=$1 j=$2 cs=10800 x y w h
  local fgb="$WORK/contours/c_${i}_${j}.fgb"
  [[ -f "$fgb" ]] && return
  x=$(( i * cs - (i > 0 ? 1 : 0) )); w=$(( cs + (i > 0 ? 1 : 0) + (i < 7 ? 1 : 0) ))
  y=$(( j * cs - (j > 0 ? 1 : 0) )); h=$(( cs + (j > 0 ? 1 : 0) + (j < 3 ? 1 : 0) ))
  log "contours: chunk $i,$j"
  local tif="$WORK/contours/c_${i}_${j}.tif" gpkg="$WORK/contours/c_${i}_${j}.gpkg" lv=""
  gdal_translate -q -srcwin "$x" "$y" "$w" "$h" -co TILED=YES -co COMPRESS=DEFLATE "$ELEV" "$tif"
  # elevations are negative: the fixed levels go from the deepest up (gdal_contour wants them increasing)
  local l; for l in $LEVELS; do lv="-$l $lv"; done
  # shellcheck disable=SC2086
  gdal_contour -q -a ELEV -snodata -32768 -fl $lv "$tif" "$gpkg"
  rm -f "$tif" "$fgb.part.fgb"
  # (the FlatGeobuf driver makes a directory of any name that does not end in .fgb)
  ogr2ogr -f FlatGeobuf "$fgb.part.fgb" "$gpkg" -dialect SQLITE -nln contours -sql "SELECT geom, $LEVEL_SQL FROM contour"
  rm -f "$gpkg"
  mv "$fgb.part.fgb" "$fgb"
}

# the contours are two pyramids in one layer: the globe's every-level lines at the full 15" resolution from z7 (46 chunks'
# worth: tippecanoe handles a z7 tile's few thousand lines), and below z7 the 500/1000 m lines of a ~4.6 km grid. At
# z0-6 the full-resolution lines are far more than one tile can hold (z0 alone: 64,000 closed loops; tippecanoe's
# --drop-smallest-as-needed does not converge on it), and a 4.6 km line is under a pixel at z6 (2.4 km per 512 px tile pixel is not).
CONTOUR_LOW_ZMAX=6
contours() {
  mkdir -p "$WORK/contours" "$WORK/tmp"
  for j in 0 1 2 3; do for i in 0 1 2 3 4 5 6 7; do echo "$i $j"; done; done |
    xargs -P "$JOBS" -L1 bash -c 'set -euo pipefail; contour_chunk "$@"' _
  # low: a ~4.6 km grid (1/10 the cells), the levels that are 500-multiples; lines shorter than 0.05 deg are the grid's
  # specks (CalCOFI's min_len_deg)
  local low="$WORK/contours/low.fgb"
  if [[ ! -f "$low" ]]; then
    log "contours: low grid"
    gdalwarp -q -overwrite -tr 0.041666666667 0.041666666667 -r average -ot Int16 -dstnodata -32768 -co TILED=YES -co COMPRESS=DEFLATE "$ELEV" "$WORK/elev_low.tif"
    local lv="" l; for l in $LEVELS; do (( l % 500 == 0 )) && lv="-$l $lv"; done
    # shellcheck disable=SC2086
    gdal_contour -q -a ELEV -snodata -32768 -fl $lv "$WORK/elev_low.tif" "$WORK/contours_low.gpkg"
    rm -f "$low.part.fgb"
    ogr2ogr -f FlatGeobuf "$low.part.fgb" "$WORK/contours_low.gpkg" -dialect SQLITE -nln contours -sql "SELECT geom, $LEVEL_SQL FROM contour WHERE ST_Length(geom) >= 0.05"
    mv "$low.part.fgb" "$low"; rm -f "$WORK/contours_low.gpkg" "$WORK/elev_low.tif"
  fi
  # two tippecanoe runs, one per pyramid (it takes no zoom range per input file), joined into one archive
  rm -f "$OUT/gebco/contours.pmtiles" "$WORK/contours_low.pmtiles" "$WORK/contours_full.pmtiles"
  tippecanoe -Q -o "$WORK/contours_low.pmtiles" --force -t "$WORK/tmp" -z$CONTOUR_LOW_ZMAX -Z0 -l contours \
    --simplify-only-low-zooms --drop-smallest-as-needed --no-tiny-polygon-reduction -j "$CONTOUR_FILTER" "$low"
  tippecanoe -Q -o "$WORK/contours_full.pmtiles" --force -t "$WORK/tmp" -z10 -Z$((CONTOUR_LOW_ZMAX + 1)) -l contours \
    --simplify-only-low-zooms --drop-smallest-as-needed --no-tiny-polygon-reduction -j "$CONTOUR_FILTER" "$WORK"/contours/c_*.fgb
  tile-join -pk --force -o "$OUT/gebco/contours.pmtiles" -n "GEBCO 2025 isobaths" -A "$CITATION" "$WORK/contours_low.pmtiles" "$WORK/contours_full.pmtiles"
  pmtiles verify "$OUT/gebco/contours.pmtiles"
}

# ---- land: the OSM coastline CARTO's water derives from, the globe ----
LAND_ZMAX=${LAND_ZMAX:-10}
land() {
  local zip="$RAW/land-polygons-split-4326.zip"
  [[ -f "$zip" ]] || curl -sSfL -o "$zip" "$OSM_ZIP_URL"
  mkdir -p "$WORK/tmp"
  rm -f "$OUT/osm/land.pmtiles"
  [[ -f "$WORK/land.fgb" ]] || ogr2ogr -f FlatGeobuf "$WORK/land.fgb" "/vsizip/$zip/land-polygons-split-4326/land_polygons.shp" -nln land -nlt PROMOTE_TO_MULTI
  tippecanoe -Q -o "$OUT/osm/land.pmtiles" --force -t "$WORK/tmp" -z"$LAND_ZMAX" -Z0 -l land -n "OpenStreetMap land polygons" \
    -A "© OpenStreetMap contributors (ODbL); land polygons by osmdata.openstreetmap.de" \
    --simplification=10 --simplify-only-low-zooms --no-tiny-polygon-reduction --no-tile-size-limit --no-feature-limit "$WORK/land.fgb"
  pmtiles verify "$OUT/osm/land.pmtiles"
}

# ---- names: the gazetteer's records as labelled features (CalCOFI workflows libs/reference_layers.R build_gazetteer_labels) ----
# label = name + generic term; rank 1 (escarpments, ridges, trenches, plains ...) from z4, 2 (the rest: basins, banks,
# seamounts, canyons ...) from z6, 3 (knolls, hills, reefs, shoals ...) from z8; the style gates by rank (NAME_RANKS)
RANK_SQL="CASE WHEN TYPE IN ('Escarpment','Fracture Zone','Ridge','Ridges','Rise','Trench','Seamount Chain','Seamount Province','Fan','Plateau','Abyssal Plain','Shelf','Slope') THEN 1
  WHEN TYPE IN ('Knoll','Knolls','Hill','Hills','Valley','Terrace','Channel','Seamounts','Reef','Reefs','Shoal','Shoals','Spur','Spurs','Sill','Saddle','Gap','Hole','Pinnacle') THEN 3 ELSE 2 END"
names() {
  local gz="$RAW/gazetteer" ins=() k geom
  [[ -f "$gz/gebco_gazetteer_points.geojson" ]] || "${PYTHON:-python3}" -I "$(dirname "${BASH_SOURCE[0]}")/fetch_gazetteer.py" "$gz"
  rm -f "$OUT/gebco/names.pmtiles"
  for k in points lines polygons; do
    case $k in points) geom="ST_Centroid(geometry)";; polygons) geom="ST_PointOnSurface(geometry)";; lines) geom="geometry";; esac
    ogr2ogr -f GeoJSONSeq "$WORK/names_$k.geojsonl" "$gz/gebco_gazetteer_$k.geojson" -dialect SQLITE -nln names \
      -sql "SELECT $geom AS geometry, FEATURE_ID AS feature_id, NAME AS name, TYPE AS type, trim(NAME || ' ' || TYPE) AS label, $RANK_SQL AS rank, '$k' AS kind FROM gebco_gazetteer_$k"
    ins+=("$WORK/names_$k.geojsonl")
  done
  tippecanoe -Q -o "$OUT/gebco/names.pmtiles" --force -z10 -Z0 -r1 -l names -n "GEBCO undersea feature names" \
    -A "IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net" \
    --simplification=10 --simplify-only-low-zooms --no-tiny-polygon-reduction --no-tile-size-limit --no-feature-limit "${ins[@]}"
  pmtiles verify "$OUT/gebco/names.pmtiles"
}

# ---- verify: every archive verifies and holds the tile count its grid implies ----
addressed() { pmtiles show "$1" | awk -F: '/addressed tiles count/ { gsub(/[ ,]/, "", $2); print $2 }'; }
verify() {
  local want_far=0 want_core=0 z got
  for z in $(seq 0 $CORE_ZMAX); do
    want_core=$(( want_core + (1 << z) * (1 << z) ))
    (( z <= FAR_ZMAX )) && want_far=$want_core
  done
  got=$(addressed "$OUT/gebco/far.pmtiles")
  [[ "$got" == "$want_far" ]] || { log "verify: far.pmtiles addresses $got tiles, $want_far expected"; exit 1; }
  got=$(addressed "$OUT/gebco/core.pmtiles")
  [[ "$got" == "$want_core" ]] || { log "verify: core.pmtiles addresses $got tiles, $want_core expected"; exit 1; }
  local f
  for f in "$OUT"/gebco/*.pmtiles "$OUT"/osm/*.pmtiles; do [[ -f "$f" ]] && pmtiles verify "$f"; done
  log "verify: far $want_far tiles, core $want_core tiles; every archive verifies"
}

# upload: gebco/*.pmtiles and osm/*.pmtiles (not the work files under $OUT/work) to the versioned keys
# basemap/<set>/v<YYYYMMDD>/ and then to the unversioned keys basemap/<set>/, on both stores through om-publish.sh (R2 then S3;
# never deletes; checksum-compared, so an unchanged archive is not sent again). It uploads for real, as the step always did;
# UPLOAD_MODE=--dry-run lists what it would send and writes nothing. The versioned keys go first: they are immutable at the edge,
# so om-publish stops (exit 3) before the unversioned ones when a version folder already holds other bytes.
# the version is BASEMAP_VERSION, else the date (UTC) of the newest archive: the date of the build.
# S3_DEST and S3_ENDPOINT are no longer read: the prefix is basemap/ and the stores are om-publish's (OM_STORE).
basemap_version() {
  local f newest="" d
  if [[ -n "${BASEMAP_VERSION:-}" ]]; then
    [[ "$BASEMAP_VERSION" =~ ^[0-9]{8}$ ]] || { log "upload: BASEMAP_VERSION must be YYYYMMDD (got '$BASEMAP_VERSION')"; exit 1; }
    printf '%s' "$BASEMAP_VERSION"; return
  fi
  for f in "$OUT"/gebco/*.pmtiles "$OUT"/osm/*.pmtiles; do
    [[ -f "$f" ]] || continue
    d=$(date -u -r "$f" +%Y%m%d)
    [[ -z "$newest" || "$d" > "$newest" ]] && newest=$d
  done
  [[ -n "$newest" ]] || { log "upload: no archive under $OUT/gebco or $OUT/osm"; exit 1; }
  printf '%s' "$newest"
}
upload() {
  local publisher="${OM_PUBLISH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/om-publish.sh}" mode="${UPLOAD_MODE:---really}" v set
  [[ -x "$publisher" ]] || { log "upload: $publisher not found (set OM_PUBLISH)"; exit 1; }
  v=$(basemap_version)
  log "upload: basemap/<set>/v$v/ (versioned), then basemap/<set>/ (unversioned, map <= 0.3.4)"
  for set in gebco osm; do
    compgen -G "$OUT/$set/*.pmtiles" >/dev/null || continue   # a set with no archive (a partial build) is skipped
    "$publisher" "$mode" --include '*.pmtiles' "$OUT/$set" "basemap/$set/v$v"
  done
  "$publisher" "$mode" --include 'gebco/*.pmtiles' --include 'osm/*.pmtiles' "$OUT" basemap
}

# the block and chunk workers run under xargs -P, in their own bash
export -f terrain_block contour_chunk log
export WORK ELEV TILE O NATIVE_M LEVELS LEVEL_SQL

has prep && prep
has far && far
has core && core
has regional && regional
has contours && contours
has land && land
has names && names
has verify && verify
has upload && upload
log "done: $STEPS"
