#!/usr/bin/env bash
# storage-check.sh: the cutover-day check of the Ocean Metrics storage host (the om-gazetteer Worker, worker/ in
# oceanmetrics/places). it requests the paths every app depends on and prints a PASS/FAIL table; the exit code is 1 on any
# FAIL, 2 on a usage error. read-only: GET and OPTIONS only; redirects are never followed (a 301/302 is a finding).
#
# usage:
#   storage-check.sh <host> [--key <id>] [--compare <host2>] [--max-ms <n>]
#
#   <host>            https://storage.oceanmetrics.io or the preview https://om-gazetteer.ben-f07.workers.dev
#   --key <id>        also check the keyed tier (row 12): a ranged read with ?key=<id>, 206 and x-om-usage; the id is
#                     sent to the host but never printed
#   --compare <host2> run the same checks against a second host and print both columns (preview against live)
#   --max-ms <n>      the response-time limit of row 11, the median of 5 ranged GETs (default 1500)
#
# the rows are numbered as in the cutover plan: 1 layers.json, 2 a ranged parquet, 3 pmtiles, 4 indicators, 5 atlas,
# 6 obis-h3, 7 marine-atlas, 8 what must stay closed, 9 CORS preflight, 10 no redirect, 11 timing, 12 keyed tier.
# environment: CURL (curl), OM_CHECK_TIMEOUT (seconds per request, default 60).
# needs only bash 3.2, curl, awk, sed, grep, sort, tr.

CURL=${CURL:-curl}
TIMEOUT=${OM_CHECK_TIMEOUT:-60}
MAX_MS=1500
ORIGIN=https://oceanmetrics.io
KEY=""
COMPARE=""
HOST=""

die() { echo "storage-check.sh: $*" >&2; exit 2; }
usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --key)       [ $# -ge 2 ] || die "--key needs an id"; KEY=$2; shift 2 ;;
    --compare)   [ $# -ge 2 ] || die "--compare needs a host"; COMPARE=$2; shift 2 ;;
    --max-ms)    [ $# -ge 2 ] || die "--max-ms needs a number"; MAX_MS=$2; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    -*)          die "unknown option $1" ;;
    *)           [ -z "$HOST" ] || die "one host only (use --compare for a second)"; HOST=$1; shift ;;
  esac
done
[ -n "$HOST" ] || { usage; exit 2; }
case "$MAX_MS" in ''|*[!0-9]*) die "--max-ms must be a whole number" ;; esac
norm() { local h=${1%/}; case "$h" in http://*|https://*) echo "$h" ;; *) echo "https://$h" ;; esac; }
HOST=$(norm "$HOST")
[ -z "$COMPARE" ] || COMPARE=$(norm "$COMPARE")

TMP=$(mktemp -d "${TMPDIR:-/tmp}/storage-check.XXXXXX") || die "no temp dir"
trap 'rm -rf "$TMP"' EXIT

# ---- one request ----
# probe <method> <url> [range] [origin] [request-headers]: sets P_CODE (000 when no answer), P_MS, and $TMP/hdr
P_CODE=000; P_MS=0
probe() {
  local method=$1 url=$2 range=${3:-} origin=${4:-} acrh=${5:-}
  local args=(-sS -o /dev/null --max-time "$TIMEOUT" -D "$TMP/hdr" -w '%{http_code} %{time_total}')
  [ "$method" = GET ] || args=("${args[@]}" -X "$method")
  [ -z "$range" ]  || args=("${args[@]}" -H "Range: bytes=$range")
  [ -z "$origin" ] || args=("${args[@]}" -H "Origin: $origin")
  if [ -n "$acrh" ]; then args=("${args[@]}" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: $acrh"); fi
  : > "$TMP/hdr"
  local out t
  out=$("$CURL" "${args[@]}" "$url" 2>/dev/null </dev/null) || true
  P_CODE=${out%% *}
  case "$P_CODE" in [0-9][0-9][0-9]) ;; *) P_CODE=000 ;; esac
  case "$out" in *" "*) t=${out#* } ;; *) t=0 ;; esac
  P_MS=$(awk -v t="$t" 'BEGIN { printf "%d", t * 1000 + 0.5 }')
  echo "$P_CODE" >> "$TMP/st.$IDX"
}
# hdr <name>: the value of a header of the last response (case-insensitive, first one, trimmed)
hdr() { grep -i "^$1:" "$TMP/hdr" | head -1 | sed -e 's/^[^:]*:[ 	]*//' -e 's/[ 	]*$//' | tr -d '\r'; }
has_hdr() { grep -qi "^$1:" "$TMP/hdr"; }
lower() { echo "$1" | tr 'A-Z' 'a-z'; }

