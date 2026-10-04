import { describe, expect, it } from "vitest";
import {
  GRID_LATS,
  GRID_LONS,
  buildWindGridUrl,
  fetchWindGrid,
  parseWindGrid,
} from "../../src/upstream/windGrid.js";
import { failingFetch, fakeFetch, fixture } from "./fakeFetch.js";

const URL = buildWindGridUrl();
const serve = (file: string, status = 200) => fakeFetch({ [URL]: { file, status } });

interface Location {
  latitude: number;
  longitude: number;
  hourly: { time: unknown[]; wind_speed_10m: unknown[]; wind_direction_10m: unknown[] };
}
const real = (): Location[] => JSON.parse(fixture("windgrid.json")) as Location[];

describe("buildWindGridUrl", () => {
  const url = new globalThis.URL(URL);
  const params = Object.fromEntries(url.searchParams);

  it("carries the exact parameters", () => {
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.keys(params).sort()).toEqual([
      "forecast_days",
      "hourly",
      "latitude",
      "longitude",
      "timezone",
      "wind_speed_unit",
    ]);
    expect(params["hourly"]).toBe("wind_speed_10m,wind_direction_10m");
    expect(params["wind_speed_unit"]).toBe("mph");
    expect(params["timezone"]).toBe("America/New_York");
    expect(params["forecast_days"]).toBe("2");
  });

  it("lists 100 points, row by row from the south-west corner", () => {
    const lats = (params["latitude"] ?? "").split(",").map(Number);
    const lons = (params["longitude"] ?? "").split(",").map(Number);
    expect(lats).toHaveLength(100);
    expect(lons).toHaveLength(100);
    expect([lats[0], lons[0]]).toEqual([40.35, -74.15]);
    expect([lats[9], lons[9]]).toEqual([40.35, -73.55]);
    expect([lats[10], lons[10]]).toEqual([40.3944, -74.15]);
    expect([lats[99], lons[99]]).toEqual([40.75, -73.55]);
    expect(new Set(lats).size).toBe(10);
    expect(new Set(lons).size).toBe(10);
  });

  it("spaces the grid evenly over the bight", () => {
    expect(GRID_LATS).toHaveLength(10);
    expect(GRID_LONS).toHaveLength(10);
    expect(GRID_LATS[0]).toBe(40.35);
    expect(GRID_LATS[9]).toBe(40.75);
    expect(GRID_LONS[0]).toBe(-74.15);
    expect(GRID_LONS[9]).toBe(-73.55);
    for (let i = 1; i < 10; i++) {
      expect((GRID_LATS[i] ?? 0) - (GRID_LATS[i - 1] ?? 0)).toBeCloseTo(0.4 / 9, 3);
      expect((GRID_LONS[i] ?? 0) - (GRID_LONS[i - 1] ?? 0)).toBeCloseTo(0.6 / 9, 3);
    }
  });
});

