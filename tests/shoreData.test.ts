import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// data/map/shore.geojson is built by scripts/map/build-shore.mjs from OpenStreetMap.
// These tests read the committed file; they make no network requests.

const DIR = join(import.meta.dirname, "..", "data", "map");
const SHORE = join(DIR, "shore.geojson");
const SOURCES = join(DIR, "SOURCES-osm.json");

const BOX = { west: -73.96, south: 40.545, east: -73.76, north: 40.605 };
const KINDS = ["jetty", "pier", "boardwalk", "street-end"] as const;
const MAX_BYTES = 300 * 1024;

type Position = [number, number];
interface Feature {
  type: string;
  properties: { kind: string; name?: string; osmId: string };
  geometry: { type: string; coordinates: unknown };
}
interface Collection {
  type: string;
  features: Feature[];
}

const shore = JSON.parse(readFileSync(SHORE, "utf8")) as Collection;

function positions(geometry: Feature["geometry"]): Position[] {
  const c = geometry.coordinates;
  switch (geometry.type) {
    case "Point":
      return [c as Position];
    case "LineString":
      return c as Position[];
    case "MultiLineString":
    case "Polygon":
      return (c as Position[][]).flat();
    default:
      throw new Error(`unexpected geometry type ${geometry.type}`);
  }
}

const ofKind = (kind: string) => shore.features.filter((f) => f.properties.kind === kind);

describe("shore.geojson", () => {
  it("is a FeatureCollection of features with geometry", () => {
    expect(shore.type).toBe("FeatureCollection");
    expect(shore.features.length).toBeGreaterThan(0);
    for (const f of shore.features) {
      expect(f.type).toBe("Feature");
      expect(positions(f.geometry).length).toBeGreaterThan(0);
    }
  });

  it("keeps every coordinate inside the Rockaway box with at most 6 decimals", () => {
    for (const f of shore.features) {
      for (const [lon, lat] of positions(f.geometry)) {
        expect(lon).toBeGreaterThanOrEqual(BOX.west);
        expect(lon).toBeLessThanOrEqual(BOX.east);
        expect(lat).toBeGreaterThanOrEqual(BOX.south);
        expect(lat).toBeLessThanOrEqual(BOX.north);
        expect(Math.round(lon * 1e6) / 1e6).toBe(lon);
        expect(Math.round(lat * 1e6) / 1e6).toBe(lat);
      }
    }
  });

  it("gives every feature a known kind and an OSM way id", () => {
    for (const f of shore.features) {
      expect(KINDS).toContain(f.properties.kind);
      expect(f.properties.osmId).toMatch(/^way\/\d+$/);
    }
  });

  // The 2026-10 extract has 54 jetties and 141 street ends. The minimums leave
  // room for OSM edits but catch a query that lost most of the data.
  it("has the jetties and street ends Rockaway is known for", () => {
    expect(ofKind("jetty").length).toBeGreaterThanOrEqual(40);
    expect(ofKind("street-end").length).toBeGreaterThanOrEqual(100);
    expect(ofKind("boardwalk").length).toBeGreaterThanOrEqual(1);
  });

  it("draws street ends as points named in 'Beach 90th St' form", () => {
    for (const f of ofKind("street-end")) {
      expect(f.geometry.type).toBe("Point");
      expect(f.properties.name).toMatch(/^Beach \d+(st|nd|rd|th) St$/);
    }
    const names = ofKind("street-end").map((f) => f.properties.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["Beach 90th St", "Beach 97th St", "Beach 116th St"]));
  });

  it("uses the right ordinal suffix", () => {
    for (const f of ofKind("street-end")) {
      const m = /^Beach (\d+)(st|nd|rd|th) St$/.exec(f.properties.name ?? "");
      expect(m).not.toBeNull();
      const n = Number(m![1]);
      const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
      expect(m![2]).toBe(suffix);
    }
  });

  it("has no duplicate osmId within a kind", () => {
    for (const kind of KINDS) {
      const ids = ofKind(kind).map((f) => f.properties.osmId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("is sorted by kind, then osmId", () => {
    const key = (f: Feature) => [KINDS.indexOf(f.properties.kind as (typeof KINDS)[number]), Number(f.properties.osmId.split("/")[1])];
    const keys = shore.features.map(key);
    const sorted = [...keys].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(keys).toEqual(sorted);
  });

  it(`stays under ${MAX_BYTES / 1024} KB`, () => {
    expect(statSync(SHORE).size).toBeLessThan(MAX_BYTES);
  });
});

describe("SOURCES-osm.json", () => {
  const sources = JSON.parse(readFileSync(SOURCES, "utf8")) as Record<string, unknown>[];

  it("has one OpenStreetMap entry with every field", () => {
    expect(sources).toHaveLength(1);
    const osm = sources[0]!;
    expect(Object.keys(osm).sort()).toEqual(
      ["attribution", "id", "license", "name", "notes", "retrieved", "surveyDates", "url", "verticalDatum", "version"].sort(),
    );
    expect(osm.id).toBe("osm");
    expect(osm.name).toBe("OpenStreetMap");
    expect(osm.license).toBe("ODbL 1.0");
    expect(osm.attribution).toBe("© OpenStreetMap contributors");
    expect(osm.url).toMatch(/^https:\/\//);
    expect(osm.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(osm.version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(osm.surveyDates).toBeNull();
    expect(osm.verticalDatum).toBeNull();
    expect(typeof osm.notes).toBe("string");
  });
});
