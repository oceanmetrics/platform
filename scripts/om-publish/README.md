# om-publish.sh

The one publisher of the Ocean Metrics public bucket (build week 6, step 0). `scripts/om-publish.sh` uploads a local
folder (or one file) to a prefix of **both** stores, R2 `oceanmetrics-io-public-enam` (the US bucket since 2026-10-23) first, then S3
`oceanmetrics.io-public`, so the freeze is one setting (`OM_STORE=r2` on the mini, or `--only-r2`) and not twenty edits.
It never deletes: no `--delete`, rclone `copy` and never `sync`. The repo holds no secret: R2 goes through the rclone
wrapper `~/.config/oceanmetrics/rclone-r2.sh` (which sources `r2.env`), S3 through the host's AWS profile.

```sh
scripts/om-publish.sh [options] <local dir|file> <prefix>
scripts/om-publish.sh rewrite --from <host> --to <host> [options] <key.json|prefix>...
```

| option | what it does |
|---|---|
| `--dry-run` | the default: `rclone copy --dry-run` and `aws s3 sync --dryrun` (read-only listings) |
| `--really` | upload |
| `--only-r2`, `--only-s3` | one store; default `$OM_STORE` (`both`, `r2`, `s3`), else `both` |
| `--keep-history` | before overwriting on R2, a server-side copy of each object that will change to `<top>/_history/<YYYY-MM-DD>/<rest of key>` (R2 has no versioning; the first copy of a day is kept, `--ignore-existing`) |
| `--as <name>` | a single file's published name |
| `--include <glob>`, `--exclude <glob>` | choose files; bash globs over the path relative to `<local>`, `*` crosses `/`; `.DS_Store` is always left out |
| `--last <glob>` | upload the matching files after all others, in the order given (a file takes the first `--last` it matches) |
| `--type <ext>=<type>` | the content type of an extension, over the table |
| `--cache-control <v>`, `--content-encoding <v>` | headers of every file uploaded |
| `--size-only` | compare by size (default: rclone `--checksum`, the listing's MD5; aws its size and time) |

Content types by extension: `json` application/json, `geojson` application/geo+json, `parquet`
application/vnd.apache.parquet, `pmtiles` application/vnd.pmtiles, `tif`/`tiff` image/tiff, `atom`
application/atom+xml, `xml` application/xml, `md` text/markdown, `csv` text/csv, `html` text/html, `txt` text/plain
(those four with charset=utf-8), `png`, `jpg`, `svg`, `nc`, `zip`, `gz`; any other is left to the tool. Each
(phase, type) group is staged as a folder of symlinks and uploaded by one `rclone copy --copy-links` and one
`aws s3 sync`, so both stores get the same files with the same headers.

Environment: `OM_STORE`, `OM_S3_BUCKET`, `OM_R2_BUCKET`, `OM_RCLONE` (the wrapper; a missing one stops with its name),
`OM_AWS`, `OM_CATALOG_CLI` (`packages/catalog/dist/cli.js`), `OM_HISTORY_DATE`. Exit 0 ok, 1 a tool failed, 2 usage.

**Before the cutover, R2 is still the hourly mirror of S3.** `~/.config/oceanmetrics/r2sync.sh` runs `rclone sync`
per prefix, which deletes on R2 what S3 lacks: it would delete every `_history/` copy at its next run. Until the mirror
becomes the nightly `rclone check` (week 6 step 1), it needs `--filter '- _history/**'`, or `--keep-history` waits.

## rewrite: the cutover's href rewrite

```sh
scripts/om-publish.sh rewrite --from S3_PATH_STYLE --to STORAGE_HOST indicators/indicators.json obis-h3/collection.json atlas
```

Each target is a key ending in `.json` or a prefix (every `*.json` under it, `_history/` left out; `--depth N`
limits). It reads from S3 (R2 with `--only-r2` or `OM_STORE=r2`) through the wrapper, unzips a gzip-encoded JSON to
count it, and prints the urls `rewriteStorageUrls` (`@oceanmetrics/catalog/storage`, through `om-catalog
rewrite-storage`) would move in each file and a total. With `--really` it uploads only the changed files back to the
stores, each with its own Content-Type, Cache-Control and Content-Encoding (read with `rclone lsjson -M`; a gzip file
zipped again), and keeps the R2 history. Hosts: `S3_PATH_STYLE`, `S3_VIRTUAL_HOST`, `STORAGE_HOST`, `WORKER_PREVIEW`,
`s3`, `s3-virtual`, `storage`, `preview` or a url; `--from` takes a comma-separated list. The rollback is the same
command with `--from STORAGE_HOST --to S3_PATH_STYLE`.

The dry run of 2026-10-23 (S3, read-only):

| file | path-style S3 urls | storage urls (already) |
|---|---:|---:|
| `indicators/indicators.json` | 92 | 20 |
| `obis-h3/collection.json` | 45 | 0 |
| `obis-h3/latest.json` | 1 | 0 |
| `gazetteer/index/layers.json` | 1 | 165 |
| `atlas/aquamaps_native/provenance.json` | 5 | 0 |
| `atlas/aquamaps_eov/collection.json` | 1 | 0 |
| `atlas/catalog.json`, the other 47 atlas JSON (collections, Items, `registry_index.json` gzip) | 0 | 0 |
| `indicators/feeds/index.json` | 0 | 326 |

144 path-style urls in 5 of the 53 JSON objects asked for (`indicators/indicators.json`, `obis-h3/collection.json`,
`atlas/` whole, `gazetteer/index/layers.json`), plus `obis-h3/latest.json`; no virtual-hosted url anywhere. The 10
`file.marinesensitivity.org/stac/` children of `atlas/catalog.json` are not a storage host: they move with week 6
step 6. MST's release tables (`model_asset.parquet` and its siblings) are Parquet, not rewritten (decision D7: the
apps rebase them with `rewriteStorageUrls` at read).

