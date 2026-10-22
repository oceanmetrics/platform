"""the spike's tables (markdown) from results/*.json. usage: python3 report.py > results/tables.md"""
import json

G = json.load(open("results/gdal_stats.json"))["files"]
S = json.load(open("results/stats.json"))
D = json.load(open("results/draw.json"))
P = json.load(open("results/points.json"))
NAMES = {"score_risk": "score_risk.tif", "am_native": "729c63f1d05d0515.tif", "mst": "9fe6f75498affae1.tif"}
K = ["minimum", "maximum", "mean", "stddev", "valid_percent"]


def tvd(a, b):
  sa, sb = sum(a) or 1, sum(b) or 1
  return 50 * sum(abs(x / sa - y / sb) for x, y in zip(a, b))  # percent


def f(x, d=2):
  return "n/a" if x is None else f"{x:.{d}f}"


print("## Draw: first tile and full draw (median of 3 cold page loads, 1280x800)\n")
print("| file | source | view | first tile ms | full draw ms | bytes | requests | tiles | note |")
print("|---|---|---|---:|---:|---:|---:|---:|---|")
for r in D:
  tj = r["tilejson"]["bounds"] if r["tilejson"] else None
  note = "placed in ±0.0016° at 0,0 (misplaced)" if tj and abs(tj[2]) < 1 else ""
  ft = "none" if r["firstTileMs"] is None or r["firstTileMs"] != r["firstTileMs"] else f"{r['firstTileMs']:.0f}"
  print(f"| {r['file']} | {r['source']} | {r['view']} | {ft} | {r['idleMs']:.0f} | {r['bytes']:,} | {r['requests']} | {r['tiles']} | {note} |")

print("\n## Legend histogram: whole smallest overview with geotiff.js (median of 3 cold loads)\n")
print("| file | source | image read | ms | bytes | requests |")
print("|---|---|---|---:|---:|---:|")
for o in S["overview"]:
  r = o["runs"][0]
  print(f"| {o['file']} | {o['source']} | {r['width']}x{r['height']} (image {r['image']}) | {o['medianMs']:.0f} | {o['bytes']:,} | {o['requests']} |")

print("\n## Statistics agreement, band 1 (reference: GDAL over every full-resolution pixel of the 4326 original)\n")
print("| file | method | min | max | mean | stddev | valid % | mean err % | sd err % | hist TVD % |")
print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
for key, name in NAMES.items():
  ref = G[name]["4326"]["bands"][0]["full"]
  rows = [("GDAL full res 4326 (reference)", ref, ref["histogram"]["buckets"])]
  ov = [o for o in S["overview"] if o["file"] == key]
  for o in ov:
    b = o["runs"][0]["bands"][0]
    hb = b.get("histogram_ref_edges", b["histogram"])["buckets"]
    rows.append((f"geotiff.js smallest overview, {o['source']} ({o['runs'][0]['width']}x{o['runs'][0]['height']})", b, hb))
  gov = G[name]["4326"]["bands"][0]["overviews"]
  if gov:
    rows.append((f"GDAL same overview 4326 ({gov[-1]['width']}x{gov[-1]['height']})", gov[-1], gov[-1]["histogram_ref_edges"]["buckets"]))
  g3 = G[name]["3857"]["bands"][0]["full"]
  rows.append(("GDAL full res 3857 copy", g3, None))
  for t in S["titiler"]:
    if t["file"] != key or "b1" not in t["body"]:
      continue
    b = t["body"]["b1"]
    tb = {"minimum": b["min"], "maximum": b["max"], "mean": b["mean"], "stddev": b["std"], "valid_percent": b["valid_percent"]}
    rows.append((f"titiler /cog/statistics max_size={t['max_size']} ({t['ms']:.0f} ms)", tb, b["histogram"][0]))
  for lab, s, hb in rows:
    me = 100 * (s["mean"] - ref["mean"]) / ref["mean"]
    se = 100 * (s["stddev"] - ref["stddev"]) / ref["stddev"]
    tv = f(tvd(hb, ref["histogram"]["buckets"]), 2) if hb else "n/a"
    print(f"| {key} | {lab} | {s['minimum']:.0f} | {s['maximum']:.0f} | {s['mean']:.3f} | {s['stddev']:.3f} | {s['valid_percent']:.2f} | {me:+.2f} | {se:+.2f} | {tv} |")

