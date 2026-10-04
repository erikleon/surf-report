// Test helper: writes a small stand-in for every file of the map group into a
// temp assets folder and a temp map data folder.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 1,000 bytes where byte i is i % 251, so any slice is easy to predict. */
export const BASEMAP = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

export const STYLE =
  '{"version":8,"sources":{"protomaps":{"type":"vector","url":"pmtiles://__BASEMAP__"}},' +
  '"glyphs":"__GLYPHS__/{fontstack}/{range}.pbf","layers":[]}';

/** Paths relative to the assets folder, except the `data:` ones, which are relative to the data folder. */
export function mapFiles(): Record<string, string | Buffer> {
  return {
    "vendor/maplibre-gl/maplibre-gl.mjs": 'import "./maplibre-gl-shared.mjs"; export const main = 1;',
    "vendor/maplibre-gl/maplibre-gl-shared.mjs": "export const shared = 1;",
    "vendor/maplibre-gl/maplibre-gl-worker.mjs": 'import "./maplibre-gl-shared.mjs";',
    "vendor/maplibre-gl/maplibre-gl.css": ".maplibregl-map{overflow:hidden}",
    "vendor/pmtiles/pmtiles.js": "var pmtiles = {};",
    "map.js": 'import { createWindLayer } from "./wind.js"; console.log("map", createWindLayer);',
    "wind.js": "export function createWindLayer() {}",
    "map/basemap.pmtiles": BASEMAP,
    "map/style-light.json": STYLE.replace('"layers"', '"name":"light","layers"'),
    "map/style-dark.json": STYLE.replace('"layers"', '"name":"dark","layers"'),
    "map/nearshore.svg": '<svg xmlns="http://www.w3.org/2000/svg"><title>Rockaway</title></svg>',
    "map/glyphs/Noto Sans Regular/0-255.pbf": "regular-0",
    "map/glyphs/Noto Sans Regular/8192-8447.pbf": "regular-8192",
    "map/glyphs/Noto Sans Medium/0-255.pbf": "medium-0",
    "map/glyphs/OFL.txt": "license",
    "data:bathymetry-ocean.geojson": '{"type":"FeatureCollection","features":[],"name":"bathymetry"}',
    "data:land.geojson": '{"type":"FeatureCollection","features":[],"name":"land"}',
    "data:shore.geojson": '{"type":"FeatureCollection","features":[],"name":"shore"}',
  };
}

/** Writes the map group, with `overrides` replacing file contents by the same keys. */
export function writeMapGroup(
  assetsDir: string,
  dataDir: string,
  overrides: Record<string, string | Buffer> = {},
): void {
  for (const [key, body] of Object.entries({ ...mapFiles(), ...overrides })) {
    const path = key.startsWith("data:") ? join(dataDir, key.slice(5)) : join(assetsDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

/** Where a map file key lives on disk. */
export function mapFilePath(assetsDir: string, dataDir: string, key: string): string {
  return key.startsWith("data:") ? join(dataDir, key.slice(5)) : join(assetsDir, key);
}
