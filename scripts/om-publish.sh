#!/usr/bin/env bash
# om-publish.sh: the one publisher of the Ocean Metrics public bucket (build week 6, step 0). it uploads a local folder
# (or one file) to a prefix of BOTH stores, S3 `oceanmetrics.io-public` and R2 `oceanmetrics-io-public-enam` (R2 first, then
# S3), so the freeze is one setting (`OM_STORE=r2` or `--only-r2`) and not twenty edits. it never deletes: no
# `--delete`, rclone `copy` and never `sync`. the per-repo publish scripts it replaces, and the one-line replacement of
# each, are in scripts/om-publish/README.md. public, no secret: the R2 keys come from the rclone wrapper's env file
# (~/.config/oceanmetrics/rclone-r2.sh sources r2.env), the AWS keys from the host's profile.
#
# usage:
#   om-publish.sh [options] <local dir|file> <prefix>
#   om-publish.sh rewrite --from <host> --to <host> [options] <key.json|prefix>...
#
# upload options:
#   --dry-run            the default: both tools run in their dry-run modes (read-only listings), nothing is written
#   --really             upload
#   --only-r2            R2 only (after the freeze); --only-s3 for S3 only. default: $OM_STORE (both|r2|s3), else both
#   --keep-history       before overwriting on R2, server-side copy each object that will change to
#                        <top>/_history/<YYYY-MM-DD>/<rest of key> (R2 has no versioning; the first copy of a day is kept)
#   --as <name>          a single file is published under this name (default: its own)
#   --include <glob>     only files whose path (relative to <local>) matches; repeatable. globs are bash patterns over
#                        the whole relative path, `*` crosses `/` (`*.json` is every JSON at any depth)
#   --exclude <glob>     leave out matching files; repeatable (.DS_Store is always left out)
#   --last <glob>        upload the matching files after all others, in the order the options are given; repeatable
#                        (the manifest last: a reader never follows a link to a file that is not there yet)
#   --type <ext>=<type>  the content type of an extension (overrides the table below), e.g. --type 'xml=application/atom+xml'
#   --cache-control <v>  Cache-Control of every file uploaded (e.g. 'no-cache', 'public, max-age=300')
#   --content-encoding <v>  Content-Encoding of every file (e.g. gzip, for a file the caller gzipped)
#   --size-only          compare by size only (default: rclone --checksum, the listing's MD5; aws its size and time)
#
# rewrite (the cutover's rewrite of published hrefs, @oceanmetrics/catalog/storage rewriteStorageUrls through
# `om-catalog rewrite-storage`): each target is a key ending in .json or a prefix (every *.json under it, --depth N to
# limit). read from S3 (from R2 with --only-r2 or OM_STORE=r2); prints the urls each file would change and a total.
# with --really the changed files are uploaded back to the stores with their Content-Type, Cache-Control and
# Content-Encoding (a gzip-encoded JSON is unzipped to count and zipped again to upload), and --keep-history is on.
# hosts: S3_PATH_STYLE, S3_VIRTUAL_HOST, STORAGE_HOST, WORKER_PREVIEW, s3, s3-virtual, storage, preview or a url;
# --from takes a comma-separated list.
#
# environment: OM_STORE (both|r2|s3), OM_S3_BUCKET (oceanmetrics.io-public), OM_R2_BUCKET (oceanmetrics-io-public-enam, the US bucket since 2026-10-23),
# OM_RCLONE (~/.config/oceanmetrics/rclone-r2.sh: rclone with the remotes s3: and r2:), OM_AWS (aws),
# OM_CATALOG_CLI (packages/catalog/dist/cli.js), OM_HISTORY_DATE (the history folder's date, default today UTC).
#
# exit: 0 ok, 1 a tool failed, 2 usage or a missing file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
S3_BUCKET="${OM_S3_BUCKET:-oceanmetrics.io-public}"
R2_BUCKET="${OM_R2_BUCKET:-oceanmetrics-io-public-enam}"   # US (ENAM), Ben 2026-10-23; the EEUR oceanmetrics-io-public is no longer written (kept until Ben deletes it)
RCLONE="${OM_RCLONE:-$HOME/.config/oceanmetrics/rclone-r2.sh}"
AWS="${OM_AWS:-aws}"
CLI="${OM_CATALOG_CLI:-$ROOT/packages/catalog/dist/cli.js}"
HDATE="${OM_HISTORY_DATE:-$(date -u +%F)}"

