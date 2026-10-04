import { brotliCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { WIND_STALE_AFTER_MS } from "../src/freshness.js";
import { parseWindGrid, type WindField } from "../src/upstream/windGrid.js";
import { toWindJson, windView } from "../src/windField.js";
import { fixture } from "./upstream/fakeFetch.js";

const parsed = parseWindGrid(JSON.parse(fixture("windgrid.json")));
if (!parsed.ok) throw new Error(parsed.reason);
const FIELD = parsed.value;

// The fixture starts at 2026-10-04T00:00 New York time, which is 04:00 UTC (EDT).
const NY_0500 = Date.UTC(2026, 9, 4, 9, 0);
const MIN = 60_000;

/** A tiny two-hour field for exact JSON checks. */
const tiny: WindField = {
  times: ["2026-10-04T05:00", "2026-10-04T06:00"],
  lats: [40.35, 40.75],
  lons: [-74.15, -73.55],
  speed: [
    [
      [12.34, 0.04],
      [7.25, 19.96],
    ],
    [
      [1, 2],
      [3, 4],
    ],
  ],
  dir: [
    [
      [359.6, 0.4],
      [180.5, 44.49],
    ],
    [
      [10, 20],
      [30, 40],
    ],
  ],
};

describe("windView", () => {
  it("is missing when the grid was never fetched", () => {
    expect(windView({}, NY_0500)).toEqual({ state: "missing" });
    expect(windView({ lastError: "wind: HTTP 500" }, NY_0500)).toEqual({ state: "missing" });
  });

  it("is fresh with the as-of time, the field and the current hour", () => {
    const view = windView({ value: FIELD, fetchedAt: NY_0500 - 10 * MIN }, NY_0500);
    expect(view.state).toBe("fresh");
    expect(view.asOf).toBe(NY_0500 - 10 * MIN);
    expect(view.field).toBe(FIELD);
    expect(view.hourIndex).toBe(5);
    expect(FIELD.times[5]).toBe("2026-10-04T05:00");
  });

  it("turns stale at two missed refreshes plus the edge TTL", () => {
    const at = NY_0500 - WIND_STALE_AFTER_MS;
    expect(windView({ value: FIELD, fetchedAt: at + 1 }, NY_0500).state).toBe("fresh");
    const stale = windView({ value: FIELD, fetchedAt: at }, NY_0500);
    expect(stale.state).toBe("stale");
    expect(stale.field).toBe(FIELD);
    expect(stale.hourIndex).toBe(5);
  });

  it("moves to the next hour exactly at the New York hour boundary", () => {
    const entry = { value: FIELD, fetchedAt: NY_0500 - 30 * MIN };
    expect(windView(entry, NY_0500 - 1).hourIndex).toBe(4);
    expect(windView(entry, NY_0500).hourIndex).toBe(5);
    expect(windView(entry, NY_0500 + 59 * MIN).hourIndex).toBe(5);
    expect(windView(entry, NY_0500 + 60 * MIN).hourIndex).toBe(6);
  });

  it("finds New York midnight, which is not UTC midnight", () => {
    const entry = { value: FIELD, fetchedAt: Date.UTC(2026, 9, 4, 3, 0) };
    // 00:00 UTC on the 5th is 20:00 on the 4th in New York.
    expect(windView(entry, Date.UTC(2026, 9, 5, 0, 0)).hourIndex).toBe(20);
    expect(windView(entry, Date.UTC(2026, 9, 5, 4, 0)).hourIndex).toBe(24);
    expect(FIELD.times[24]).toBe("2026-10-05T00:00");
  });

  it("has no hour index when the field does not cover now", () => {
    const before = windView({ value: FIELD, fetchedAt: NY_0500 }, Date.UTC(2026, 9, 4, 3, 59));
    expect(before.state).toBe("fresh");
    expect(before).not.toHaveProperty("hourIndex");
    const after = windView({ value: FIELD, fetchedAt: NY_0500 }, Date.UTC(2026, 9, 6, 4, 0));
    expect(after.state).toBe("stale");
    expect(after).not.toHaveProperty("hourIndex");
  });
});

describe("toWindJson", () => {
  it("rounds speed to 0.1 mph and direction to whole degrees", () => {
    const json = toWindJson(windView({ value: tiny, fetchedAt: NY_0500 - MIN }, NY_0500));
    expect(json).toBe(
      JSON.stringify({
        state: "fresh",
        asOf: NY_0500 - MIN,
        times: ["2026-10-04T05:00", "2026-10-04T06:00"],
        lats: [40.35, 40.75],
        lons: [-74.15, -73.55],
        speed: [
          [
            [12.3, 0],
            [7.3, 20],
          ],
          [
            [1, 2],
            [3, 4],
          ],
        ],
        dir: [
          [
            [0, 0],
            [181, 44],
          ],
          [
            [10, 20],
            [30, 40],
          ],
        ],
        hourIndex: 0,
      }),
    );
  });

  it("sends a null hour index when the field does not cover now", () => {
    const json = JSON.parse(toWindJson(windView({ value: tiny, fetchedAt: NY_0500 }, NY_0500 - 60 * MIN))) as {
      hourIndex: unknown;
    };
    expect(json.hourIndex).toBeNull();
  });

  it("sends the state for a stale field", () => {
    const json = JSON.parse(toWindJson(windView({ value: tiny, fetchedAt: 0 }, NY_0500))) as { state: string };
    expect(json.state).toBe("stale");
  });

  it("is only the state when the grid is missing", () => {
    expect(toWindJson(windView({}, NY_0500))).toBe('{"state":"missing"}');
    expect(toWindJson({ state: "missing" })).toBe('{"state":"missing"}');
  });

  it("keeps the real 48-hour grid small", () => {
    const json = toWindJson(windView({ value: FIELD, fetchedAt: NY_0500 }, NY_0500));
    expect(Buffer.byteLength(json)).toBeLessThan(50_000);
    expect(brotliCompressSync(json).length).toBeLessThan(15_000);
    const back = JSON.parse(json) as { speed: number[][][]; times: string[] };
    expect(back.times).toHaveLength(48);
    expect(back.speed[0]?.[0]).toHaveLength(10);
  });
});
