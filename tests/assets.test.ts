import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { loadAssets as realLoadAssets, type Assets, type LoadOptions } from "../src/assets.js";
import { BASEMAP, mapFilePath, mapFiles, writeMapGroup } from "./mapFixture.js";

/** Keeps the "map is off" line out of the output and the map data inside the temp folder. */
const loadAssets = (dir: string, opts: LoadOptions = {}): Assets =>
  realLoadAssets(dir, { log: () => undefined, mapDataDir: join(dir, "data"), ...opts });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Sources {
  css?: string;
  js?: string;
  geist?: string;
  serif?: string;
}

function makeDir(sources: Sources = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "surf-assets-"));
  dirs.push(dir);
  mkdirSync(join(dir, "fonts"));
  writeFileSync(
    join(dir, "site.css"),
    sources.css ?? "@font-face{src:url(__FONT_GEIST__)}@font-face{src:url(__FONT_SERIF__)}body{margin:0}",
  );
  writeFileSync(join(dir, "scrub.js"), sources.js ?? "console.log('scrub');");
  writeFileSync(join(dir, "fonts/geist-latin-wght.woff2"), sources.geist ?? "geist-bytes");
  writeFileSync(join(dir, "fonts/instrument-serif-latin-400.woff2"), sources.serif ?? "serif-bytes");
  return dir;
}

const hash8 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex").slice(0, 8);

describe("loadAssets urls", () => {
  it("names each file with the first 8 hex characters of its sha256", () => {
    const { urls } = loadAssets(makeDir());
    expect(urls.geist).toBe(`/assets/fonts/geist-latin-wght.${hash8("geist-bytes")}.woff2`);
    expect(urls.serif).toBe(`/assets/fonts/instrument-serif-latin-400.${hash8("serif-bytes")}.woff2`);
    expect(urls.js).toBe(`/assets/scrub.${hash8("console.log('scrub');")}.js`);
    expect(urls.css).toMatch(/^\/assets\/site\.[0-9a-f]{8}\.css$/);
  });

  it("changes a file's URL when its bytes change", () => {
    const a = loadAssets(makeDir({ js: "a" })).urls;
    const b = loadAssets(makeDir({ js: "b" })).urls;
    expect(a.js).not.toBe(b.js);
    expect(a.css).toBe(b.css);
  });

  it("replaces the font tokens in the stylesheet with the hashed font URLs", () => {
    const assets = loadAssets(makeDir());
    const css = assets.lookup(assets.urls.css)?.body.toString("utf8");
    expect(css).toContain(`url(${assets.urls.geist})`);
    expect(css).toContain(`url(${assets.urls.serif})`);
    expect(css).not.toContain("__FONT_");
  });

  it("hashes the stylesheet after the replacement", () => {
    const assets = loadAssets(makeDir());
    const css = assets.lookup(assets.urls.css)?.body;
    expect(css).toBeDefined();
    expect(assets.urls.css).toBe(`/assets/site.${hash8(css as Buffer)}.css`);
  });

  it("changes the stylesheet URL when only a font changes", () => {
    const a = loadAssets(makeDir({ geist: "one" })).urls;
    const b = loadAssets(makeDir({ geist: "two" })).urls;
    expect(a.css).not.toBe(b.css);
  });
});

describe("loadAssets lookup", () => {
  it("returns the type and body of each asset", () => {
    const assets = loadAssets(makeDir());
    expect(assets.lookup(assets.urls.css)?.type).toBe("text/css; charset=utf-8");
    expect(assets.lookup(assets.urls.js)?.type).toBe("text/javascript; charset=utf-8");
    expect(assets.lookup(assets.urls.geist)?.type).toBe("font/woff2");
    expect(assets.lookup(assets.urls.serif)?.body.toString()).toBe("serif-bytes");
  });

  it("precompresses css and js with brotli and gzip", () => {
    const assets = loadAssets(makeDir());
    for (const url of [assets.urls.css, assets.urls.js]) {
      const asset = assets.lookup(url);
      expect(asset).toBeDefined();
      expect(brotliDecompressSync(asset!.encodings["br"]!)).toEqual(asset!.body);
      expect(gunzipSync(asset!.encodings["gzip"]!)).toEqual(asset!.body);
    }
  });

  it("does not recompress fonts", () => {
    const assets = loadAssets(makeDir());
    expect(assets.lookup(assets.urls.geist)?.encodings).toEqual({});
    expect(assets.lookup(assets.urls.serif)?.encodings).toEqual({});
  });

  it("resolves only the four known URLs", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "secret.txt"), "nope");
    const assets = loadAssets(dir);
    const known = Object.values(assets.urls);
    expect(known).toHaveLength(4);
    expect(assets.lookup("/assets/secret.txt")).toBeUndefined();
    expect(assets.lookup("/assets/site.css")).toBeUndefined();
    expect(assets.lookup("/assets/site.00000000.css")).toBeUndefined();
    expect(assets.lookup(`${assets.urls.css}/`)).toBeUndefined();
  });

  it.each([
    "/assets/../secret.txt",
    "/assets/fonts/../../secret.txt",
    "/assets/%2e%2e/secret.txt",
    "/assets/..%2fsecret.txt",
    "/assets//etc/passwd",
    "/../etc/passwd",
    "/assets/__proto__",
    "/assets/constructor",
    "",
  ])("returns undefined for %s", (path) => {
    expect(loadAssets(makeDir()).lookup(path)).toBeUndefined();
  });
});

