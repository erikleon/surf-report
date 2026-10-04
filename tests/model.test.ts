import { describe, expect, it } from "vitest";
import type { CacheSnapshot } from "../src/cache.js";
import { CALL_STALE_AFTER_MS } from "../src/freshness.js";
import { buildModel } from "../src/model.js";
import { parseForecast } from "../src/upstream/forecast.js";
import { parseMarine } from "../src/upstream/marine.js";
import { parseTides } from "../src/upstream/tides.js";
import { fixture } from "./upstream/fakeFetch.js";

const NOW = Date.UTC(2026, 9, 3, 14, 0); // 10:00 in New York
const MIN = 60_000;

function load<T>(parse: (b: unknown) => { ok: boolean; value?: T }, file: string): T {
  const r = parse(JSON.parse(fixture(file)));
  if (!r.ok || r.value === undefined) throw new Error(`bad fixture ${file}`);
  return r.value;
}
const marine = load(parseMarine, "marine.json");
const forecast = load(parseForecast, "forecast.json");
const tides = load(parseTides, "tides.json");

function snap(marineAt?: number, forecastAt?: number, tidesAt?: number): CacheSnapshot {
  return {
    marine: marineAt === undefined ? {} : { value: marine, fetchedAt: marineAt },
    forecast: forecastAt === undefined ? {} : { value: forecast, fetchedAt: forecastAt },
    tides: tidesAt === undefined ? {} : { value: tides, fetchedAt: tidesAt },
  };
}

describe("buildModel", () => {
  it("is complete and cacheable when everything is fresh", () => {
    const m = buildModel(snap(NOW - 5 * MIN, NOW - 5 * MIN, NOW - 5 * MIN), NOW);
    expect(m.nowStamp).toBe("2026-10-03T10:00");
    expect(m.hours).toHaveLength(168);
    expect(m.daylight?.sunrise[0]).toBe("2026-10-03T06:53");
    expect(m.tide).toBe(tides);
    expect(m.verdict).toBeDefined();
    expect(m.callState).toBe("ok");
    expect(m.callAsOf).toBe(NOW - 5 * MIN);
    expect([m.marineState, m.forecastState, m.tideState]).toEqual(["fresh", "fresh", "fresh"]);
    expect(m.cacheable).toBe(true);
  });

  it("is missing and not cacheable on an empty cache", () => {
    const m = buildModel(snap(), NOW);
    expect(m.hours).toEqual([]);
    expect(m.verdict).toBeUndefined();
    expect(m.callState).toBe("missing");
    expect(m.callAsOf).toBeUndefined();
    expect([m.marineState, m.forecastState, m.tideState]).toEqual(["missing", "missing", "missing"]);
    expect(m.cacheable).toBe(false);
  });

  it("is missing when only one of marine and forecast has loaded", () => {
    const m = buildModel(snap(NOW, undefined, NOW), NOW);
    expect(m.callState).toBe("missing");
    expect(m.verdict).toBeUndefined();
    expect(m.hours).toEqual([]);
    expect(m.cacheable).toBe(false);
  });

  it("flips the call state at 31m59s, 32m00s and 32m01s", () => {
    const at = (ageMs: number) => buildModel(snap(NOW - ageMs, NOW - ageMs, NOW), NOW);
    expect(CALL_STALE_AFTER_MS).toBe(32 * MIN);
    const under = at(31 * MIN + 59_000);
    expect(under.callState).toBe("ok");
    expect(under.verdict).toBeDefined();
    const exact = at(32 * MIN);
    expect(exact.callState).toBe("stale");
    expect(exact.verdict).toBeUndefined();
    const over = at(32 * MIN + 1000);
    expect(over.callState).toBe("stale");
    expect(over.verdict).toBeUndefined();
    expect(over.cacheable).toBe(false);
  });

  it("uses the oldest of marine and forecast as callAsOf and hides the call", () => {
    const marineAt = NOW - 34 * MIN;
    const m = buildModel(snap(marineAt, NOW - MIN, NOW), NOW);
    expect(m.callAsOf).toBe(marineAt);
    expect(m.callState).toBe("stale");
    expect(m.verdict).toBeUndefined();
    expect(m.forecastState).toBe("fresh");
    expect(m.marineState).toBe("stale");
  });

  it("uses the forecast time when the forecast is older", () => {
    const forecastAt = NOW - 10 * MIN;
    expect(buildModel(snap(NOW, forecastAt, NOW), NOW).callAsOf).toBe(forecastAt);
  });

  it("keeps raw numbers in hours when stale", () => {
    const m = buildModel(snap(NOW - 3 * 3_600_000, NOW - 3 * 3_600_000, NOW), NOW);
    expect(m.callState).toBe("stale");
    expect(m.hours).toHaveLength(168);
    expect(m.hours.some((h) => h.kind === "data")).toBe(true);
    expect(m.daylight).toBeDefined();
    expect(m.marineState).toBe("stale");
    expect(m.forecastState).toBe("stale");
  });

  it("marks raw numbers amber after 17 minutes", () => {
    expect(buildModel(snap(NOW - 16 * MIN - 59_000, NOW, NOW), NOW).marineState).toBe("fresh");
    expect(buildModel(snap(NOW - 17 * MIN, NOW, NOW), NOW).marineState).toBe("stale");
  });

  it("is not cacheable when tides are missing, though the call is fine", () => {
    const m = buildModel(snap(NOW, NOW, undefined), NOW);
    expect(m.callState).toBe("ok");
    expect(m.verdict).toBeDefined();
    expect(m.tide).toBeUndefined();
    expect(m.tideState).toBe("missing");
    expect(m.cacheable).toBe(false);
  });

  it("goes stale on tides after 6 hours without hiding the call", () => {
    const m = buildModel(snap(NOW, NOW, NOW - 6 * 3_600_000), NOW);
    expect(m.tideState).toBe("stale");
    expect(m.callState).toBe("ok");
    expect(m.cacheable).toBe(true);
  });
});
