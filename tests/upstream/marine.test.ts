import { describe, expect, it } from "vitest";
import { buildMarineUrl, fetchMarine } from "../../src/upstream/marine.js";
import { failingFetch, fakeFetch } from "./fakeFetch.js";

const URL = buildMarineUrl();
const serve = (file: string, status = 200) => fakeFetch({ [URL]: { file, status } });

describe("buildMarineUrl", () => {
  it("carries the exact parameters", () => {
    const url = new globalThis.URL(URL);
    expect(url.origin + url.pathname).toBe("https://marine-api.open-meteo.com/v1/marine");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "40.585",
      longitude: "-73.820",
      hourly: "wave_height,wave_period",
      length_unit: "imperial",
      timezone: "America/New_York",
      forecast_days: "7",
    });
  });
});

describe("fetchMarine", () => {
  it("reads the saved live response", async () => {
    const result = await fetchMarine(serve("marine.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.time).toHaveLength(168);
    expect(result.value.waveHeight).toHaveLength(168);
    expect(result.value.wavePeriod).toHaveLength(168);
    expect(result.value.time[0]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/);
  });

  it("keeps nulls in the middle and at the end", async () => {
    const result = await fetchMarine(serve("marine-nulls.json"));
    expect(result).toEqual({
      ok: true,
      value: {
        time: [
          "2026-10-03T00:00",
          "2026-10-03T01:00",
          "2026-10-03T02:00",
          "2026-10-03T03:00",
          "2026-10-03T04:00",
          "2026-10-03T05:00",
        ],
        waveHeight: [2.4, 2.5, null, null, 2.6, null],
        wavePeriod: [7.1, 7.2, null, 7.3, 7.4, null],
      },
    });
  });

  it("turns an error:true body on a 200 into its reason", async () => {
    const result = await fetchMarine(serve("openmeteo-error.json"));
    expect(result).toEqual({
      ok: false,
      reason:
        "marine: Cannot initialize WeatherVariable from invalid String value wave_hight for key hourly",
    });
  });

  it("fails on an empty hourly object", async () => {
    const result = await fetchMarine(serve("marine-empty-hourly.json"));
    expect(result.ok).toBe(false);
  });

  it("fails when the arrays differ in length", async () => {
    const result = await fetchMarine(serve("marine-mismatched.json"));
    expect(result).toEqual({ ok: false, reason: "marine: hourly arrays differ in length" });
  });

  it("fails on HTTP 429 and 500", async () => {
    expect(await fetchMarine(serve("marine.json", 429))).toEqual({
      ok: false,
      reason: "marine: HTTP 429",
    });
    expect(await fetchMarine(serve("marine.json", 500))).toEqual({
      ok: false,
      reason: "marine: HTTP 500",
    });
  });

  it("fails on a body that is not JSON", async () => {
    const result = await fetchMarine(serve("not-json.html"));
    expect(result).toEqual({ ok: false, reason: "marine: response was not valid JSON" });
  });

  it("fails on a network error", async () => {
    const result = await fetchMarine(failingFetch);
    expect(result.ok).toBe(false);
  });
});