describe("loadAssets failures", () => {
  it.each(["site.css", "scrub.js", "fonts/geist-latin-wght.woff2", "fonts/instrument-serif-latin-400.woff2"])(
    "throws an error naming a missing %s",
    (name) => {
      const dir = makeDir();
      rmSync(join(dir, name));
      expect(() => loadAssets(dir)).toThrow(join(dir, name));
    },
  );
});

// ---- the map group ----

/** A core assets folder plus the whole map group, with the map data in `<dir>/data`. */
function makeMapDir(overrides: Record<string, string | Buffer> = {}): string {
  const dir = makeDir();
  writeMapGroup(dir, join(dir, "data"), overrides);
  return dir;
}

function mapOf(assets: Assets) {
  const map = assets.urls.map;
  if (map === undefined) throw new Error("map group did not load");
  return map;
}

const MODULES = ["maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs"];

describe("loadAssets map group", () => {
  it("loads every map file and resolves every URL in urls.map", () => {
    const assets = loadAssets(makeMapDir());
    const map = mapOf(assets);
    for (const [key, url] of Object.entries(map)) {
      if (key === "wind") continue;
      expect(assets.lookup(url), key).toBeDefined();
    }
    expect(map.wind).toBe("/data/wind.json");
    expect(assets.lookup(map.wind)).toBeUndefined();
  });

  it("names the files with hashes in the documented shapes", () => {
    const map = mapOf(loadAssets(makeMapDir()));
    expect(map.maplibre).toMatch(/^\/assets\/vendor\/maplibre-gl\.[0-9a-f]{8}\/maplibre-gl\.mjs$/);
    expect(map.maplibreCss).toBe(`/assets/vendor/maplibre-gl.${hash8(".maplibregl-map{overflow:hidden}")}.css`);
    expect(map.pmtiles).toBe(`/assets/vendor/pmtiles.${hash8("var pmtiles = {};")}.js`);
    expect(map.client).toMatch(/^\/assets\/map-client\.[0-9a-f]{8}\/map\.js$/);
    expect(map.staticSvg).toMatch(/^\/assets\/map\/nearshore\.[0-9a-f]{8}\.svg$/);
    expect(map.styleLight).toMatch(/^\/assets\/map\/style-light\.[0-9a-f]{8}\.json$/);
    expect(map.styleDark).toMatch(/^\/assets\/map\/style-dark\.[0-9a-f]{8}\.json$/);
    for (const name of ["bathymetry", "land", "shore"] as const) {
      const source = mapFiles()[`data:${name}.geojson`] as string;
      expect(map[name]).toBe(`/assets/map/data/${name}.${hash8(source)}.geojson`);
    }
  });

  it("serves the three MapLibre modules from one folder under their own names", () => {
    const assets = loadAssets(makeMapDir());
    const folder = mapOf(assets).maplibre.replace(/\/maplibre-gl\.mjs$/, "");
    for (const name of MODULES) {
      const asset = assets.lookup(`${folder}/${name}`);
      expect(asset?.body.toString()).toBe(mapFiles()[`vendor/maplibre-gl/${name}`]);
      expect(asset?.type).toBe("text/javascript; charset=utf-8");
    }
  });

  it("serves map.js and wind.js from one folder so map.js's relative import resolves", () => {
    const assets = loadAssets(makeMapDir());
    const client = mapOf(assets).client;
    const folder = client.replace(/\/map\.js$/, "");
    // The URL the browser computes for `import "./wind.js"` inside map.js.
    const windUrl = new URL("./wind.js", `https://surf.example${client}`).pathname;
    expect(windUrl).toBe(`${folder}/wind.js`);
    expect(assets.lookup(windUrl)?.body.toString()).toBe(mapFiles()["wind.js"]);
    expect(assets.lookup(windUrl)?.type).toBe("text/javascript; charset=utf-8");
  });

  it.each(["map.js", "wind.js"])("changes the client folder when %s changes", (name) => {
    const a = mapOf(loadAssets(makeMapDir())).client;
    const b = mapOf(loadAssets(makeMapDir({ [name]: "export const changed = 1;" }))).client;
    expect(a).not.toBe(b);
  });

  it.each(MODULES)("changes the module folder when %s changes", (name) => {
    const a = mapOf(loadAssets(makeMapDir())).maplibre;
    const b = mapOf(loadAssets(makeMapDir({ [`vendor/maplibre-gl/${name}`]: "changed" }))).maplibre;
    expect(a).not.toBe(b);
  });

  it("gives each map file its type and precompresses the text ones", () => {
    const assets = loadAssets(makeMapDir());
    const map = mapOf(assets);
    const text: Array<[string, string]> = [
      [map.maplibre, "text/javascript; charset=utf-8"],
      [map.maplibreCss, "text/css; charset=utf-8"],
      [map.pmtiles, "text/javascript; charset=utf-8"],
      [map.client, "text/javascript; charset=utf-8"],
      [map.styleLight, "application/json; charset=utf-8"],
      [map.styleDark, "application/json; charset=utf-8"],
      [map.staticSvg, "image/svg+xml"],
      [map.bathymetry, "application/geo+json"],
      [map.land, "application/geo+json"],
      [map.shore, "application/geo+json"],
    ];
    for (const [url, type] of text) {
      const asset = assets.lookup(url)!;
      expect(asset.type, url).toBe(type);
      expect(brotliDecompressSync(asset.encodings["br"]!)).toEqual(asset.body);
      expect(gunzipSync(asset.encodings["gzip"]!)).toEqual(asset.body);
    }
  });

  it("serves the basemap uncompressed, as a ranged binary, under its hash", () => {
    const assets = loadAssets(makeMapDir());
    const style = assets.lookup(mapOf(assets).styleLight)!.body.toString();
    const url = `/assets/map/basemap.${hash8(BASEMAP)}.pmtiles`;
    expect(style).toContain(`"pmtiles://${url}"`);
    const basemap = assets.lookup(url)!;
    expect(basemap.body).toEqual(BASEMAP);
    expect(basemap.type).toBe("application/octet-stream");
    expect(basemap.encodings).toEqual({});
    expect(basemap.ranges).toBe(true);
  });
});