TAB=$'\t'
die() { echo "om-publish: $*" >&2; exit 2; }
usage() { sed -n '9,11p' "$0" | sed 's/^# \{0,3\}//' >&2; exit 2; }

# ---- the content types by extension ----
TYPES_OVERRIDE=""   # lines "ext<TAB>type", from --type
type_for() {
  local ext; ext="$(printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]')"
  [ "$ext" = "$1" ] && ext=""
  local o; o="$(printf '%s' "$TYPES_OVERRIDE" | awk -F'\t' -v e="$ext" '$1 == e { t = $2 } END { print t }')"
  if [ -n "$o" ]; then printf '%s' "$o"; return; fi
  case "$ext" in
    json) printf 'application/json' ;;
    geojson) printf 'application/geo+json' ;;
    parquet) printf 'application/vnd.apache.parquet' ;;
    pmtiles) printf 'application/vnd.pmtiles' ;;
    tif|tiff) printf 'image/tiff' ;;
    atom) printf 'application/atom+xml; charset=utf-8' ;;
    xml) printf 'application/xml' ;;
    md) printf 'text/markdown; charset=utf-8' ;;
    csv) printf 'text/csv; charset=utf-8' ;;
    html) printf 'text/html; charset=utf-8' ;;
    txt) printf 'text/plain; charset=utf-8' ;;
    png) printf 'image/png' ;;
    jpg|jpeg) printf 'image/jpeg' ;;
    svg) printf 'image/svg+xml' ;;
    nc) printf 'application/x-netcdf' ;;
    zip) printf 'application/zip' ;;
    gz) printf 'application/gzip' ;;
    *) printf '' ;;   # the tool guesses
  esac
}

# ---- options ----
REALLY=0
STORE="${OM_STORE:-both}"
HISTORY=0
AS=""
INCLUDES=()
EXCLUDES=()
LASTS=()
CACHE=""
ENCODING=""
SIZE_ONLY=0
FROM=""
TO=""
DEPTH=""
POS=()
MODE=publish
if [ "${1:-}" = "rewrite" ]; then MODE=rewrite; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --really) REALLY=1 ;;
    --dry-run) REALLY=0 ;;
    --only-r2) STORE=r2 ;;
    --only-s3) STORE=s3 ;;
    --keep-history) HISTORY=1 ;;
    --as) [ $# -ge 2 ] || die "--as needs a name"; AS="$2"; shift ;;
    --include) [ $# -ge 2 ] || die "--include needs a glob"; INCLUDES+=("$2"); shift ;;
    --exclude) [ $# -ge 2 ] || die "--exclude needs a glob"; EXCLUDES+=("$2"); shift ;;
    --last) [ $# -ge 2 ] || die "--last needs a glob"; LASTS+=("$2"); shift ;;
    --type) [ $# -ge 2 ] && [[ "$2" == *=* ]] || die "--type needs <ext>=<content type>"
            TYPES_OVERRIDE="$TYPES_OVERRIDE$(printf '%s\t%s' "$(printf '%s' "${2%%=*}" | tr '[:upper:]' '[:lower:]')" "${2#*=}")"$'\n'; shift ;;
    --cache-control) [ $# -ge 2 ] || die "--cache-control needs a value"; CACHE="$2"; shift ;;
    --content-encoding) [ $# -ge 2 ] || die "--content-encoding needs a value"; ENCODING="$2"; shift ;;
    --size-only) SIZE_ONLY=1 ;;
    --from) [ $# -ge 2 ] || die "--from needs a host"; FROM="$2"; shift ;;
    --to) [ $# -ge 2 ] || die "--to needs a host"; TO="$2"; shift ;;
    --depth) [ $# -ge 2 ] || die "--depth needs a number"; DEPTH="$2"; shift ;;
    --delete|--delete-*) die "$1: om-publish never deletes" ;;
    -h|--help) usage ;;
    --*) die "unknown option: $1" ;;
    *) POS+=("$1") ;;
  esac
  shift