## Tests

`scripts/om-publish.test.ts` (in `npm test`) runs the script against a fake `aws` and a fake `rclone` on `PATH`
(`fake/`): each call is a JSON line with the files of the folder it was given, and the fake rclone serves a bucket from
a folder. It asserts the dry-run default, R2 before S3, no `--delete` and no `rclone sync`, the content types, the
headers, `--last`, the filters, `--as`, the stores, the history copy and its key, the missing wrapper, the refused
prefixes, and `rewrite` (the counts, a gzip JSON, `--depth`, and `--really` uploading only the changed files with their
own headers).

## Migration: the publish scripts it replaces

None is changed yet: each moves in its own repo after the cutover (week 6 step 2), when the writers go to both
stores. `$P` is `../platform/scripts/om-publish.sh` (or a `OM_PUBLISH` variable). Every replacement keeps the
script's order (manifest last) through `--last` or the order of its lines.

| script | what it uploads today | the replacement |
|---|---|---|
| places `scripts/publish_collections.sh` (step 7) | `aws s3 sync catalog/pub/<slug>/ gazetteer/<slug>/ --exclude '.portolan/*'` per slug, then the merged live root `versions.json` and `catalog.json` (`application/json`) | `$P --really --exclude '.portolan/*' --last collection.json "$dir_pub/$s" "gazetteer/$s"`; the roots `$P --really --keep-history "$root_v" gazetteer --as versions.json` and the same with `catalog.json` |
| places `.github/workflows/sync.yml` (index step) | `gazetteer/index/` sync, `layers.json` to `gazetteer/index/` and `gazetteer/` | `$P --really --exclude '.portolan/*' --last layers.json --keep-history "$RUNNER_TEMP/index" gazetteer/index`; `$P --really --keep-history "$lj" gazetteer/index --as layers.json`; `$P --really "$lj" gazetteer --as layers.json` |
| places `scripts/build_h3_membership.py --upload` | `<out>/<slug>/h3/` to `gazetteer/<slug>/h3/` (membership.json last), the layer's `membership` JSON | `subprocess.run([P, "--really", "--last", "membership.json", d, f"gazetteer/{slug}/h3"])` |
| places `scripts/build_browse_pages.py` (by hand) | every `*index.html` to the bucket root, `no-cache` | per prefix: `$P --really --include '*index.html' --cache-control no-cache OUT/<prefix> <prefix>` (the root `index.html` stays a by-hand `rclone copyto`: om-publish refuses the root) |
| atlas `pipeline/publish.sh` (default) | `atlas/biotrack_indicators/`, `atlas/aquamaps_native/` (`registry_index.json` gzip -9, `Content-Encoding: gzip`), `atlas/catalog.json` `no-cache`, `atlas-restricted/<ULID>/biotrack_species/` | `$P --really "$stage/biotrack_indicators" atlas/biotrack_indicators`; `$P --really --exclude registry_index.json "$stage/aquamaps_native" atlas/aquamaps_native`; `$P --really --content-encoding gzip "$tmp/registry_index.json" atlas/aquamaps_native`; `$P --really --keep-history --cache-control no-cache "$stage/catalog.json" atlas`; `$P --really "$stage/biotrack_species" "atlas-restricted/$prefix/biotrack_species"` |
| atlas `pipeline/publish.sh --only aquamaps_eov` | score COGs, then `_3857` copies, Items, `collection.json` last, `--size-only` | `$P --really --size-only --exclude '*.orig.tif' --include 'score_*' --include 'items/*' --include collection.json --last 'score_*_3857.tif' --last 'items/*' --last collection.json "$stage/aquamaps_eov" atlas/aquamaps_eov` |
| atlas `pipeline/publish.sh --only <restricted>` | one collection to `atlas-restricted/<ULID>/<name>/`, `collection.json` `no-cache` last | the ULID guard stays in the script; then `$P --really --exclude collection.json "$src" "$dest"` and `$P --really --cache-control no-cache "$src/collection.json" "$dest"` |
| atlas `pipeline/scripts/hex_centroids.py` (docstring) | `hex_centroids.parquet` to `atlas/biotrack_indicators/` | `$P --really <out> atlas/biotrack_indicators --as hex_centroids.parquet` |
| indicators `scripts/publish_catalog.sh` + `publish_changes.sh` | `values/` (`--delete`), `sanctuarywatch/`, `README.md`, `coverage.parquet`, the change files and feeds, `changes/latest.json`, `indicators.json` last; `public, max-age=300` | `$P --really --keep-history --cache-control "public, max-age=300" --type 'xml=application/atom+xml; charset=utf-8' --last coverage.parquet --last 'changes/*.parquet' --last 'changes/[0-9]*.json' --last 'feeds/*.xml' --last feeds/index.json --last changes/latest.json --last indicators.json "$OUT" indicators`; `$P --really --cache-control "public, max-age=300" scripts/bucket_README.md indicators --as README.md` (the validate steps stay) |
| indicators `om_indicators/publish.py`, the `cmems_place` producer | no upload: `PUBLIC_BASE`, the href root written into `indicators.json` (the 92) | `PUBLIC_BASE = storage_url("indicators/", host=storage_host_from_env())` (`om_extract.storage`) |
| erddap-places `precompute/src/publish.ts` | one `aws s3 cp` per file as it is computed (`PRECOMPUTE_PUBLISH`), content types by extension | `exec(P, ['--really', file, dirname(prefix + '/' + key)])` (one call per file, the order kept by the chain) |
| erddap-places `.github/workflows/stats.yml` (final sync) | `gazetteer/<collection>/` per owned dir with `--delete --exclude '.portolan/*' --exclude 'h3/*'`, then `gazetteer/stats/` | `$P --really --exclude '.portolan/*' --exclude 'h3/*' "$d" "gazetteer/$name"`; `$P --really --exclude '.portolan/*' catalog/gazetteer/stats gazetteer/stats` |
| erddap-places `catalog/publish_places.sh` | the merged root `gazetteer/catalog.json` and `versions.json` | `$P --really --keep-history "$pub_cat" gazetteer --as catalog.json`; the same with `versions.json` |
| erddap-places `.github/workflows/obis-h3.yml` | nothing itself: runs obisindicators' `refresh_obis_h3.sh` in Docker | the wrapper (`run_refresh_docker.sh`) runs the upload on the host, after the container, so the rclone wrapper and `r2.env` never enter the image |
| marinebon/obisindicators `data-raw/refresh_obis_h3.sh` (read-only here) | step f `aws s3 sync "$OUT/" obis-h3/<release>/`; g `latest.json`, g2 `collection.json` (`max-age=300`) | `$P --really "$OUT" "obis-h3/$RELEASE"`; `$P --really --keep-history --cache-control max-age=300 "$latest" obis-h3 --as latest.json`; the same for `collection.json` |
| marinebon/obisindicators `data-raw/deploy_obis_h3.sh` | no write to our bucket (reads `obis-open-data`, swaps the h3t store) | none; it retires with h3t (step 6). The repo has no `publish.sh` |
| workflows `aquamaps_eov.qmd` (upload chunk) | `aws s3 sync dir_out atlas/aquamaps_eov/ --delete`, then a read-back check | `system2(P, c("--really", "--keep-history", "--last", "collection.json", dir_out, "atlas/aquamaps_eov"))` |
| workflows `R/eov_share.R` | no upload: `base_url` path-style S3, written into the EOV Items | `base_url = "https://storage.oceanmetrics.io/atlas/aquamaps_eov"` at the cutover (R has no twin; one constant) |
| platform `scripts/basemap/build_gebco.sh` (step upload) | `aws s3 cp` per `.pmtiles` to `$S3_DEST` (an `S3_ENDPOINT` for R2) | `$P --really --include '*.pmtiles' "$OUT" basemap` |
| `~/.config/oceanmetrics/r2sync.sh` (launchd, in no repo) | `rclone sync s3: r2:` per prefix every 6 hours | not replaced: it becomes the nightly `rclone check --one-way --checksum` (week 6 step 1); meanwhile `--filter '- _history/**'` |
| MarineSensitivity/workflows `stage_publish.qmd` and nine more | `marine-atlas/` (44 of the 72 GB) | MST's repo, with Ben's approval |

**What changes in behaviour.** Three writers sync with `--delete` today: indicators `values/`, the erddap-places
collection dirs and the EOV product. om-publish never deletes, so a values file or an Item a build no longer writes
stays on both stores. A stale file is not linked by the new manifest, so readers never see it; a prune, when one is
wanted, is a separate, reviewed `rclone delete --dry-run` per prefix.
