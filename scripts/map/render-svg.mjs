#!/usr/bin/env node
// Draws assets/map/nearshore.svg, the static nearshore map, from the committed
// data in data/map/, and writes src/mapFacts.ts, the facts the /map page lists
// under the map. Run from the repo root after a build:
//
//   npm run build && node scripts/map/render-svg.mjs
//
// The drawing code is src/mapSvg.ts. tests/mapSvg.test.ts renders the same
// data and fails when either committed file differs from the output.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { factsModule, nearshoreFacts, renderNearshoreSvg } from "../../dist/mapSvg.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "data", "map");
const read = (name) => JSON.parse(readFileSync(join(DATA, name), "utf8"));

const input = {
  land: read("land.geojson"),
  bathymetry: read("bathymetry.geojson"),
  shore: read("shore.geojson"),
  sources: [...read("SOURCES.json"), ...read("SOURCES-osm.json")],
};

const svg = renderNearshoreSvg(input);
writeFileSync(join(ROOT, "assets", "map", "nearshore.svg"), svg);
writeFileSync(join(ROOT, "src", "mapFacts.ts"), factsModule(nearshoreFacts(input)));
console.log(`assets/map/nearshore.svg: ${Buffer.byteLength(svg)} bytes`);
