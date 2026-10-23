#!/usr/bin/env python3
"""fetch_gazetteer.py: the whole IHO-IOC GEBCO Gazetteer of Undersea Feature Names as three GeoJSON files.

The IHO DCDB feature service (points = layer 0, lines = 1, polygons = 2; fields NAME, TYPE, FEATURE_ID) pages at 2,000
records; CalCOFI workflows libs/reference_layers.R download_gazetteer() fetched it inside a California box, this takes
the globe. Python stdlib only.

  python3 -I fetch_gazetteer.py <out_dir>      -> <out_dir>/gebco_gazetteer_{points,lines,polygons}.geojson
"""
import json, os, sys, urllib.request

SERVICE = "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/Undersea_Features/FeatureServer"
LAYERS = {"points": 0, "lines": 1, "polygons": 2}
PAGE = 2000


def fetch(layer, offset):
    url = (f"{SERVICE}/{layer}/query?where=1%3D1&outFields=NAME,TYPE,FEATURE_ID&outSR=4326&f=geojson"
           f"&orderByFields=FEATURE_ID&resultOffset={offset}&resultRecordCount={PAGE}")
    with urllib.request.urlopen(url, timeout=120) as r:
        j = json.load(r)
    if "error" in j:
        raise SystemExit(f"gazetteer layer {layer}: {j['error']}")
    return j["features"]


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, layer in LAYERS.items():
        feats, offset = [], 0
        while True:
            page = fetch(layer, offset)
            feats += page
            if len(page) < PAGE:
                break
            offset += PAGE
        ids = {f["properties"]["FEATURE_ID"] for f in feats}
        print(f"gazetteer {name}: {len(feats)} features, {len(ids)} distinct FEATURE_ID", flush=True)
        with open(os.path.join(out_dir, f"gebco_gazetteer_{name}.geojson"), "w") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