describe("fetchWindGrid", () => {
  it("reads the saved live response into [time][lat][lon]", async () => {
    const result = await fetchWindGrid(serve("windgrid.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const field = result.value;
    expect(field.times).toHaveLength(48);
    expect(field.times[0]).toBe("2026-10-04T00:00");
    expect(field.lats).toEqual(GRID_LATS);
    expect(field.lons).toEqual(GRID_LONS);
    expect(field.speed).toHaveLength(48);
    expect(field.dir).toHaveLength(48);
    for (const grid of [...field.speed, ...field.dir]) {
      expect(grid).toHaveLength(10);
      for (const row of grid) expect(row).toHaveLength(10);
    }
    // Location 37 is latitude row 3, longitude column 7.
    const body = real();
    expect(field.speed[5]?.[3]?.[7]).toBe(body[37]?.hourly.wind_speed_10m[5]);
    expect(field.dir[5]?.[3]?.[7]).toBe(body[37]?.hourly.wind_direction_10m[5]);
  });

  it("keeps the requested coordinates, not the snapped ones in the response", async () => {
    const result = await fetchWindGrid(serve("windgrid.json"));
    if (!result.ok) throw new Error(result.reason);
    expect(real()[0]?.latitude).not.toBe(40.35);
    expect(result.value.lats[0]).toBe(40.35);
  });

  it("drops an hour from the whole field when one location has a null", async () => {
    const result = await fetchWindGrid(serve("windgrid-nulls.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.times).toEqual(["2026-10-04T00:00", "2026-10-04T02:00"]);
    expect(result.value.speed).toHaveLength(2);
    expect(result.value.dir).toHaveLength(2);
    const body = JSON.parse(fixture("windgrid-nulls.json")) as Location[];
    expect(result.value.speed[1]?.[3]?.[7]).toBe(body[37]?.hourly.wind_speed_10m[2]);
  });

  it("treats a non-finite direction like a null", () => {
    const body = real();
    const loc = body[0];
    if (!loc) throw new Error("empty fixture");
    loc.hourly.wind_direction_10m[0] = "NaN";
    const result = parseWindGrid(body);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.times).toHaveLength(47);
    expect(result.value.times[0]).toBe("2026-10-04T01:00");
  });

  it("fails when every hour has a null somewhere", () => {
    const body = real();
    body[99]?.hourly.wind_speed_10m.fill(null);
    expect(parseWindGrid(body)).toEqual({
      ok: false,
      reason: "wind: every hour has a missing value at some point",
    });
  });

  it("fails when a location has different hours", async () => {
    expect(await fetchWindGrid(serve("windgrid-mismatched.json"))).toEqual({
      ok: false,
      reason: "wind: location 52 has different hours from location 0",
    });
  });

  it("turns an error:true body on a 200 into its reason", async () => {
    const result = await fetchWindGrid(serve("windgrid-error.json"));
    expect(result).toEqual({
      ok: false,
      reason: "wind: Parameter 'latitude' and 'longitude' must have the same number of elements",
    });
  });

  it("reports an HTTP failure and a network failure", async () => {
    expect(await fetchWindGrid(serve("windgrid-error.json", 400))).toEqual({ ok: false, reason: "wind: HTTP 400" });
    expect(await fetchWindGrid(failingFetch)).toEqual({ ok: false, reason: "wind: network error: fetch failed" });
  });

  it("reports a body that is not JSON", async () => {
    expect(await fetchWindGrid(serve("not-json.html"))).toEqual({
      ok: false,
      reason: "wind: response was not valid JSON",
    });
  });
});

describe("parseWindGrid shape checks", () => {
  it("rejects a single-location object", () => {
    expect(parseWindGrid(real()[0])).toEqual({ ok: false, reason: "wind: response is not an array of locations" });
  });

  it("rejects the wrong number of locations", () => {
    expect(parseWindGrid(real().slice(0, 99))).toEqual({
      ok: false,
      reason: "wind: expected 100 locations, got 99",
    });
  });

  it("rejects a location without hourly data", () => {
    const body: unknown[] = real();
    body[4] = { latitude: 40.35, longitude: -73.88 };
    expect(parseWindGrid(body)).toEqual({ ok: false, reason: "wind: location 4 has no hourly data" });
  });

  it("rejects a malformed time stamp", () => {
    const body = real();
    body[6]?.hourly.time.splice(0, 1, "2026-10-04 00:00");
    expect(parseWindGrid(body)).toEqual({
      ok: false,
      reason: "wind: location 6 hourly arrays are missing or malformed",
    });
  });

  it("rejects hourly arrays of different lengths", () => {
    const body = real();
    body[8]?.hourly.wind_direction_10m.pop();
    expect(parseWindGrid(body)).toEqual({
      ok: false,
      reason: "wind: location 8 hourly arrays differ in length",
    });
  });

  it("rejects a location with fewer hours than the first", () => {
    const body = real();
    const loc = body[20];
    if (!loc) throw new Error("empty fixture");
    for (const key of ["time", "wind_speed_10m", "wind_direction_10m"] as const) loc.hourly[key].pop();
    expect(parseWindGrid(body)).toEqual({
      ok: false,
      reason: "wind: location 20 has different hours from location 0",
    });
  });

  it("rejects empty hourly data", () => {
    const body = real().map((loc) => ({ ...loc, hourly: { time: [], wind_speed_10m: [], wind_direction_10m: [] } }));
    expect(parseWindGrid(body)).toEqual({ ok: false, reason: "wind: hourly data is empty" });
  });
});
