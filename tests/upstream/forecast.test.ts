import { describe, expect, it } from "vitest";
import { buildForecastUrl, fetchForecast } from "../../src/upstream/forecast.js";
import { fakeFetch } from "./fakeFetch.js";

const URL = buildForecastUrl();
const serve = (file: string, status = 200) => fakeFetch({ [URL]: { file, status } });

describe("buildForecastUrl", () => {
  it("carries the exact parameters", () => {
    const url = new globalThis.URL(URL);
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "40.585",
      longitude: "-73.820",
      hourly: "wind_speed_10m,wind_direction_10m",
      daily: "sunrise,sunset",
      wind_speed_unit: "mph",
      timezone: "America/New_York",
      forecast_days: "7",
    });
  });
});

describe("fetchForecast", () => {
  it("reads the saved live response", async () => {
    const result = await fetchForecast(serve("forecast.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.time).toHaveLength(168);
    expect(result.value.windSpeed).toHaveLength(168);
    expect(result.value.windDirection).toHaveLength(168);
    expect(result.value.sunrise).toHaveLength(7);
    expect(result.value.sunset).toHaveLength(7);
    expect(result.value.sunrise[0]).toBe("2026-10-03T06:53");
  });

  it("keeps nulls in the hourly arrays", async () => {
    const result = await fetchForecast(serve("forecast-nulls.json"));
    expect(result).toEqual({
      ok: true,
      value: {
        time: ["2026-10-03T00:00", "2026-10-03T01:00", "2026-10-03T02:00"],
        windSpeed: [8.1, null, 9.4],
        windDirection: [200, 210, null],
        sunrise: ["2026-10-03T06:53"],
        sunset: ["2026-10-03T18:14"],
      },
    });
  });

  it("turns an error:true body on a 200 into its reason", async () => {
    const result = await fetchForecast(serve("openmeteo-error.json"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Cannot initialize WeatherVariable");
  });

  it("fails when the daily object is missing", async () => {
    const result = await fetchForecast(serve("forecast-no-daily.json"));
    expect(result).toEqual({ ok: false, reason: "forecast: response has no daily data" });
  });

  it("fails on an empty hourly object", async () => {
    const result = await fetchForecast(serve("marine-empty-hourly.json"));
    expect(result.ok).toBe(false);
  });

  it("fails on HTTP 429 and 500", async () => {
    expect(await fetchForecast(serve("forecast.json", 429))).toEqual({
      ok: false,
      reason: "forecast: HTTP 429",
    });
    expect(await fetchForecast(serve("forecast.json", 500))).toEqual({
      ok: false,
      reason: "forecast: HTTP 500",
    });
  });

  it("fails on a body that is not JSON", async () => {
    const result = await fetchForecast(serve("not-json.html"));
    expect(result).toEqual({ ok: false, reason: "forecast: response was not valid JSON" });
  });
});
