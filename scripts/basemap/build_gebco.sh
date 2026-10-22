#!/usr/bin/env bash
# build_gebco.sh: the GEBCO 2025 sea-floor tiers @oceanmetrics/map's basemap reads (basemap.ts DEFAULT_TILES):
#
#   gebco/far.pmtiles       terrain-RGB, the globe, z0-5, 512 px tiles
#   gebco/core.pmtiles      terrain-RGB, the 18 national marine sanctuaries' boxes (padded), z0-8, 512 px tiles
#   gebco/contours.pmtiles  isobaths (ele, level; source layer `contours`), z0-10: 500/1000-multiples globally from a
#                           ~4.6 km grid, every level at full resolution inside the boxes
#   osm/land.pmtiles        OpenStreetMap land polygons clipped to the boxes (source layer `land`), z0-12
#
# The recipe is CalCOFI workflows `scripts/build_bathymetry_tiles.py` (explore's tiers, plan 2026-08-31) moved from a
# California box to the globe plus the sanctuaries, in shell, with GDAL (>= 3.8: gdalwarp, gdal_calc.py, gdal_translate
# to MBTiles, gdal_contour, ogr2ogr to MVT) and the pmtiles CLI. Its rules are kept:
#   - two terrain archives, not one sparse: MapLibre never fetches a parent tile as a fallback, so a sparse archive's
#     missing z6-8 children leave the far field blank. far covers the globe at z0-5; core covers the boxes at z0-8
#     (its z0-5 tiles are far's own, copied), and the style draws far under core.
#   - land is clamped to exactly 0 m before any resampling, and an encoded tile is never resampled (an averaged
#     terrain-RGB byte is not an averaged elevation): each zoom is warped from the elevation to that zoom's exact 512 px
#     WebMercator grid (`average` coarser than GEBCO's 15" cell, `bilinear` finer), then encoded. no source data = +1 m.
#   - the custom 1 m encoding: elevation = R*65536 + G*256 + B - 10000 (R is 0 for any sea floor), half the bytes of
#     mapbox's 0.1 m.
#   - the isobath levels are gated by zoom in the tiles as in the style (basemap.ts CONTOUR_LEVELS): level 3
#     (1000-multiples) from z0, 2 (500-multiples) from z5, 1 (100-750 m) from z7, 0 (50 m) from z9. ele and level are
#     written as doubles.
#
# Not run on 2026-10-22: it runs on the mini in build week 2 (2026-11-06 to 11-12), then the outputs go to
# https://storage.oceanmetrics.io/basemap/ (step `upload`). The undersea names (gebco/names.pmtiles) are not built here:
# they follow CalCOFI workflows libs/reference_layers.R (the IHO-IOC gazetteer, label = name + generic term, rank 1-3).
#
# usage:
#   scripts/basemap/build_gebco.sh <gebco_dir> <out_dir> [steps]
#     gebco_dir  the GEBCO 2025 global grid as GeoTIFF tiles (gebco_2025_sub_ice_topo_geotiff.zip, unzipped; any *.tif)
#     out_dir    work files under <out_dir>/work, the archives under <out_dir>/gebco and <out_dir>/osm
#     steps      comma-separated, default prep,far,core,contours,land,verify; `upload` needs S3_DEST (and S3_ENDPOINT
#                for R2), e.g. S3_DEST=s3://oceanmetrics-storage/basemap
set -euo pipefail

SRC_DIR=${1:?usage: build_gebco.sh <gebco_dir> <out_dir> [steps]}
OUT=${2:?usage: build_gebco.sh <gebco_dir> <out_dir> [steps]}
STEPS=${3:-prep,far,core,contours,land,verify}
WORK="$OUT/work"
mkdir -p "$WORK" "$OUT/gebco" "$OUT/osm"

TILE=512
FAR_ZMAX=5
CORE_ZMAX=8
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

