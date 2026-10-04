import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checks the committed map data built by scripts/map/build-bathymetry.sh.
const DIR = join(import.meta.dirname, "..", "data", "map");

const BOX = { west: -73.96, east: -73.76, south: 40.545, north: 40.605 };
// About 10 m, for coordinates that land on the box edge after rounding.
const MARGIN = 0.0001;
const DEPTHS_FT = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 30, 40, 50, 60];

interface Feature {
  type: string;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}
interface FeatureCollection {
  type: string;
  features: Feature[];
}

function load(name: string): FeatureCollection {
  return JSON.parse(readFileSync(join(DIR, name), "utf8")) as FeatureCollection;
}

// Every [lon, lat] position in a nested coordinates array.
function positions(coords: unknown): number[][] {
  if (Array.isArray(coords) && typeof coords[0] === "number") return [coords as number[]];
  if (!Array.isArray(coords)) throw new Error("coordinates is not an array");
  return coords.flatMap((c) => positions(c));
}

function decimals(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function expectValidCollection(fc: FeatureCollection, types: string[]): void {
  expect(fc.type).toBe("FeatureCollection");
  expect(fc.features.length).toBeGreaterThan(0);
  for (const f of fc.features) {
    expect(f.type).toBe("Feature");
    expect(f.geometry).not.toBeNull();
    expect(types).toContain(f.geometry!.type);
    const pts = positions(f.geometry!.coordinates);
    expect(pts.length).toBeGreaterThan(1);
    // Collect bad positions and assert once: one expect per point is too slow
    // for the 25,000 points in the contour file.
    const bad = pts.filter((p) => !goodPosition(p));
    expect(bad.slice(0, 5)).toEqual([]);
  }
}

function goodPosition(p: number[]): boolean {
  if (p.length !== 2) return false;
  const [lon, lat] = p as [number, number];
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= BOX.west - MARGIN &&
    lon <= BOX.east + MARGIN &&
    lat >= BOX.south - MARGIN &&
    lat <= BOX.north + MARGIN &&
    decimals(lon) <= 6 &&
    decimals(lat) <= 6
  );
}

describe("data/map/bathymetry.geojson", () => {
  const fc = load("bathymetry.geojson");

  it("is a FeatureCollection of lines inside the box", () => {
    expectValidCollection(fc, ["LineString", "MultiLineString"]);
  });

  it("gives every contour a depth in feet from the intended set", () => {
    for (const f of fc.features) {
      const depth = f.properties?.["depthFt"];
      expect(typeof depth).toBe("number");
      expect(depth).toBeGreaterThan(0);
      expect(DEPTHS_FT).toContain(depth);
    }
  });

  it("has the shallow surf-zone contours", () => {
    const depths = new Set(fc.features.map((f) => f.properties?.["depthFt"]));
    for (const d of [2, 4, 6, 8, 10, 20]) expect(depths).toContain(d);
  });

  it("stays under 600 KB", () => {
    expect(statSync(join(DIR, "bathymetry.geojson")).size).toBeLessThan(600 * 1024);
  });
});

describe("data/map/land.geojson", () => {
  const fc = load("land.geojson");

  it("is a FeatureCollection of polygons inside the box", () => {
    expectValidCollection(fc, ["Polygon", "MultiPolygon"]);
  });

  it("marks every feature as land", () => {
    for (const f of fc.features) expect(f.properties?.["kind"]).toBe("land");
  });

  it("stays under 200 KB", () => {
    expect(statSync(join(DIR, "land.geojson")).size).toBeLessThan(200 * 1024);
  });
});

describe("data/map/SOURCES.json", () => {
  const sources = JSON.parse(readFileSync(join(DIR, "SOURCES.json"), "utf8")) as unknown;
  const FIELDS = [
    "id",
    "name",
    "url",
    "license",
    "attribution",
    "retrieved",
    "version",
    "surveyDates",
    "verticalDatum",
    "notes",
  ];

  it("is an array of entries with every field filled in", () => {
    expect(Array.isArray(sources)).toBe(true);
    const list = sources as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      for (const field of FIELDS) {
        expect(typeof entry[field], `${String(entry["id"])}.${field}`).toBe("string");
        expect((entry[field] as string).trim().length).toBeGreaterThan(0);
      }
      expect(entry["retrieved"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry["url"]).toMatch(/^https:\/\//);
    }
  });

  it("has unique ids", () => {
    const ids = (sources as { id: string }[]).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists the terrain sources the contours are built from", () => {
    const ids = (sources as { id: string }[]).map((s) => s.id);
    expect(ids).toContain("noaa-bluetopo");
    expect(ids).toContain("ncei-cudem-ninth");
  });
});
