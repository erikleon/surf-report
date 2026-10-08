import { describe, expect, it } from "vitest";
import { renderDay, renderMap, renderWeek, type MapAssets, type PageContext } from "../../src/pages/index.js";
import { count, ctx, freshModel } from "./helpers.js";

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

const model = freshModel();
const DATE = "2026-10-04";
const html = renderDay(model, withMap, DATE) ?? "";

describe("day page", () => {
  it("is a full document for that date, with Week as the current nav item", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="https://surf.example.test/day/${DATE}">`);
    expect(html).toContain('<a href="/week" aria-current="page">Week</a>');
  });

  it("returns nothing for a date the forecast does not cover", () => {
    expect(renderDay(model, withMap, "2030-01-01")).toBeUndefined();
  });

  it("shows the chart, an hourly table and the map", () => {
    expect(html).toContain('<svg viewBox="0 0 960');
    expect(html).toContain("24 hours");
    const table = html.split('<table class="week')[1]?.split("</table>")[0] ?? "";
    expect(count(table, /<th scope="row">/g)).toBe(model.hours.filter((h) => h.time.startsWith(DATE)).length);
    expect(html).toContain('<section class="map"');
    expect(html).toContain(`data-day="${DATE}"`);
  });

  it("starts the readout at the start of the day, not at now", () => {
    expect(html).not.toContain('<span class="ro-k">Now</span>');
    expect(html).toContain("Start of day");
  });

  it("links to the neighbouring days that have a forecast", () => {
    expect(html).toContain('href="/day/2026-10-05" rel="next"');
    expect(html).toContain('href="/day/2026-10-03" rel="prev"');
    const first = renderDay(model, withMap, "2026-10-03") ?? "";
    expect(first).not.toContain('rel="prev"');
  });

  it("still renders without the map files", () => {
    const bare = renderDay(model, ctx, DATE) ?? "";
    expect(bare).toContain('<svg viewBox="0 0 960');
    expect(bare).not.toContain("map-canvas");
  });
});

describe("links to the day page", () => {
  it("makes every day heading on the week page a link", () => {
    const week = renderWeek(model, ctx);
    expect(week).toContain('<h2 id="h-2026-10-04"><a href="/day/2026-10-04">');
  });
});

describe("map section order", () => {
  it("puts the live map before the static map", () => {
    const map = renderMap(model, withMap);
    expect(map.indexOf('class="map-canvas"')).toBeGreaterThan(-1);
    expect(map.indexOf('class="map-canvas"')).toBeLessThan(map.indexOf('class="map-fallback"'));
  });
});