describe("loadAssets map styles", () => {
  it("replaces both placeholders and leaves none behind", () => {
    const assets = loadAssets(makeMapDir());
    const map = mapOf(assets);
    for (const url of [map.styleLight, map.styleDark]) {
      const style = JSON.parse(assets.lookup(url)!.body.toString()) as {
        sources: { protomaps: { url: string } };
        glyphs: string;
      };
      expect(style.sources.protomaps.url).toMatch(/^pmtiles:\/\/\/assets\/map\/basemap\.[0-9a-f]{8}\.pmtiles$/);
      expect(style.glyphs).toMatch(/^\/assets\/map\/glyphs\.[0-9a-f]{8}\/\{fontstack\}\/\{range\}\.pbf$/);
      expect(assets.lookup(url)!.body.toString()).not.toMatch(/__BASEMAP__|__GLYPHS__/);
    }
  });

  it("hashes each style after the replacement", () => {
    const assets = loadAssets(makeMapDir());
    const url = mapOf(assets).styleLight;
    expect(url).toBe(`/assets/map/style-light.${hash8(assets.lookup(url)!.body)}.json`);
  });

  it("changes the style URL when only the basemap or a glyph changes", () => {
    const base = mapOf(loadAssets(makeMapDir())).styleDark;
    const basemap = mapOf(loadAssets(makeMapDir({ "map/basemap.pmtiles": "other" }))).styleDark;
    const glyph = mapOf(loadAssets(makeMapDir({ "map/glyphs/Noto Sans Medium/0-255.pbf": "other" }))).styleDark;
    expect(basemap).not.toBe(base);
    expect(glyph).not.toBe(base);
  });

  it("turns the map off when a style has no placeholder", () => {
    const lines: string[] = [];
    const assets = loadAssets(makeMapDir({ "map/style-dark.json": '{"glyphs":"__GLYPHS__"}' }), {
      log: (l) => lines.push(l),
    });
    expect(assets.urls.map).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("no __BASEMAP__ placeholder");
  });
});

