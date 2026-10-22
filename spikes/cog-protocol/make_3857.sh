#!/usr/bin/env bash
# fetch the three spike COGs (EPSG:4326, as published) and write web-optimised EPSG:3857 copies,
# the shape @geomatico/maplibre-cog-protocol reads: GoogleMapsCompatible tiling, 256 px blocks,
# nearest resampling for the warp and the overviews (the values are classes / integer scores),
# ZOOM_LEVEL_STRATEGY=UPPER so the copy never drops below the source resolution, nodata carried
# over, no alpha band. usage: ./make_3857.sh <data_dir>
set -euo pipefail
DIR=${1:?data dir}
mkdir -p "$DIR/3857"
S3=https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public
for p in atlas/aquamaps_eov/score_risk.tif marine-atlas/native/am/729c63f1d05d0515.tif marine-atlas/cog/usa05/9fe6f75498affae1.tif; do
  f=$(basename "$p")
  [ -f "$DIR/$f" ] || curl -sS -o "$DIR/$f" "$S3/$p"
  # a source reaching past the mercator latitude limit is clipped to it, so the warp does not ask
  # PROJ for |lat| > 85.0511 (score_risk.tif spans -90 to 90); others keep their own extent
  TE=()
  if gdalinfo -json "$DIR/$f" | python3 -c 'import json,sys; c=json.load(sys.stdin)["cornerCoordinates"]; sys.exit(0 if max(abs(c["upperLeft"][1]), abs(c["lowerLeft"][1])) > 85.0511 else 1)'; then
    TE=(-te_srs EPSG:4326 -te -180 -85.0511287798 180 85.0511287798)
  fi
  /usr/bin/time -p gdalwarp -q -overwrite -t_srs EPSG:3857 ${TE[@]+"${TE[@]}"} -r near \
    -of COG -co TILING_SCHEME=GoogleMapsCompatible -co ZOOM_LEVEL_STRATEGY=UPPER \
    -co BLOCKSIZE=256 -co COMPRESS=DEFLATE -co ADD_ALPHA=NO \
    -co OVERVIEW_RESAMPLING=NEAREST -co OVERVIEWS=IGNORE_EXISTING -co SPARSE_OK=YES \
    "$DIR/$f" "$DIR/3857/$f" 2>&1 | grep real | sed "s|^|$f warp |"
  ls -l "$DIR/$f" "$DIR/3857/$f" | awk '{print $5, $9}'
done
