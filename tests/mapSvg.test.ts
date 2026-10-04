import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION,
  CAPTION_DATUM,
  CAPTION_NAV,
  CAPTION_SNAPSHOT,
  LABEL_MIN_GAP,
  NEARSHORE_FRAME,
  factsModule,
  frameBounds,
  nearshoreFacts,
  placeStreetLabels,
  projector,
  renderNearshoreSvg,
  surveySummary,
  type Feature,
  type FeatureCollection,
  type Frame,
  type MapSource,
  type NearshoreInput,
} from "../src/mapSvg.js";

const ROOT = join(import.meta.dirname, "..");

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

const SOURCE: MapSource = {
  id: "test",
  name: "Test survey",
  url: "https://example.test/",
  license: "Public domain",
  attribution: "Test",
  retrieved: "2026-10-04",
  version: "1",
  surveyDates: "60% Survey A, 2021-04-02 to 2021-04-20; 40% Survey B, 2012-08 to 2012-09.",
  verticalDatum: null,
  notes: "",
};

/** Synthetic data placed by screen position, so the test reads in picture terms. */
function synthetic(): NearshoreInput {
  const p = projector(NEARSHORE_FRAME);
  const at = (x: number, y: number): number[] => p.lonLat(x, y).map((n) => Math.round(n * 1e6) / 1e6);
  const line = (y: number): number[][] => [at(20, y), at(300, y + 1), at(600, y), at(980, y + 2)];
  return {
    // A strip of land across the middle, from y 40 to 80.
    land: fc([
      {
        type: "Feature",
        properties: { kind: "land" },
        geometry: { type: "Polygon", coordinates: [[at(5, 40), at(995, 40), at(995, 80), at(5, 80), at(5, 40)]] },
      },
    ]),
    bathymetry: fc([
      // Ocean side, below the land.
      { type: "Feature", properties: { depthFt: 2 }, geometry: { type: "MultiLineString", coordinates: [line(90)] } },
      { type: "Feature", properties: { depthFt: 10 }, geometry: { type: "MultiLineString", coordinates: [line(130)] } },
      { type: "Feature", properties: { depthFt: 20 }, geometry: { type: "MultiLineString", coordinates: [line(180)] } },
      // Bay side, above the land: must not be drawn.
      { type: "Feature", properties: { depthFt: 6 }, geometry: { type: "MultiLineString", coordinates: [line(20)] } },
    ]),
    shore: fc([
      { type: "Feature", properties: { kind: "jetty" }, geometry: { type: "LineString", coordinates: [at(400, 80), at(400, 95)] } },
      { type: "Feature", properties: { kind: "boardwalk" }, geometry: { type: "LineString", coordinates: [at(100, 75), at(900, 75)] } },
      ...[60, 67, 70, 80, 90, 100, 110, 116, 120].map((n, i): Feature => ({
        type: "Feature",
        properties: { kind: "street-end", name: `Beach ${n}th St` },
        geometry: { type: "Point", coordinates: at(850 - i * 70, 75) },
      })),
      // Far from the boardwalk: inland, never labelled.
      { type: "Feature", properties: { kind: "street-end", name: "Beach 130th St" }, geometry: { type: "Point", coordinates: at(150, 45) } },
    ]),
    sources: [SOURCE],
  };
}

/** Every absolute point in the path data of the SVG. */
function pathPoints(svg: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const sub of (m[1] as string).split("M").filter(Boolean)) {
      const [abs, rel = ""] = sub.replace(/z$/, "").split("l");
      const nums = (s: string): number[] => (s.match(/-?[\d.]+/g) ?? []).map(Number);
      const start = nums(abs as string);
      // Paths made only of h and v steps (the scale bar, legend keys) are not geometry.
      if (/[hv]/.test(abs as string)) continue;
      let x = start[0] as number;
      let y = start[1] as number;
      out.push([x, y]);
      const d = nums(rel);
      for (let i = 0; i + 1 < d.length; i += 2) {
        x += d[i] as number;
        y += d[i + 1] as number;
        out.push([x, y]);
      }
    }
  }
  return out;
}

