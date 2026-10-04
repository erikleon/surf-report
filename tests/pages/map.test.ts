import { describe, expect, it } from "vitest";
import { MAP_FACTS } from "../../src/mapFacts.js";
import { buildModel } from "../../src/model.js";
import { renderMap, type MapAssets, type PageContext } from "../../src/pages/index.js";
import { MIN, NOW, count, ctx, freshModel, snap } from "./helpers.js";

const MAP: MapAssets = {
  maplibre: "/assets/vendor/maplibre-gl.aaa/maplibre-gl.mjs",
  maplibreCss: "/assets/vendor/maplibre-gl.aaa/maplibre-gl.css",
  pmtiles: "/assets/vendor/pmtiles.bbb.js",
  client: "/assets/map.ccc.js",
  styleLight: "/assets/map/style-light.ddd.json",
  styleDark: "/assets/map/style-dark.eee.json",
  staticSvg: "/assets/map/nearshore.fff.svg",
  bathymetry: "/assets/map/bathymetry.ggg.geojson",
  land: "/assets/map/land.hhh.geojson",
  shore: "/assets/map/shore.iii.geojson",
  wind: "/map/wind.json",
};

const withMap: PageContext = { ...ctx, assets: { ...ctx.assets, map: MAP } };
const html = renderMap(freshModel(), withMap);
const bare = renderMap(freshModel(), ctx);

describe("map page with the map files", () => {
  it("is a full document with one h1 and the canonical link", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toContain('<link rel="canonical" href="https://surf.example.test/map">');
    expect(html).toContain("<title>Map - Rockaway surf report</title>");
  });

  it("marks Map as the current nav item", () => {
    const nav = html.split("<nav")[1]?.split("</nav>")[0] ?? "";
    expect(nav).toContain('<a href="/map" aria-current="page">Map</a>');
    expect(count(nav, /aria-current/g)).toBe(1);
  });

  it("renders the map section per the client contract", () => {
    expect(html).toContain('<section class="map" aria-label="Rockaway nearshore map">');
    const canvas = /<div class="map-canvas" id="map-canvas"([^>]*)><\/div>/.exec(html)?.[1] ?? "";
    const attrs: Record<string, string> = {
      "data-style-light": MAP.styleLight,
      "data-style-dark": MAP.styleDark,
      "data-maplibre": MAP.maplibre,
      "data-bathymetry": MAP.bathymetry,
      "data-land": MAP.land,
      "data-shore": MAP.shore,
      "data-wind": MAP.wind,
      "data-bounds": MAP_FACTS.bounds.join(","),
    };
    for (const [k, v] of Object.entries(attrs)) expect(canvas).toContain(` ${k}="${v}"`);
    const [w, s, e, n] = (/data-bounds="([^"]+)"/.exec(canvas)?.[1] ?? "").split(",").map(Number);
    expect(w).toBeLessThan(e as number);
    expect(s).toBeLessThan(n as number);
  });

  it("has the static map as the fallback figure with alt text and a caption", () => {
    const figure = html.split('<figure class="map-fallback">')[1]?.split("</figure>")[0] ?? "";
    expect(figure).toMatch(new RegExp(`<img src="${MAP.staticSvg}" alt="[^"]{80,}" width="1000" height="[\\d.]+">`));
    expect(figure).toContain("<figcaption>");
    expect(figure).toContain("Depths in feet below mean lower low water.");
    expect(figure).toContain("Not for navigation.");
    expect(figure).toContain("May 2023");
    expect(figure).toContain("this is a snapshot, not today&#39;s bottom.");
  });

  it("credits OpenStreetMap and NOAA next to the map", () => {
    const section = html.split('<section class="map"')[1]?.split("</section>")[0] ?? "";
    expect(section).toContain("&copy; OpenStreetMap contributors");
    expect(section).toContain("https://www.openstreetmap.org/copyright");
    expect(section).toContain("NOAA");
  });

  it("loads the MapLibre stylesheet, the pmtiles script deferred and the client module", () => {
    expect(html).toContain(`<link rel="stylesheet" href="${MAP.maplibreCss}">`);
    expect(html).toContain(`<script src="${MAP.pmtiles}" defer></script>`);
    expect(html).toContain(`<script type="module" src="${MAP.client}"></script>`);
    expect(count(html, /<script\b/g)).toBe(2);
    // MapLibre's stylesheet comes first so the site's rules win.
    expect(html.indexOf(MAP.maplibreCss)).toBeLessThan(html.indexOf(ctx.assets.css));
  });
});

describe.each([
  ["with the map", html],
  ["without the map", bare],
])("map page %s", (_name, page) => {
  it("has no inline script, style, style attribute or event handler", () => {
    expect(page).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(page).not.toMatch(/<style\b/);
    expect(page).not.toMatch(/<[^>]*\sstyle\s*=/i);
    expect(page).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  });

  it("makes no request to another origin", () => {
    for (const tag of page.match(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/g) ?? []) {
      if (/rel="canonical"/.test(tag)) continue;
      const url = /\s(?:src|href)="([^"]*)"/.exec(tag)?.[1];
      if (url !== undefined) expect(url, tag).toMatch(/^\/(?!\/)/);
    }
  });

  it("lists what is on the map in text", () => {
    expect(page).toContain("What's on the map");
    expect(page).toContain(`${MAP_FACTS.jetties} rock jetties`);
    expect(page).toContain("Beach 67");
    expect(page).toContain("Beach 116");
    expect(page).toContain("2, 4, 6");
  });

  it("lists every map source with its license, retrieved date and survey dates", () => {
    const sources = page.split('id="h-map-sources"')[1] ?? "";
    for (const s of MAP_FACTS.sources) {
      expect(sources).toContain(s.name);
      expect(sources).toContain("Retrieved 2026-10-04");
    }
    expect(sources).toContain("ODbL 1.0");
    expect(sources).toContain("Public domain (U.S. Government work)");
    expect(sources).toContain("USGS multibeam E00998, 2023-05-06 to 2023-05-16");
  });

  it("has no em dash or emoji", () => {
    expect(page).not.toContain("—");
    expect(page).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("map page without the map files", () => {
  it("says the map is unavailable and loads no map files", () => {
    expect(bare).toContain("The map is unavailable right now.");
    expect(bare).not.toContain("<script");
    expect(bare).not.toContain("map-canvas");
    expect(bare).not.toContain("<img");
    expect(bare).not.toContain("maplibre");
  });
});

describe("wind on the map page", () => {
  it("shows the wind now as text with offshore, onshore or cross shore", () => {
    const wind = html.split('id="h-wind"')[1]?.split("</section>")[0] ?? "";
    expect(wind).toMatch(/Now: <span class="num">\d+<\/span> mph from the [NESW]{1,3}, <span class="v-(off|on|cross)">(offshore|onshore|cross shore)<\/span>\./);
    expect(wind).not.toContain("stale");
    expect(wind).toContain("needs JavaScript");
  });

  it("marks old wind with the amber rule and the as-of time", () => {
    const at = NOW - 5 * MIN;
    const old = NOW - 3 * 60 * MIN;
    const page = renderMap(buildModel(snap(at, old, at), NOW), withMap);
    const wind = page.split('id="h-wind"')[1]?.split("</section>")[0] ?? "";
    expect(wind).toContain('<p class="wind-now stale">');
    expect(wind).toContain('<span class="stale-sq" aria-hidden="true"></span>as of 7:00 AM');
  });

  it("says so when no wind has loaded", () => {
    const page = renderMap(buildModel(snap(undefined, undefined, undefined), NOW), ctx);
    expect(page).toContain("Now: wind not loaded yet.");
  });
});
