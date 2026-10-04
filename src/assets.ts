// The static files, read once at startup and served under content-hashed URLs.
// A file that changes gets a new URL, so the browser can keep each one for a year.
//
// The map files are one optional group: if any of them is missing, the map is
// switched off and the forecast pages are served as usual.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import type { MapAssets, PageAssets } from "./pages/index.js";

export interface Asset {
  body: Buffer;
  type: string;
  /** Precompressed bodies by Content-Encoding name. Empty for files that are already compressed. */
  encodings: Record<string, Buffer>;
  /** The server answers Range requests for this file. */
  ranges?: true;
}

export interface Assets {
  urls: PageAssets;
  /** The asset for an exact URL path, or undefined. Nothing else on disk is reachable. */
  lookup(pathname: string): Asset | undefined;
}

export interface LoadOptions {
  /** Folder holding the map GeoJSON files. Defaults to `../data/map` beside the assets folder. */
  mapDataDir?: string;
  /** Where the "map is off" line goes. Defaults to stderr. */
  log?: (line: string) => void;
}

const GEIST_TOKEN = "__FONT_GEIST__";
const SERIF_TOKEN = "__FONT_SERIF__";
const BASEMAP_TOKEN = "__BASEMAP__";
const GLYPHS_TOKEN = "__GLYPHS__";

const JS_TYPE = "text/javascript; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

/** The live wind field. Served by the server from the cache, not from disk. */
export const WIND_URL = "/data/wind.json";

/** The MapLibre files that import each other by relative name, so they share one folder. */
const MAPLIBRE_MODULES = ["maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs"] as const;

