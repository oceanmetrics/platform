#!/bin/bash
# poll the worker for files the s3 -> r2 mirror lands later: HEAD every 60 s, up to 45 minutes.
# usage: poll.sh <path-under-worker> ; exits 0 when 200, 1 after the deadline; prints the wait in seconds.
W=${OM_WORKER:-https://om-gazetteer.ben-f07.workers.dev}
p="$1"; t0=$(date +%s)
while true; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -I "$W/$p")
  now=$(date +%s)
  if [ "$c" = 200 ]; then echo "$p 200 waited=$((now-t0))s"; exit 0; fi
  if [ $((now-t0)) -ge 2700 ]; then echo "$p $c gave-up waited=$((now-t0))s"; exit 1; fi
  sleep 60
done