# record <id> <label> <PASS|FAIL|SKIP> <detail>
record() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$TMP/res.$IDX"; }

# ---- the single requests: id | label | path | range | want status (a|b) | content-type prefix or - | required headers | ORIGIN
ROWS='1|layers.json, keyless|gazetteer/index/layers.json||200|application/json|access-control-allow-origin|ORIGIN
2|parquet range 0-16383|gazetteer/index/places_index.parquet|0-16383|206|-|content-range,accept-ranges|ORIGIN
3|pmtiles range|basemap/gebco/far.pmtiles|0-16383|206|application/vnd.pmtiles|content-range|
4a|indicators.json|indicators/indicators.json||200|-||
4b|coverage.parquet range|indicators/coverage.parquet|0-16383|206|-|content-range|
4c|atom feed|indicators/feeds/place=NMS:CINMS.xml||200|application/atom+xml||
5a|atlas/catalog.json|atlas/catalog.json||200|-||
5b|aquamaps COG range|atlas/aquamaps_eov/score_risk_3857.tif|0-16383|206|-|content-range|
6a|obis-h3/collection.json|obis-h3/collection.json||200|-||
6b|obis-h3/latest.json|obis-h3/latest.json||200|-||
7a|marine-atlas/ index|marine-atlas/||200|text/html||
7b|marine-atlas stac catalog|marine-atlas/stac/catalog.json||200|-||
7c|marine-atlas parquet range|marine-atlas/tables/cog_3857.parquet|0-16383|206|-|content-range|
8a|backups/ closed|backups/||404|-||
8b|backups dump closed|backups/msens_20260623.sql.gz||404|-||
8c|atlas-restricted, no key|atlas-restricted/x||403|-||
8d|unlisted, no key|unlisted/gazetteer/mr_eez/places.parquet||403|-||'

run_host() {
  IDX=$1; local host=$2
  : > "$TMP/res.$IDX"; : > "$TMP/st.$IDX"
  local id label path range want ctype need org url fails h c i ms bad med total n3 codes

  # (1)-(8): single requests
  while IFS='|' read -r id label path range want ctype need org; do
    [ -n "$id" ] || continue
    url="$host/$path"
    if [ "$org" = ORIGIN ]; then org=$ORIGIN; else org=""; fi
    probe GET "$url" "$range" "$org"
    fails=""
    case "|$want|" in
      *"|$P_CODE|"*)
        if [ "$ctype" != "-" ]; then
          c=$(lower "$(hdr content-type)")
          case "$c" in "$ctype"*) ;; *) fails="content-type ${c:-none} (want $ctype)" ;; esac
        fi
        for h in $(echo "$need" | tr ',' ' '); do
          has_hdr "$h" || fails="${fails:+$fails; }no $h"
        done ;;
      *) fails="status $P_CODE (want $want)" ;;
    esac
    if [ -z "$fails" ]; then record "$id" "$label" PASS ""; else record "$id" "$label" FAIL "$fails"; fi
  done <<ROWS_END
$ROWS
ROWS_END

  # (9) CORS preflight
  probe OPTIONS "$host/gazetteer/index/places_index.parquet" "" "$ORIGIN" range
  fails=""
  case "$P_CODE" in
    200|204)
      c=$(hdr access-control-allow-origin)
      case "$c" in "*"|"$ORIGIN") ;; *) fails="allow-origin ${c:-none}" ;; esac
      c=$(lower "$(hdr access-control-allow-headers)")
      case "$c" in *range*) ;; *) fails="${fails:+$fails; }allow-headers ${c:-none} lacks range" ;; esac ;;
    *) fails="status $P_CODE (want 204 or 200)" ;;
  esac
  if [ -z "$fails" ]; then record 9 "CORS preflight" PASS "$P_CODE"; else record 9 "CORS preflight" FAIL "$fails"; fi

  # (11) timing: the median of 5 ranged GETs of (2)
  ms=""; bad=""
  for i in 1 2 3 4 5; do
    probe GET "$host/gazetteer/index/places_index.parquet" 0-16383 ""
    [ "$P_CODE" = 206 ] || bad="status $P_CODE (want 206)"
    ms="$ms $P_MS"
  done
  med=$(echo $ms | tr ' ' '\n' | sort -n | sed -n 3p)
  if [ -n "$bad" ]; then record 11 "median of 5 ranged GETs" FAIL "$bad"
  elif [ "$med" -gt "$MAX_MS" ]; then record 11 "median of 5 ranged GETs" FAIL "$med ms (limit $MAX_MS)"
  else record 11 "median of 5 ranged GETs" PASS "$med ms"; fi

  # (12) the keyed tier
  if [ -z "$KEY" ]; then
    record 12 "keyed range read" SKIP "no --key"
  else
    probe GET "$host/gazetteer/index/places_index.parquet?key=$KEY" 0-16383 ""
    fails=""
    if [ "$P_CODE" != 206 ]; then fails="status $P_CODE (want 206)"
    else
      has_hdr content-range || fails="no content-range"
      has_hdr x-om-usage    || fails="${fails:+$fails; }no x-om-usage"
    fi
    if [ -z "$fails" ]; then record 12 "keyed range read" PASS "x-om-usage present"
    else record 12 "keyed range read" FAIL "$fails"; fi
  fi

  # (10) over every request made above
  total=$(wc -l < "$TMP/st.$IDX" | tr -d ' ')
  n3=$(grep -c '^30[0-9]$' "$TMP/st.$IDX")
  if [ "$n3" -eq 0 ]; then record 10 "no 301/302 on any request" PASS "0 of $total"
  else
    codes=$(grep '^30[0-9]$' "$TMP/st.$IDX" | sort | uniq -c | awk '{ printf "%s%s x%s", s, $2, $1; s = ", " }')
    record 10 "no 301/302 on any request" FAIL "$n3 of $total ($codes)"
  fi
}