# ---- terrain: warp one zoom of one box to its exact tile grid, encode, write that zoom's MBTiles ----
# warp_encode <tag> <z> <w s e n> -> $WORK/terrain/<tag>_z<z>.mbtiles
warp_encode() {
  local tag=$1 z=$2 w=$3 s=$4 e=$5 n=$6
  local out="$WORK/terrain/${tag}_z${z}.mbtiles"
  mkdir -p "$WORK/terrain"
  [[ -f "$out" ]] && return
  read -r x0 y0 x1 y1 < <(tile_range "$w" "$s" "$e" "$n" "$z")
  read -r xmin ymin xmax ymax res alg < <(awk -v x0="$x0" -v y0="$y0" -v x1="$x1" -v y1="$y1" -v z="$z" -v O="$O" -v T="$TILE" -v nat="$NATIVE_M" \
    'BEGIN { span = 2 * O / 2 ^ z; res = span / T; printf "%.6f %.6f %.6f %.6f %.10f %s\n", x0 * span - O, O - (y1 + 1) * span, (x1 + 1) * span - O, O - y0 * span, res, (res > nat ? "average" : "bilinear") }')
  local tif="$WORK/terrain/${tag}_z${z}.tif" enc="$WORK/terrain/${tag}_z${z}_rgb.tif"
  log "terrain $tag z$z: tiles x$x0-$x1 y$y0-$y1 ($alg)"
  gdalwarp -q -overwrite -t_srs EPSG:3857 -te "$xmin" "$ymin" "$xmax" "$ymax" -tr "$res" "$res" -r "$alg" \
    -ot Float32 -dstnodata nan -wo NUM_THREADS=ALL_CPUS -multi -co TILED=YES -co COMPRESS=LZW -co BIGTIFF=IF_SAFER "$ELEV" "$tif"
  # v = round(elevation + 10000), no data = +1 m; R = 0, G = v >> 8, B = v & 255
  gdal_calc.py --quiet -A "$tif" --hideNoData --type=Byte --NoDataValue=none --outfile="$enc" --overwrite \
    --calc="0*A" \
    --calc="floor(clip(rint(where(isnan(A),1,A)+10000),0,65535)/256)" \
    --calc="clip(rint(where(isnan(A),1,A)+10000),0,65535)%256" \
    --co TILED=YES --co COMPRESS=LZW
  # the raster is on the zoom's tile grid already: NEAREST only so the driver never resamples an encoded byte
  gdal_translate -q -of MBTILES -co TILE_FORMAT=PNG -co ZLEVEL=9 -co BLOCKSIZE=$TILE -co ZOOM_LEVEL_STRATEGY=AUTO \
    -co RESAMPLING=NEAREST "$enc" "$out"
  rm -f "$tif" "$enc"
}