print("\n## score_risk, all 9 bands: geotiff.js smallest 4326 overview (450x225) vs GDAL full res\n")
print("| band | name | full mean | overview mean | mean err % | full valid % | overview valid % | hist TVD % |")
print("|---|---|---:|---:|---:|---:|---:|---:|")
o = [o for o in S["overview"] if o["file"] == "score_risk" and o["crs"] == "4326"][0]["runs"][0]
for gb, b in zip(G["score_risk.tif"]["4326"]["bands"], o["bands"]):
  ref = gb["full"]
  if "mean" not in ref:
    print(f"| {gb['band']} | {gb['name']} | no valid pixel | {b['valid']} valid | | 0.00 | {b['valid_percent']:.2f} | |")
    continue
  me = 100 * (b["mean"] - ref["mean"]) / ref["mean"] if ref["mean"] else float("nan")
  print(f"| {gb['band']} | {gb['name']} | {ref['mean']:.3f} | {b['mean']:.3f} | {me:+.1f} | {ref['valid_percent']:.2f} | {b['valid_percent']:.2f} | {tvd(b['histogram_ref_edges']['buckets'], ref['histogram']['buckets']):.2f} |")

print("\n## score_risk band 1: error by overview level (GDAL, 4326 original and 3857 copy)\n")
print("| crs | image | mean err % | sd err % | valid % err (points) | hist TVD % |")
print("|---|---|---:|---:|---:|---:|")
for crs in ["4326", "3857"]:
  ref = G["score_risk.tif"]["4326"]["bands"][0]["full"]
  b0 = G["score_risk.tif"][crs]["bands"][0]
  for s in [dict(b0["full"], width=G["score_risk.tif"][crs]["width"], height=G["score_risk.tif"][crs]["height"])] + b0["overviews"]:
    hb = s.get("histogram_ref_edges", s["histogram"])["buckets"]
    if "histogram_ref_edges" not in s and crs == "3857":
      # recompute is not stored for the 3857 full image; its own edges are 0..90, so skip TVD
      hb = None
    print(f"| {crs} | {s['width']}x{s['height']} | {100 * (s['mean'] - ref['mean']) / ref['mean']:+.2f} | {100 * (s['stddev'] - ref['stddev']) / ref['stddev']:+.2f} | {s['valid_percent'] - ref['valid_percent']:+.2f} | {f(tvd(hb, ref['histogram']['buckets'])) if hb else 'n/a'} |")

print("\n## View statistics (window of the overview closest to the screen, median of 3)\n")
print("| file | view | source | options | image | window px | ms total | ms read | bytes | requests |")
print("|---|---|---|---|---|---|---:|---:|---:|---:|")
for v in S["view"]:
  r = v["runs"][0]
  w = r["window"]
  print(f"| {v['file']} | {v['view']} | {v['source']} | {json.dumps(v.get('opts', {}))} | {r['imageSize'][0]}x{r['imageSize'][1]} | {w[2]-w[0]}x{w[3]-w[1]} | {v['medianMs']:.0f} | {v['medianReadMs']:.0f} | {v['bytes']:,} | {v['requests']} |")

print("\n## Point reads (cold = first read in a fresh page, warm = a second point 0.3° away)\n")
print("| file | method | values | cold ms | warm ms | cold bytes |")
print("|---|---|---|---:|---:|---:|")
for p in P:
  vals = ",".join("nd" if (x is None or x != x) else str(int(x)) for x in p["values"])
  print(f"| {p['file']} | {p['method']} | {vals} | {p['coldMs']:.0f} | {f(p.get('warmMs'), 0)} | {p.get('coldBytes', 0):,} |")