run_host 0 "$HOST"
[ -z "$COMPARE" ] || run_host 1 "$COMPARE"

# ---- the table, in the plan's order (the files are in run order: 10 was recorded last) ----
order() { awk -F'\t' '{ n = $1; sub(/[a-z]+$/, "", n); print (n + 0) "\t" NR "\t" $0 }' "$TMP/res.$1" | sort -n -k1,1 -k2,2 | cut -f3-; }
order 0 > "$TMP/o.0"
[ -z "$COMPARE" ] || order 1 > "$TMP/o.1"

cell() { awk -F'\t' -v n="$2" 'NR == n { printf "%s%s%s", $3, ($4 == "" ? "" : " "), $4 }' "$1"; }
name() { awk -F'\t' -v n="$2" 'NR == n { printf "%-3s %s", $1, $2 }' "$1"; }
short() { echo "$1" | sed -e 's#^https\{0,1\}://##'; }

N=$(wc -l < "$TMP/o.0" | tr -d ' ')
A=$(short "$HOST"); B=$(short "$COMPARE")
w0=5; w1=${#A}; w2=${#B}
i=1
while [ "$i" -le "$N" ]; do
  c=$(name "$TMP/o.0" "$i"); [ ${#c} -le $w0 ] || w0=${#c}
  c=$(cell "$TMP/o.0" "$i"); [ ${#c} -le $w1 ] || w1=${#c}
  if [ -n "$COMPARE" ]; then c=$(cell "$TMP/o.1" "$i"); [ ${#c} -le $w2 ] || w2=${#c}; fi
  i=$((i + 1))
done
rule() { printf '%*s' "$1" '' | tr ' ' '-'; }

echo
if [ -n "$COMPARE" ]; then
  printf '%-*s  %-*s  %-*s\n' $w0 "check" $w1 "$A" $w2 "$B"
  printf '%s  %s  %s\n' "$(rule $w0)" "$(rule $w1)" "$(rule $w2)"
else
  printf '%-*s  %-*s\n' $w0 "check" $w1 "$A"
  printf '%s  %s\n' "$(rule $w0)" "$(rule $w1)"
fi
i=1
while [ "$i" -le "$N" ]; do
  if [ -n "$COMPARE" ]; then
    printf '%-*s  %-*s  %-*s\n' $w0 "$(name "$TMP/o.0" "$i")" $w1 "$(cell "$TMP/o.0" "$i")" $w2 "$(cell "$TMP/o.1" "$i")"
  else
    printf '%-*s  %-*s\n' $w0 "$(name "$TMP/o.0" "$i")" $w1 "$(cell "$TMP/o.0" "$i")"
  fi
  i=$((i + 1))
done
echo
EXIT=0
for k in 0 ${COMPARE:+1}; do
  if [ "$k" = 0 ]; then h=$HOST; else h=$COMPARE; fi
  p=$(awk -F'\t' '$3 == "PASS"' "$TMP/o.$k" | wc -l | tr -d ' ')
  fl=$(awk -F'\t' '$3 == "FAIL"' "$TMP/o.$k" | wc -l | tr -d ' ')
  s=$(awk -F'\t' '$3 == "SKIP"' "$TMP/o.$k" | wc -l | tr -d ' ')
  echo "$h: $p PASS, $fl FAIL, $s SKIP"
  [ "$fl" -eq 0 ] || EXIT=1
done
exit $EXIT