done
case "$STORE" in both|r2|s3) ;; *) die "OM_STORE must be both, r2 or s3 (got $STORE)" ;; esac
STORES="r2 s3"; [ "$STORE" = r2 ] && STORES="r2"; [ "$STORE" = s3 ] && STORES="s3"
[ "$STORE" = s3 ] || [ -x "$RCLONE" ] || [ -n "$(command -v "$RCLONE" 2>/dev/null)" ] || die "the rclone wrapper $RCLONE is missing (OM_RCLONE)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/om-publish.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# a prefix: no leading or trailing slash, not empty, no `..`, never inside _history/
clean_prefix() {
  local p="$1"; p="${p#/}"; p="${p%/}"
  [ -n "$p" ] || die "a prefix is required (the bucket root is not published here)"
  case "/$p/" in */../*|*/./*) die "prefix $1: no . or .. segments" ;; */_history/*) die "prefix $1: _history/ is written only by --keep-history" ;; esac
  printf '%s' "$p"
}

# the history key base of a prefix: <top>/_history/<date>[/<rest>]
history_base() {
  local top="${1%%/*}" rest=""
  [ "$top" != "$1" ] && rest="/${1#*/}"
  printf '%s/_history/%s%s' "$top" "$HDATE" "$rest"
}

# ---- one group of files (a staged folder of symlinks) to one store ----
# upload_group <store> <stage dir> <prefix> <content type> <cache control> <content encoding>
upload_group() {
  local store="$1" stage="$2" prefix="$3" ctype="$4" cache="$5" enc="$6" n
  n="$(find -L "$stage" -type f | wc -l | tr -d ' ')"
  [ "$n" -gt 0 ] || return 0
  local dry=""; [ "$REALLY" = 1 ] || dry=1
  if [ "$store" = r2 ]; then
    local args=(copy "$stage" "r2:$R2_BUCKET/$prefix" --copy-links --stats-one-line --stats 0)
    if [ "$SIZE_ONLY" = 1 ]; then args+=(--size-only); else args+=(--checksum); fi
    [ -n "$ctype" ] && args+=(--header-upload "Content-Type: $ctype")
    [ -n "$cache" ] && args+=(--header-upload "Cache-Control: $cache")
    [ -n "$enc" ] && args+=(--header-upload "Content-Encoding: $enc")
    [ -n "$dry" ] && args+=(--dry-run)
    echo "r2  ${ctype:-(guessed)}  $n files -> r2:$R2_BUCKET/$prefix/${dry:+  (dry run)}"
    "$RCLONE" "${args[@]}"
  else
    local args=(s3 sync "$stage" "s3://$S3_BUCKET/$prefix" --no-progress)
    [ "$SIZE_ONLY" = 1 ] && args+=(--size-only)
    [ -n "$ctype" ] && args+=(--content-type "$ctype")
    [ -n "$cache" ] && args+=(--cache-control "$cache")
    [ -n "$enc" ] && args+=(--content-encoding "$enc")
    [ -n "$dry" ] && args+=(--dryrun)
    echo "s3  ${ctype:-(guessed)}  $n files -> s3://$S3_BUCKET/$prefix/${dry:+  (dry run)}"
    "$AWS" "${args[@]}"
  fi
}

# stage <dir> <list file of relative paths> <source root>: a folder of symlinks mirroring the paths
stage() {
  local dir="$1" list="$2" src="$3" rel
  mkdir -p "$dir"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    mkdir -p "$dir/$(dirname "$rel")"
    ln -s "$src/${rel%%"$TAB"*}" "$dir/${rel#*"$TAB"}"
  done < "$list"
}

# keep_history <prefix> <stage dir>: on R2, copy the objects the stage would overwrite with other bytes to _history/
keep_history() {
  local prefix="$1" stagedir="$2" differ="$TMP/differ.$RANDOM" hb n
  : > "$differ"
  "$RCLONE" check "$stagedir" "r2:$R2_BUCKET/$prefix" --one-way --copy-links --differ "$differ" >/dev/null 2>&1 || true
  n="$(grep -c . "$differ" || true)"
  hb="$(history_base "$prefix")"
  if [ "$n" -eq 0 ]; then echo "r2  history: nothing overwritten"; return 0; fi
  echo "r2  history: $n overwritten -> r2:$R2_BUCKET/$hb/$( [ "$REALLY" = 1 ] || echo '  (dry run)')"
  sed 's/^/    /' "$differ"
  local args=(copy "r2:$R2_BUCKET/$prefix" "r2:$R2_BUCKET/$hb" --files-from-raw "$differ" --no-traverse --ignore-existing --stats-one-line --stats 0)
  [ "$REALLY" = 1 ] || args+=(--dry-run)
  "$RCLONE" "${args[@]}"
}

matches_any() {   # matches_any <path> <glob>...
  local p="$1" g; shift
  for g in "$@"; do
    # shellcheck disable=SC2053
    [[ "$p" == $g ]] && return 0
  done
  return 1
}