describe("projector", () => {
  it.each([
    ["north up", { ...NEARSHORE_FRAME, rotateDeg: 0 }],
    ["turned 17 degrees", NEARSHORE_FRAME],
  ] as Array<[string, Frame]>)("keeps east to the right and north up, %s", (_name, frame) => {
    const p = projector(frame);
    const [x0, y0] = p.xy(frame.lon, frame.lat);
    const [xe, ye] = p.xy(frame.lon + 0.01, frame.lat);
    const [xn, yn] = p.xy(frame.lon, frame.lat + 0.01);
    expect(xe).toBeGreaterThan(x0);
    expect(yn).toBeLessThan(y0);
    if (frame.rotateDeg === 0) {
      expect(ye).toBeCloseTo(y0, 6);
      expect(xn).toBeCloseTo(x0, 6);
    }
  });

  it("keeps a metre the same length east-west and north-south", () => {
    const p = projector({ ...NEARSHORE_FRAME, rotateDeg: 0 });
    const k = Math.cos((NEARSHORE_FRAME.lat * Math.PI) / 180);
    const [x0] = p.xy(-73.85, 40.572);
    const [x1] = p.xy(-73.85 + 0.001 / k, 40.572);
    const [, y0] = p.xy(-73.85, 40.572);
    const [, y1] = p.xy(-73.85, 40.573);
    expect(x1 - x0).toBeCloseTo(y0 - y1, 6);
  });

  it("round-trips through lonLat", () => {
    const p = projector(NEARSHORE_FRAME);
    const [lon, lat] = p.lonLat(...p.xy(-73.81, 40.585));
    expect(lon).toBeCloseTo(-73.81, 9);
    expect(lat).toBeCloseTo(40.585, 9);
  });

  it("gives the bounds around the turned frame", () => {
    const [w, s, e, n] = frameBounds(NEARSHORE_FRAME);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    expect(w).toBeLessThan(NEARSHORE_FRAME.lon);
    expect(e).toBeGreaterThan(NEARSHORE_FRAME.lon);
  });
});

describe("renderNearshoreSvg with synthetic data", () => {
  const input = synthetic();
  const svg = renderNearshoreSvg(input);
  const p = projector(NEARSHORE_FRAME);

  it("is deterministic", () => {
    expect(renderNearshoreSvg(synthetic())).toBe(svg);
  });

  it("has no NaN, Infinity or undefined", () => {
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("has a fixed viewBox and a title and description", () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1000 [\d.]+"/);
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
  });

  it("puts every coordinate inside the viewBox with at most one decimal", () => {
    const pts = pathPoints(svg);
    expect(pts.length).toBeGreaterThan(20);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(p.height);
    }
    const coords = [...svg.matchAll(/ (?:d|x|y|cx|cy|width|height)="([^"]+)"/g)].map((m) => m[1]).join(" ");
    for (const n of coords.match(/-?\d+\.\d+/g) ?? []) expect(n.split(".")[1]?.length, n).toBe(1);
  });

  it("draws the ocean contours below the land and drops the bay one", () => {
    const facts = nearshoreFacts(input);
    expect(facts.depthsFt).toEqual([2, 10, 20]);
    expect(svg).toContain(">10 ft</text>");
    expect(svg).not.toContain(">6 ft</text>");
  });

  it("labels the stretch ends first and keeps labels apart", () => {
    const facts = nearshoreFacts(input);
    expect(facts.streetLabels).toContain(67);
    expect(facts.streetLabels).toContain(116);
    expect(facts.streetLabels).not.toContain(130);
    expect(svg).toContain(">B67</text>");
    expect(facts.jetties).toBe(1);
  });

  it("has the legend, the caption and the attribution", () => {
    expect(svg).toContain(">Depth, ft</text>");
    expect(svg).toContain(CAPTION_DATUM);
    expect(svg).toContain(CAPTION_NAV);
    expect(svg).toContain(CAPTION_SNAPSHOT.replace("'", "&#39;"));
    expect(svg).toContain(ATTRIBUTION);
    expect(svg).toContain("Surveyed Apr 2021 (60% of the surf zone); older parts 2012");
    expect(svg).toContain(">N</text>");
    expect(svg).toMatch(/>[\d,]+ ft<\/text>/);
  });

  it("uses no amber and no good or poor colour", () => {
    for (const c of ["#c98a12", "#287052", "#a63d40", "#52b38a", "#e07a7d"]) expect(svg.toLowerCase()).not.toContain(c);
  });
});