function readSource(dir: string, name: string): Buffer {
  const path = join(dir, name);
  try {
    return readFileSync(path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read asset ${path}: ${reason}`);
  }
}

/** First 8 hex characters of the SHA-256 of the bytes. */
function hashOf(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 8);
}

/** First 8 hex characters of a SHA-256 over named files, so a rename changes it too. */
function hashOfFiles(files: ReadonlyArray<readonly [string, Buffer]>): string {
  const hash = createHash("sha256");
  for (const [name, body] of files) {
    hash.update(`${name}\0${body.length}\0`);
    hash.update(body);
  }
  return hash.digest("hex").slice(0, 8);
}

/**
 * Brotli quality 5 and gzip level 6. Over every text asset, map included, that
 * takes about 150 ms at startup, where quality 10 to 11 blocked the process for
 * several seconds on every start for about 15% fewer bytes. The hashed assets
 * are cached at the edge for a year, so those bytes are paid rarely.
 */
function compressed(body: Buffer, compress: boolean): Record<string, Buffer> {
  if (!compress) return {};
  return {
    br: brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }),
    gzip: gzipSync(body, { level: 6 }),
  };
}

interface MapGroup {
  urls: MapAssets;
  table: Map<string, Asset>;
  /** URL folder of the glyphs, without a trailing slash. */
  glyphPrefix: string;
  /** Glyph files by `<font>/<range>.pbf`, exactly as on disk. */
  glyphs: Map<string, Asset>;
}

/**
 * Reads the whole map group. Returns the names of every file it could not
 * read instead of throwing, so the caller can log them on one line.
 */
function loadMapGroup(assetsDir: string, dataDir: string): MapGroup | { missing: string[] } {
  const missing: string[] = [];
  const read = (dir: string, name: string, label = join(dir, name)): Buffer | undefined => {
    try {
      return readFileSync(join(dir, name));
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String(err.code) : String(err);
      missing.push(`${label} (${code})`);
      return undefined;
    }
  };

  const modules = MAPLIBRE_MODULES.map((name) => [name, read(join(assetsDir, "vendor/maplibre-gl"), name)] as const);
  const maplibreCss = read(join(assetsDir, "vendor/maplibre-gl"), "maplibre-gl.css");
  const pmtiles = read(join(assetsDir, "vendor/pmtiles"), "pmtiles.js");
  const client = read(assetsDir, "map.js");
  const basemap = read(assetsDir, "map/basemap.pmtiles");
  const styleLight = read(assetsDir, "map/style-light.json");
  const styleDark = read(assetsDir, "map/style-dark.json");
  const staticSvg = read(assetsDir, "map/nearshore.svg");
  const bathymetry = read(dataDir, "bathymetry.geojson");
  const land = read(dataDir, "land.geojson");
  const shore = read(dataDir, "shore.geojson");

  // Every .pbf one level below the glyph folder, as `<font>/<range>.pbf`.
  const glyphDir = join(assetsDir, "map/glyphs");
  const glyphFiles: Array<[string, Buffer]> = [];
  try {
    for (const font of readdirSync(glyphDir, { withFileTypes: true })) {
      if (!font.isDirectory()) continue;
      for (const file of readdirSync(join(glyphDir, font.name), { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".pbf")) continue;
        const body = read(glyphDir, join(font.name, file.name));
        if (body !== undefined) glyphFiles.push([`${font.name}/${file.name}`, body]);
      }
    }
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : String(err);
    missing.push(`${glyphDir} (${code})`);
  }
  if (glyphFiles.length === 0 && !missing.some((m) => m.startsWith(glyphDir))) {
    missing.push(`${glyphDir} (no .pbf files)`);
  }

  if (
    missing.length > 0 ||
    maplibreCss === undefined ||
    pmtiles === undefined ||
    client === undefined ||
    basemap === undefined ||
    styleLight === undefined ||
    styleDark === undefined ||
    staticSvg === undefined ||
    bathymetry === undefined ||
    land === undefined ||
    shore === undefined
  ) {
    return { missing };
  }

  const table = new Map<string, Asset>();
  const add = (url: string, body: Buffer, type: string, compress: boolean): string => {
    table.set(url, { body, type, encodings: compressed(body, compress) });
    return url;
  };

  // The three modules keep their names inside one folder named by a hash over all three.
  const moduleFiles: Array<[string, Buffer]> = [];
  for (const [name, body] of modules) if (body !== undefined) moduleFiles.push([name, body]);
  const maplibreDir = `/assets/vendor/maplibre-gl.${hashOfFiles(moduleFiles)}`;
  for (const [name, body] of moduleFiles) add(`${maplibreDir}/${name}`, body, JS_TYPE, true);

  // Sort so the folder hash does not depend on the order readdir returns.
  glyphFiles.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const glyphPrefix = `/assets/map/glyphs.${hashOfFiles(glyphFiles)}`;
  const glyphs = new Map<string, Asset>();
  for (const [name, body] of glyphFiles) glyphs.set(name, { body, type: "application/x-protobuf", encodings: {} });

  const basemapUrl = `/assets/map/basemap.${hashOf(basemap)}.pmtiles`;
  table.set(basemapUrl, { body: basemap, type: "application/octet-stream", encodings: {}, ranges: true });

  const style = (name: string, source: Buffer): string => {
    const text = source.toString("utf8");
    for (const token of [BASEMAP_TOKEN, GLYPHS_TOKEN]) {
      if (!text.includes(token)) missing.push(`${join(assetsDir, `map/${name}.json`)} (no ${token} placeholder)`);
    }
    const body = Buffer.from(text.replaceAll(BASEMAP_TOKEN, basemapUrl).replaceAll(GLYPHS_TOKEN, glyphPrefix), "utf8");
    return add(`/assets/map/${name}.${hashOf(body)}.json`, body, JSON_TYPE, true);
  };

  const urls: MapAssets = {
    maplibre: `${maplibreDir}/maplibre-gl.mjs`,
    maplibreCss: add(`/assets/vendor/maplibre-gl.${hashOf(maplibreCss)}.css`, maplibreCss, "text/css; charset=utf-8", true),
    pmtiles: add(`/assets/vendor/pmtiles.${hashOf(pmtiles)}.js`, pmtiles, JS_TYPE, true),
    client: add(`/assets/map.${hashOf(client)}.js`, client, JS_TYPE, true),
    styleLight: style("style-light", styleLight),
    styleDark: style("style-dark", styleDark),
    staticSvg: add(`/assets/map/nearshore.${hashOf(staticSvg)}.svg`, staticSvg, "image/svg+xml", true),
    bathymetry: add(`/assets/map/data/bathymetry.${hashOf(bathymetry)}.geojson`, bathymetry, "application/geo+json", true),
    land: add(`/assets/map/data/land.${hashOf(land)}.geojson`, land, "application/geo+json", true),
    shore: add(`/assets/map/data/shore.${hashOf(shore)}.geojson`, shore, "application/geo+json", true),
    wind: WIND_URL,
  };
  if (missing.length > 0) return { missing };
  return { urls, table, glyphPrefix, glyphs };
}

export function loadAssets(dir: string, opts: LoadOptions = {}): Assets {
  const log = opts.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const table = new Map<string, Asset>();

  const add = (url: string, body: Buffer, type: string, compress: boolean): void => {
    table.set(url, { body, type, encodings: compressed(body, compress) });
  };

  // Fonts first: the stylesheet names their final URLs, so its hash depends on theirs.
  const geist = readSource(dir, "fonts/geist-latin-wght.woff2");
  const serif = readSource(dir, "fonts/instrument-serif-latin-400.woff2");
  const geistUrl = `/assets/fonts/geist-latin-wght.${hashOf(geist)}.woff2`;
  const serifUrl = `/assets/fonts/instrument-serif-latin-400.${hashOf(serif)}.woff2`;
  add(geistUrl, geist, "font/woff2", false);
  add(serifUrl, serif, "font/woff2", false);

  const cssText = readSource(dir, "site.css")
    .toString("utf8")
    .replaceAll(GEIST_TOKEN, geistUrl)
    .replaceAll(SERIF_TOKEN, serifUrl);
  const css = Buffer.from(cssText, "utf8");
  const cssUrl = `/assets/site.${hashOf(css)}.css`;
  add(cssUrl, css, "text/css; charset=utf-8", true);

  const js = readSource(dir, "scrub.js");
  const jsUrl = `/assets/scrub.${hashOf(js)}.js`;
  add(jsUrl, js, JS_TYPE, true);

  const urls: PageAssets = { css: cssUrl, js: jsUrl, geist: geistUrl, serif: serifUrl };

  const map = loadMapGroup(dir, opts.mapDataDir ?? join(dir, "..", "data", "map"));
  if ("missing" in map) {
    log(`[assets] map is off, cannot read: ${map.missing.join(", ")}`);
    return { urls, lookup: (pathname) => table.get(pathname) };
  }

  for (const [url, asset] of map.table) table.set(url, asset);
  urls.map = map.urls;
  const glyphStart = `${map.glyphPrefix}/`;

  return {
    urls,
    lookup: (pathname) => {
      const exact = table.get(pathname);
      if (exact !== undefined || !pathname.startsWith(glyphStart)) return exact;
      // Font folder names contain spaces, which arrive as %20. Only an exact
      // `<font>/<range>.pbf` name read from disk matches, so ".." cannot climb out.
      let name: string;
      try {
        name = decodeURIComponent(pathname.slice(glyphStart.length));
      } catch (err) {
        if (err instanceof URIError) return undefined; // A malformed escape is a 404.
        throw err;
      }
      return map.glyphs.get(name);
    },
  };
}