# merge_mbtiles <out.mbtiles> <name> <minzoom> <maxzoom> <bounds> <inputs...>: one MBTiles of every input's tiles
merge_mbtiles() {
  local out=$1 name=$2 zmin=$3 zmax=$4 bounds=$5; shift 5
  rm -f "$out"
  sqlite3 "$out" "CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    INSERT INTO metadata VALUES ('name', '$name'), ('format', 'png'), ('type', 'baselayer'), ('version', '1'), ('minzoom', '$zmin'), ('maxzoom', '$zmax'),
      ('bounds', '$bounds'), ('attribution', '$CITATION'),
      ('description', 'GEBCO 2025 sea floor as terrain-RGB (custom 1 m encoding: R*65536 + G*256 + B - 10000), 512 px tiles, land clamped to 0 m');"
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

far() {
  local ins=()
  for z in $(seq 0 $FAR_ZMAX); do warp_encode far "$z" -180 -85.0511 180 85.0511; ins+=("$WORK/terrain/far_z${z}.mbtiles"); done
  merge_mbtiles "$WORK/far.mbtiles" "gebco_2025_far" 0 $FAR_ZMAX "-180,-85.0511,180,85.0511" "${ins[@]}"
  to_pmtiles "$WORK/far.mbtiles" "$OUT/gebco/far.pmtiles"
}

core() {
  [[ -f "$WORK/far.mbtiles" ]] || { log "core: run the far step first (core's z0-5 tiles are far's)"; exit 1; }
  local ins=()
  while read -r tag w s e n; do
    read -r pw ps pe pn < <(padded "$w" "$s" "$e" "$n")
    for z in $(seq $((FAR_ZMAX + 1)) $CORE_ZMAX); do warp_encode "$tag" "$z" "$pw" "$ps" "$pe" "$pn"; ins+=("$WORK/terrain/${tag}_z${z}.mbtiles"); done
  done <<< "$BOXES"
  merge_mbtiles "$WORK/core.mbtiles" "gebco_2025_core" 0 $CORE_ZMAX "-180,-85.0511,180,85.0511" "${ins[@]}"
  # z0-5: far's tiles over each box (TMS rows: row = 2^z - 1 - y)
  while read -r tag w s e n; do
    read -r pw ps pe pn < <(padded "$w" "$s" "$e" "$n")
    for z in $(seq 0 $FAR_ZMAX); do
      read -r x0 y0 x1 y1 < <(tile_range "$pw" "$ps" "$pe" "$pn" "$z")
      sqlite3 "$WORK/core.mbtiles" "ATTACH '$WORK/far.mbtiles' AS f; INSERT OR IGNORE INTO tiles SELECT * FROM f.tiles
        WHERE zoom_level = $z AND tile_column BETWEEN $x0 AND $x1 AND tile_row BETWEEN $(( (1 << z) - 1 - y1 )) AND $(( (1 << z) - 1 - y0 )); DETACH f;"
    done
  done <<< "$BOXES"
  to_pmtiles "$WORK/core.mbtiles" "$OUT/gebco/core.pmtiles"
}

# the padded boxes as polygons (the contour and land clip, and the far contours' hole)
boxes_geojson() {
  local f="$WORK/boxes.geojson" sep=""
  { printf '{"type":"FeatureCollection","features":['
    while read -r tag w s e n; do
      read -r pw ps pe pn < <(padded "$w" "$s" "$e" "$n")
      printf '%s{"type":"Feature","properties":{"tag":"%s"},"geometry":{"type":"Polygon","coordinates":[[[%s,%s],[%s,%s],[%s,%s],[%s,%s],[%s,%s]]]}}' \
        "$sep" "$tag" "$pw" "$ps" "$pe" "$ps" "$pe" "$pn" "$pw" "$pn" "$pw" "$ps"
      sep=","
    done <<< "$BOXES"
    printf ']}\n'; } > "$f"
  echo "$f"
}

# ---- contours ----
# ele (m, positive down) and level (0 = 50 m, 1 = 100-750, 2 = 500-multiples, 3 = 1000-multiples), as doubles
LEVEL_SQL="CAST(-ELEV AS REAL) AS ele, CAST(CASE WHEN CAST(-ELEV AS INTEGER) % 1000 = 0 THEN 3 WHEN CAST(-ELEV AS INTEGER) % 500 = 0 THEN 2 WHEN -ELEV >= 100 THEN 1 ELSE 0 END AS REAL) AS level"
contours() {
  local boxes; boxes=$(boxes_geojson)
  local all="$WORK/contours_all.gpkg"
  rm -f "$all" "$WORK"/contours_*.gpkg
  # far: a ~4.6 km grid (1/10 the cells), the boxes blanked so their full-resolution lines are not drawn twice
  log "contours: far grid"
  gdalwarp -q -overwrite -tr 0.041666666667 0.041666666667 -r average -ot Int16 -dstnodata -32768 -co TILED=YES -co COMPRESS=DEFLATE "$ELEV" "$WORK/elev_far.tif"
  gdal_rasterize -q -burn -32768 "$boxes" "$WORK/elev_far.tif"
  local far_levels="" core_levels=""
  # elevations are negative: the fixed levels go from the deepest up (gdal_contour wants them increasing)
  for l in $LEVELS; do core_levels="-$l $core_levels"; (( l % 500 == 0 )) && far_levels="-$l $far_levels"; done
  # shellcheck disable=SC2086
  gdal_contour -q -a ELEV -snodata -32768 -fl $far_levels "$WORK/elev_far.tif" "$WORK/contours_far.gpkg"
  ogr2ogr -f GPKG "$all" "$WORK/contours_far.gpkg" -dialect SQLITE -nln contours -sql "SELECT geom, $LEVEL_SQL FROM contour"
  # core: every level at full resolution inside each box
  while read -r tag w s e n; do
    read -r pw ps pe pn < <(padded "$w" "$s" "$e" "$n")
    log "contours: $tag"
    gdal_translate -q -projwin "$pw" "$pn" "$pe" "$ps" -co TILED=YES "$ELEV" "$WORK/elev_$tag.tif"
    # shellcheck disable=SC2086
    gdal_contour -q -a ELEV -snodata -32768 -fl $core_levels "$WORK/elev_$tag.tif" "$WORK/contours_$tag.gpkg"
    ogr2ogr -f GPKG -append "$all" "$WORK/contours_$tag.gpkg" -dialect SQLITE -nln contours -sql "SELECT geom, $LEVEL_SQL FROM contour"
    rm -f "$WORK/elev_$tag.tif"
  done <<< "$BOXES"
  # one OGR layer per level, written into the one MVT layer `contours` from its own zoom (the style's CONTOUR_LEVELS)
  local split="$WORK/contours_split.gpkg"
  rm -f "$split"
  for lv in 3 2 1 0; do
    local upd=(); [[ -f "$split" ]] && upd=(-update)
    ogr2ogr -f GPKG "${upd[@]+"${upd[@]}"}" "$split" "$all" -nln "c$lv" -sql "SELECT * FROM contours WHERE level = $lv"
  done
  cat > "$WORK/contours_conf.json" <<'EOF'
{ "c3": { "target_name": "contours", "minzoom": 0, "maxzoom": 10 },
  "c2": { "target_name": "contours", "minzoom": 5, "maxzoom": 10 },
  "c1": { "target_name": "contours", "minzoom": 7, "maxzoom": 10 },
  "c0": { "target_name": "contours", "minzoom": 9, "maxzoom": 10 } }
EOF
  rm -f "$WORK/contours.mbtiles"
  ogr2ogr -f MVT "$WORK/contours.mbtiles" "$split" -dsco FORMAT=MBTILES -dsco MINZOOM=0 -dsco MAXZOOM=10 \
    -dsco CONF="$WORK/contours_conf.json" -dsco NAME="GEBCO 2025 isobaths" -dsco DESCRIPTION="$CITATION"
  rm -f "$OUT/gebco/contours.pmtiles"
  pmtiles convert "$WORK/contours.mbtiles" "$OUT/gebco/contours.pmtiles"
  pmtiles verify "$OUT/gebco/contours.pmtiles"
}

# ---- land: the OSM coastline CARTO's water derives from, clipped to the boxes (outside them CARTO's background is land) ----
land() {
  local boxes; boxes=$(boxes_geojson)
  local zip="$WORK/land-polygons-split-4326.zip"
  [[ -f "$zip" ]] || curl -sSfL -o "$zip" "$OSM_ZIP_URL"
  rm -f "$WORK/land.gpkg" "$WORK/land.mbtiles"
  ogr2ogr -f GPKG "$WORK/land.gpkg" "/vsizip/$zip/land-polygons-split-4326/land_polygons.shp" -clipsrc "$boxes" -nln land -nlt PROMOTE_TO_MULTI
  ogr2ogr -f MVT "$WORK/land.mbtiles" "$WORK/land.gpkg" -dsco FORMAT=MBTILES -dsco MINZOOM=0 -dsco MAXZOOM=12 \
    -dsco NAME="OpenStreetMap land polygons" -dsco DESCRIPTION="© OpenStreetMap contributors (ODbL); land polygons by osmdata.openstreetmap.de"
  rm -f "$OUT/osm/land.pmtiles"
  pmtiles convert "$WORK/land.mbtiles" "$OUT/osm/land.pmtiles"
  pmtiles verify "$OUT/osm/land.pmtiles"
}

# ---- verify: every archive verifies and holds the tile count its grid implies ----
verify() {
  local want=0
  for z in $(seq 0 $FAR_ZMAX); do want=$(( want + (1 << z) * (1 << z) )); done
  local got; got=$(pmtiles show "$OUT/gebco/far.pmtiles" | awk -F: '/addressed tiles count/ { gsub(/[ ,]/, "", $2); print $2 }')
  [[ "$got" == "$want" ]] || { log "verify: far.pmtiles addresses $got tiles, $want expected"; exit 1; }
  for f in "$OUT"/gebco/*.pmtiles "$OUT"/osm/*.pmtiles; do [[ -f "$f" ]] && pmtiles verify "$f"; done
  log "verify: far $got tiles; every archive verifies"
}

upload() {
  : "${S3_DEST:?upload needs S3_DEST, e.g. s3://oceanmetrics-storage/basemap}"
  local ep=(); [[ -n "${S3_ENDPOINT:-}" ]] && ep=(--endpoint-url "$S3_ENDPOINT")
  for f in "$OUT"/gebco/*.pmtiles "$OUT"/osm/*.pmtiles; do
    aws s3 cp "${ep[@]+"${ep[@]}"}" "$f" "$S3_DEST/${f#"$OUT"/}" --content-type application/octet-stream
  done
}

has prep && prep
has far && far
has core && core
has contours && contours
has land && land
has verify && verify
has upload && upload
log "done: $STEPS"
