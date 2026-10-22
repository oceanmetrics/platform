// screenshots (DPR 1, 900x560, PNG): the antimeridian at Fiji and the world, each variant at the same camera.
// `carto` shots carry the CARTO dark basemap for context (data/shots/, then composed A beside C into small
// palette PNGs in shots/); `blank` shots (data/diff/) feed the pixel diff
// of B, C and CW against deck.gl (ImageMagick compare, AE with 8% fuzz: pixels that differ visibly).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { serve } from "./serve.mjs";

const CAMS = {
  "fiji-seam-z7": { center: [180, -17.0], zoom: 7 },
  "fiji-z5": { center: [180, -17.5], zoom: 5 },
  "pacific-z2": { center: [180, -10], zoom: 2 },
  "world-z1": { center: [0, 15], zoom: 1 },
};
const SHOOT = !process.env.COMPOSE_ONLY; // COMPOSE_ONLY=1 redoes the composites from data/shots
const server = await serve(5184);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
mkdirSync("shots", { recursive: true });
mkdirSync("data/shots", { recursive: true });
mkdirSync("data/diff", { recursive: true });
const diffs = [];
for (const ds of SHOOT ? ["es", "n"] : [])
  for (const [cam, c] of Object.entries(CAMS))
    for (const basemap of ["carto", "blank"]) {
      if (ds === "n" && basemap === "carto" && !cam.startsWith("world") && cam !== "fiji-z5") continue;
      for (const v of ["a", "b", "c", "cw"]) {
        const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
        await page.goto(`http://localhost:5184/${v}/?ds=${ds}&view=fiji&basemap=${basemap === "carto" ? "carto" : "none"}`);
        await page.waitForFunction(() => window.__spike, null, { timeout: 60000 });
        await page.evaluate(() => window.__spike.ready);
        await page.evaluate(async (c) => {
          window.__map.jumpTo(c);
          await new Promise((r) => window.__map.once("idle", r));
        }, c);
        // settle: the hexagons (tiles or deck) and the basemap
        await page.evaluate(async () => { const m = window.__map; for (let i = 0; i < 50 && !(m.areTilesLoaded() && m.loaded()); i++) await new Promise((r) => setTimeout(r, 100)); });
        await new Promise((r) => setTimeout(r, basemap === "carto" ? 1500 : 400));
        const file = basemap === "carto" ? `data/shots/${ds}-${cam}-${v}.png` : `data/diff/${ds}-${cam}-${v}.png`;
        await page.screenshot({ path: file });
        await page.close();
        if (basemap === "blank" && v !== "a") {
          let ae = "";
          try { execFileSync("magick", ["compare", "-metric", "AE", "-fuzz", "8%", `data/diff/${ds}-${cam}-a.png`, file, `data/diff/${ds}-${cam}-${v}-vs-a.png`], { stdio: "pipe" }); ae = "0"; }
          catch (e) { ae = String(e.stderr).trim(); }
          let lit = "";
          try { lit = execFileSync("magick", [`data/diff/${ds}-${cam}-a.png`, "-fuzz", "3%", "-fill", "black", "-opaque", "#0e1626", "-fill", "white", "+opaque", "black", "-format", "%[fx:mean*w*h]", "info:"]).toString(); } catch { lit = "?"; }
          diffs.push({ ds, cam, variant: v, diffPixels: Number(ae.split(" ")[0]), hexPixelsA: Math.round(Number(lit)) });
          console.log(JSON.stringify(diffs.at(-1)));
        }
      }
    }
if (SHOOT) writeFileSync("results/pixel-diff.json", JSON.stringify(diffs, null, 1));

// B, C and CW draw the same tiles: say whether their shots are pixel-identical
const same = (p, q) => { try { execFileSync("magick", ["compare", "-metric", "AE", p, q, "null:"], { stdio: "pipe" }); return true; } catch (e) { return String(e.stderr).trim().startsWith("0"); } };
const identical = Object.keys(CAMS).map((cam) => ({ cam, bc: same(`data/shots/es-${cam}-b.png`, `data/shots/es-${cam}-c.png`), ccw: same(`data/shots/es-${cam}-c.png`, `data/shots/es-${cam}-cw.png`) }));
writeFileSync("results/identical-b-c-cw.json", JSON.stringify(identical, null, 1));
console.log(JSON.stringify(identical));

// composites: A and C side by side (or stacked for the wide views), labelled, 128-colour PNGs
const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";
const label = (f, text, out) => execFileSync("magick", [f, "-gravity", "northwest", "-fill", "#ffffffd0", "-undercolor", "#000000a0", "-font", FONT, "-pointsize", "16", "-annotate", "+8+8", ` ${text} `, out]);
const meridian = (f) => execFileSync("magick", [f, "-stroke", "#ff2d95", "-strokewidth", "1", "-draw", "stroke-dasharray 6 6 line 450,0 450,560", f]);
for (const [ds, cam, how] of [["es", "fiji-seam-z7", "+append"], ["es", "fiji-z5", "+append"], ["es", "pacific-z2", "-append"], ["es", "world-z1", "-append"], ["n", "world-z1", "-append"]]) {
  const a = `data/shots/${ds}-${cam}-a-l.png`, c = `data/shots/${ds}-${cam}-c-l.png`;
  label(`data/shots/${ds}-${cam}-a.png`, `A deck.gl H3HexagonLayer, ${ds}`, a);
  label(`data/shots/${ds}-${cam}-c.png`, `C h3j tiles from PMTiles (B, C-w identical), ${ds}`, c);
  if (cam.startsWith("fiji") || cam.startsWith("pacific")) { meridian(a); meridian(c); }
  execFileSync("magick", [a, c, how, "-colors", "128", `PNG8:shots/${ds}-${cam}.png`]);
}
await browser.close();
server.close();