# ---- publish <local> <prefix> ----
publish() {
  local src="$1" prefix files="$TMP/files" kind
  prefix="$(clean_prefix "$2")"
  [ -e "$src" ] || die "$src does not exist"
  # the list: "<source path relative to root><TAB><published path>"
  local root
  if [ -d "$src" ]; then
    [ -z "$AS" ] || die "--as is for a single file"
    root="$(cd "$src" && pwd)"
    (cd "$root" && find -L . -type f | sed 's|^\./||' | LC_ALL=C sort) | while IFS= read -r rel; do
      case "$rel" in .DS_Store|*/.DS_Store) continue ;; esac
      if [ ${#INCLUDES[@]} -gt 0 ] && ! matches_any "$rel" "${INCLUDES[@]}"; then continue; fi
      if [ ${#EXCLUDES[@]} -gt 0 ] && matches_any "$rel" "${EXCLUDES[@]}"; then continue; fi
      printf '%s\t%s\n' "$rel" "$rel"
    done > "$files"
  else
    root="$(cd "$(dirname "$src")" && pwd)"
    printf '%s\t%s\n' "$(basename "$src")" "${AS:-$(basename "$src")}" > "$files"
  fi
  local total; total="$(grep -c . "$files" || true)"
  [ "$total" -gt 0 ] || die "no file to publish in $src"
  echo "om-publish: $total files from $src -> $prefix/ on $STORES$( [ "$REALLY" = 1 ] || echo ' (dry run; --really to upload)')"

  # the groups, in upload order: the files not matched by --last, by content type; then each --last glob, by type
  local groups="$TMP/groups" i=0 line rel pub t g
  : > "$groups"
  : > "$TMP/rest"
  while IFS= read -r line; do
    pub="${line#*"$TAB"}"
    g="first"
    if [ ${#LASTS[@]} -gt 0 ]; then
      i=0
      for l in "${LASTS[@]}"; do i=$((i + 1)); if [[ "$pub" == $l ]]; then g="last$(printf '%03d' "$i")"; break; fi; done
    fi
    t="$(type_for "$pub")"
    printf '%s\t%s\t%s\n' "$g" "$t" "$line" >> "$groups"
  done < "$files"
  # one stage folder per (phase, type)
  local keys; keys="$(cut -f1,2 "$groups" | LC_ALL=C sort -u)"
  local n=0 dirs="$TMP/dirs"
  : > "$dirs"
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    n=$((n + 1))
    awk -F'\t' -v k="$k" '($1 "\t" $2) == k { print $3 "\t" $4 }' "$groups" > "$TMP/g$n.list"
    stage "$TMP/g$n" "$TMP/g$n.list" "$root"
    printf '%s\t%s\n' "$TMP/g$n" "$(printf '%s' "$k" | cut -f2)" >> "$dirs"
  done <<< "$keys"
  # the whole set in one stage, for the history check
  if [ "$HISTORY" = 1 ]; then stage "$TMP/all" "$files" "$root"; fi

  local s d ct
  for s in $STORES; do
    if [ "$s" = r2 ] && [ "$HISTORY" = 1 ]; then keep_history "$prefix" "$TMP/all"; fi
    while IFS=$'\t' read -r d ct; do
      upload_group "$s" "$d" "$prefix" "$ct" "$CACHE" "$ENCODING"
    done < "$dirs"
  done
}

# ---- rewrite --from --to <targets> ----
rewrite() {
  [ -n "$FROM" ] && [ -n "$TO" ] || die "rewrite needs --from and --to"
  [ ${#POS[@]} -gt 0 ] || die "rewrite needs a key or a prefix"
  [ -f "$CLI" ] || die "$CLI not found (run npm run build in the platform checkout, or set OM_CATALOG_CLI)"
  local read_remote="s3:$S3_BUCKET" keys="$TMP/keys" t p
  [ "$STORE" = r2 ] && read_remote="r2:$R2_BUCKET"
  [ -x "$RCLONE" ] || [ -n "$(command -v "$RCLONE" 2>/dev/null)" ] || die "the rclone wrapper $RCLONE is missing (OM_RCLONE)"
  : > "$keys"
  for t in "${POS[@]}"; do
    case "$t" in
      *.json) p="$(clean_prefix "$t")"; printf '%s\n' "$p" >> "$keys" ;;
      *) p="$(clean_prefix "$t")"
         "$RCLONE" lsf -R --files-only --filter '- _history/**' --filter '+ *.json' --filter '- *' ${DEPTH:+--max-depth "$DEPTH"} "$read_remote/$p" \
           | sed "s|^|$p/|" >> "$keys" ;;
    esac
  done
  LC_ALL=C sort -u "$keys" -o "$keys"
  local nk; nk="$(grep -c . "$keys" || true)"
  [ "$nk" -gt 0 ] || die "no JSON object under ${POS[*]}"
  echo "om-publish rewrite: $nk JSON objects from $read_remote, $FROM -> $TO$( [ "$REALLY" = 1 ] || echo ' (dry run; --really to rewrite)')"
  mkdir -p "$TMP/src"
  "$RCLONE" copy "$read_remote" "$TMP/src" --files-from-raw "$keys" --no-traverse --stats 0 >/dev/null
  # a gzip-encoded JSON is counted unzipped (and zipped again for the upload)
  local k gz="$TMP/gz"
  : > "$gz"
  while IFS= read -r k; do
    [ -f "$TMP/src/$k" ] || die "$k was not read from $read_remote"
    if [ "$(head -c 2 "$TMP/src/$k" | od -An -tx1 | tr -d ' \n')" = "1f8b" ]; then
      gunzip -c "$TMP/src/$k" > "$TMP/src/$k.plain" && mv "$TMP/src/$k.plain" "$TMP/src/$k"
      printf '%s\n' "$k" >> "$gz"
    fi
  done < "$keys"
  local files=() out
  while IFS= read -r k; do files+=("$TMP/src/$k"); done < "$keys"
  local wflag=""; [ "$REALLY" = 1 ] && wflag="--write"
  out="$(node "$CLI" rewrite-storage --from "$FROM" --to "$TO" $wflag "${files[@]}")"
  printf '%s\n' "$out" | sed "s|$TMP/src/||"
  [ "$REALLY" = 1 ] || return 0

  # ---- --really: upload each changed file with its own headers, history kept on R2 ----
  printf '%s\n' "$out" | awk -F'\t' 'NF == 2 && $1 > 0 { print $2 }' | sed "s|^$TMP/src/||" > "$TMP/changed"
  [ -s "$TMP/changed" ] || { echo "nothing to rewrite"; return 0; }
  # -R --files-only: without -R rclone lists a --files-from list one level deep (a nested key comes back as its folder)
  "$RCLONE" lsjson -M -R --files-only --files-from-raw "$TMP/changed" --no-traverse "$read_remote" > "$TMP/meta.json"
  node -e '
    const meta = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const gz = new Set(require("fs").readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean))
    for (const o of meta) {
      const m = o.Metadata ?? {}
      const enc = m["content-encoding"] ?? (gz.has(o.Path) ? "gzip" : "")
      console.log([o.Path, m["content-type"] ?? o.MimeType ?? "application/json", m["cache-control"] ?? "", enc].join("\x1f"))
    }' "$TMP/meta.json" "$gz" > "$TMP/headers"
  [ "$(wc -l < "$TMP/headers" | tr -d ' ')" = "$(wc -l < "$TMP/changed" | tr -d ' ')" ] \
    || die "the stores' metadata lists $(wc -l < "$TMP/headers" | tr -d ' ') of $(wc -l < "$TMP/changed" | tr -d ' ') changed files; nothing uploaded"
  HISTORY=1
  local key ctype cache enc top n=0
  while IFS=$'\x1f' read -r key ctype cache enc; do
    n=$((n + 1))
    top="${key%%/*}"
    mkdir -p "$TMP/up$n/$(dirname "${key#*/}")"
    if [ "$enc" = gzip ]; then gzip -9 -n -c "$TMP/src/$key" > "$TMP/up$n/${key#*/}"; else cp "$TMP/src/$key" "$TMP/up$n/${key#*/}"; fi
    local s
    for s in $STORES; do
      if [ "$s" = r2 ]; then keep_history "$top" "$TMP/up$n"; fi
      upload_group "$s" "$TMP/up$n" "$top" "$ctype" "$cache" "$enc"
    done
  done < "$TMP/headers"
}

if [ "$MODE" = rewrite ]; then
  rewrite
else
  [ ${#POS[@]} -eq 2 ] || usage
  [ -z "$FROM$TO$DEPTH" ] || die "--from, --to and --depth are rewrite options"
  publish "${POS[0]}" "${POS[1]}"
fi