describe("placeStreetLabels", () => {
  it("never puts two labels closer than the minimum gap", () => {
    const ends = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, x: 10 + i * 4.9, y: 60 + (i % 7) }));
    const labels = placeStreetLabels(ends, 1000, 200);
    expect(labels.length).toBeGreaterThan(5);
    for (const a of labels) {
      expect(a.number % 10 === 0 || a.number === 67 || a.number === 116).toBe(true);
      for (const b of labels) {
        if (a === b) continue;
        const apart =
          a.box.x1 + LABEL_MIN_GAP <= b.box.x0 ||
          b.box.x1 + LABEL_MIN_GAP <= a.box.x0 ||
          a.box.y1 + LABEL_MIN_GAP <= b.box.y0 ||
          b.box.y1 + LABEL_MIN_GAP <= a.box.y0;
        expect(apart, `${a.text} and ${b.text}`).toBe(true);
      }
    }
    expect(labels.map((l) => l.number)).toContain(67);
    expect(labels.map((l) => l.number)).toContain(116);
  });

  it("drops a label that would leave the drawing", () => {
    expect(placeStreetLabels([{ number: 90, x: 3, y: 60 }], 1000, 200)).toEqual([]);
  });
});

describe("surveySummary", () => {
  it("falls back when no survey dates can be read", () => {
    expect(surveySummary([{ ...SOURCE, surveyDates: null }])).toBe("Survey dates are listed with the sources.");
  });
});

describe("the committed map", () => {
  const read = (name: string): unknown => JSON.parse(readFileSync(join(ROOT, "data", "map", name), "utf8"));
  const input: NearshoreInput = {
    land: read("land.geojson") as FeatureCollection,
    bathymetry: read("bathymetry.geojson") as FeatureCollection,
    shore: read("shore.geojson") as FeatureCollection,
    sources: [...(read("SOURCES.json") as MapSource[]), ...(read("SOURCES-osm.json") as MapSource[])],
  };
  const svg = renderNearshoreSvg(input);

  it("matches assets/map/nearshore.svg byte for byte (rebuild: npm run build && node scripts/map/render-svg.mjs)", () => {
    expect(readFileSync(join(ROOT, "assets", "map", "nearshore.svg"), "utf8")).toBe(svg);
  });

  it("matches src/mapFacts.ts byte for byte", () => {
    expect(readFileSync(join(ROOT, "src", "mapFacts.ts"), "utf8")).toBe(factsModule(nearshoreFacts(input)));
  });

  it("stays under 250 KB", () => {
    expect(Buffer.byteLength(svg)).toBeLessThan(250 * 1024);
  });

  it("has a title, a description, the attribution and the survey dates", () => {
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
    expect(svg).toContain("NOAA");
    expect(svg).toContain("© OpenStreetMap contributors");
    expect(svg).toContain("ODbL");
    expect(svg).toContain("May 2023");
    expect(svg).toContain("Not for navigation");
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("labels both ends of the stretch and a readable number of streets", () => {
    const facts = nearshoreFacts(input);
    expect(facts.streetLabels).toContain(67);
    expect(facts.streetLabels).toContain(116);
    expect(facts.streetLabels.length).toBeGreaterThanOrEqual(5);
    expect(facts.streetLabels.length).toBeLessThanOrEqual(15);
    expect(facts.jetties).toBeGreaterThan(30);
  });
});