describe("loadAssets glyphs", () => {
  function glyphBase(assets: Assets): string {
    const style = assets.lookup(mapOf(assets).styleLight)!.body.toString();
    const match = /"glyphs":"([^"]+)\/\{fontstack\}/.exec(style);
    if (match?.[1] === undefined) throw new Error("no glyph URL in the style");
    return match[1];
  }

  it("finds a glyph range by its URL-encoded font name", () => {
    const assets = loadAssets(makeMapDir());
    const base = glyphBase(assets);
    const regular = assets.lookup(`${base}/Noto%20Sans%20Regular/8192-8447.pbf`);
    expect(regular?.body.toString()).toBe("regular-8192");
    expect(regular?.type).toBe("application/x-protobuf");
    expect(regular?.encodings).toEqual({});
    expect(assets.lookup(`${base}/Noto%20Sans%20Medium/0-255.pbf`)?.body.toString()).toBe("medium-0");
  });

  it("returns undefined for a range or font that is not on disk", () => {
    const assets = loadAssets(makeMapDir());
    const base = glyphBase(assets);
    expect(assets.lookup(`${base}/Noto%20Sans%20Medium/8192-8447.pbf`)).toBeUndefined();
    expect(assets.lookup(`${base}/Noto%20Sans%20Bold/0-255.pbf`)).toBeUndefined();
    expect(assets.lookup(`${base}/OFL.txt`)).toBeUndefined();
    expect(assets.lookup(`/assets/map/glyphs.00000000/Noto%20Sans%20Regular/0-255.pbf`)).toBeUndefined();
  });

  it.each([
    "/../../site.css",
    "/Noto%20Sans%20Regular/../../map.js",
    "/Noto%20Sans%20Regular/..%2F..%2Fmap.js",
    "/%2e%2e/%2e%2e/scrub.js",
    "/..%2f..%2f..%2fpackage.json",
    "/Noto%20Sans%20Regular/%E0%A4%A.pbf",
    "/Noto%20Sans%20Regular%2F0-255.pbf%00",
    "/Noto%20Sans%20Regular//0-255.pbf",
    "/__proto__",
    "/",
    "",
  ])("returns undefined for the traversal or malformed name %s", (suffix) => {
    const assets = loadAssets(makeMapDir());
    expect(assets.lookup(`${glyphBase(assets)}${suffix}`)).toBeUndefined();
  });

  it("changes the glyph folder hash when any glyph changes", () => {
    const a = glyphBase(loadAssets(makeMapDir()));
    const b = glyphBase(loadAssets(makeMapDir({ "map/glyphs/Noto Sans Regular/0-255.pbf": "changed" })));
    expect(a).not.toBe(b);
  });
});

describe("loadAssets missing map files", () => {
  // The glyphs are whatever .pbf files are on disk, so one missing range is a 404, not a missing file.
  it.each(Object.keys(mapFiles()).filter((key) => !key.startsWith("map/glyphs/")))(
    "turns the map off and logs one line when %s is missing",
    (key) => {
      const dir = makeMapDir();
      rmSync(mapFilePath(dir, join(dir, "data"), key));
      const lines: string[] = [];
      const assets = loadAssets(dir, { log: (l) => lines.push(l) });
      expect(assets.urls.map).toBeUndefined();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(key.startsWith("data:") ? key.slice(5) : key);
      expect(assets.lookup(assets.urls.css)).toBeDefined();
      expect(assets.lookup(`/assets/map.${hash8("console.log('map');")}.js`)).toBeUndefined();
    },
  );

  it("names every missing file on the one line", () => {
    const dir = makeDir();
    const lines: string[] = [];
    const assets = loadAssets(dir, { log: (l) => lines.push(l) });
    expect(assets.urls.map).toBeUndefined();
    expect(Object.keys(assets.urls)).toEqual(["css", "js", "geist", "serif"]);
    expect(lines).toHaveLength(1);
    for (const name of [
      "maplibre-gl.mjs",
      "maplibre-gl-shared.mjs",
      "maplibre-gl-worker.mjs",
      "maplibre-gl.css",
      "pmtiles.js",
      "map.js",
      "wind.js",
      "basemap.pmtiles",
      "style-light.json",
      "style-dark.json",
      "nearshore.svg",
      "bathymetry.geojson",
      "land.geojson",
      "shore.geojson",
      "glyphs",
    ]) {
      expect(lines[0]).toContain(name);
    }
  });

  it("turns the map off when the glyph folder has no .pbf files", () => {
    const dir = makeMapDir();
    rmSync(join(dir, "map/glyphs/Noto Sans Regular"), { recursive: true });
    rmSync(join(dir, "map/glyphs/Noto Sans Medium"), { recursive: true });
    const lines: string[] = [];
    expect(loadAssets(dir, { log: (l) => lines.push(l) }).urls.map).toBeUndefined();
    expect(lines[0]).toContain("no .pbf files");
  });

  it("still throws for a missing core file when the map group is complete", () => {
    const dir = makeMapDir();
    rmSync(join(dir, "scrub.js"));
    expect(() => loadAssets(dir)).toThrow(join(dir, "scrub.js"));
  });

  it("logs nothing when the map group is complete", () => {
    const lines: string[] = [];
    loadAssets(makeMapDir(), { log: (l) => lines.push(l) });
    expect(lines).toEqual([]);
  });
});
