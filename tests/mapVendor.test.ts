// Checks the self-hosted map client files: MapLibre, the PMTiles reader, the
// basemap, glyphs and the two styles. See docs/map-client.md.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string): Buffer => readFileSync(new URL(path, root));
const text = (path: string): string => read(path).toString("utf8");
const exists = (path: string): boolean => existsSync(new URL(path, root));

const MAPLIBRE = "assets/vendor/maplibre-gl/";
const PMTILES = "assets/vendor/pmtiles/";
const STYLES = ["assets/map/style-light.json", "assets/map/style-dark.json"];

const FILES = [
  `${MAPLIBRE}maplibre-gl.mjs`,
  `${MAPLIBRE}maplibre-gl-shared.mjs`,
  `${MAPLIBRE}maplibre-gl-worker.mjs`,
  `${MAPLIBRE}maplibre-gl.css`,
  `${MAPLIBRE}LICENSE.txt`,
  `${PMTILES}pmtiles.js`,
  `${PMTILES}LICENSE`,
  `${PMTILES}LICENSE-fflate`,
  "assets/map/basemap.pmtiles",
  "assets/map/glyphs/OFL.txt",
  ...STYLES,
];

const SCRIPTS = [
  `${MAPLIBRE}maplibre-gl.mjs`,
  `${MAPLIBRE}maplibre-gl-shared.mjs`,
  `${MAPLIBRE}maplibre-gl-worker.mjs`,
  `${PMTILES}pmtiles.js`,
];

describe("vendored map files", () => {
  it.each(FILES)("%s exists", (path) => {
    expect(exists(path)).toBe(true);
  });

  it("match the recorded SHA-256 sums", () => {
    const lines = text("assets/vendor/SHA256SUMS").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const line of lines) {
      const [sum, name] = line.split(/\s+/);
      const actual = createHash("sha256").update(read(`assets/vendor/${name}`)).digest("hex");
      expect(actual, name).toBe(sum);
    }
  });

  it.each(SCRIPTS)("%s builds no code from strings with new Function", (path) => {
    expect(text(path)).not.toContain("new Function");
  });

  it.each(SCRIPTS.filter((p) => !p.endsWith("worker.mjs")))("%s does not call eval", (path) => {
    expect(text(path)).not.toMatch(/\beval\(/);
  });

  // The worker has one eval: its handler for importScriptInWorkers() with a
  // classic script. The map page never calls that, and the CSP has no
  // 'unsafe-eval', so the browser would refuse it anyway. Any other eval fails here.
  it("the worker's only eval is the classic-script loader", () => {
    const source = text(`${MAPLIBRE}maplibre-gl-worker.mjs`);
    const calls = source.match(/\beval\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source).toContain("globalThis.eval(n)}");
  });

  it("the MapLibre bundle loads its worker as a module, not from a blob, when it is same-origin", () => {
    const source = text(`${MAPLIBRE}maplibre-gl.mjs`);
    expect(source).toContain("new Worker(e,{type:`module`})");
    expect(source).toContain("setWorkerUrl");
  });

  it("the basemap is a PMTiles v3 archive under 8 MB", () => {
    const head = read("assets/map/basemap.pmtiles").subarray(0, 8);
    expect(head.subarray(0, 7).toString("latin1")).toBe("PMTiles");
    expect(head[7]).toBe(3);
    expect(statSync(new URL("assets/map/basemap.pmtiles", root)).size).toBeLessThan(8 * 1024 * 1024);
  });
});

interface Style {
  version: number;
  sprite?: unknown;
  glyphs: string;
  sources: Record<string, { type: string; url?: string; tiles?: string[]; attribution?: string }>;
  layers: Array<{ id: string; layout?: Record<string, unknown> }>;
}

/** Font stacks in a text-font value: string arrays whose entries all look like font names. */
function fontStacks(value: unknown, out: Set<string>): void {
  if (!Array.isArray(value)) return;
  if (value.length > 0 && value.every((v) => typeof v === "string" && /[A-Z]/.test(v))) {
    out.add(value.join(","));
    return;
  }
  for (const item of value) fontStacks(item, out);
}

describe.each(STYLES)("%s", (path) => {
  const raw = text(path);
  const style = JSON.parse(raw) as Style;

  it("is a version 8 style", () => {
    expect(style.version).toBe(8);
  });

  it("has no sprite and no icons", () => {
    expect(style).not.toHaveProperty("sprite");
    expect(raw).not.toContain("sprite");
    expect(raw).not.toContain('"icon-');
  });

  it("has no absolute URLs, only the server's placeholders", () => {
    expect(raw).not.toMatch(/https?:/);
    expect(style.glyphs).toBe("__GLYPHS__/{fontstack}/{range}.pbf");
    const sources = Object.values(style.sources);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: "vector", url: "pmtiles://__BASEMAP__" });
    expect(sources[0]).not.toHaveProperty("tiles");
  });

  it("credits Protomaps and OpenStreetMap on the source", () => {
    expect(Object.values(style.sources)[0]?.attribution).toBe(
      "Protomaps © OpenStreetMap contributors",
    );
  });

  it("uses only font stacks that are shipped under assets/map/glyphs", () => {
    const stacks = new Set<string>();
    for (const layer of style.layers) fontStacks(layer.layout?.["text-font"], stacks);
    expect(stacks.size).toBeGreaterThan(0);
    for (const stack of stacks) {
      for (const range of ["0-255", "256-511", "8192-8447"]) {
        expect(exists(`assets/map/glyphs/${stack}/${range}.pbf`), `${stack} ${range}`).toBe(true);
      }
    }
  });
});
