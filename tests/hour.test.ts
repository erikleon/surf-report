import { describe, it, expect } from "vitest";
import { buildHours, daylightOf } from "../src/hour.js";
import type { ForecastSeries, MarineSeries } from "../src/types.js";

const T = ["2026-10-03T06:00", "2026-10-03T07:00", "2026-10-03T08:00"];

function marine(over: Partial<MarineSeries> = {}): MarineSeries {
  return { time: T, waveHeight: [2, 3, 4], wavePeriod: [7, 8, 9], ...over };
}

function forecast(over: Partial<ForecastSeries> = {}): ForecastSeries {
  return {
    time: T,
    windSpeed: [5, 6, 7],
    windDirection: [10, 20, 30],
    sunrise: ["2026-10-03T06:57"],
    sunset: ["2026-10-03T18:15"],
    ...over,
  };
}

describe("buildHours", () => {
  it("joins the two series into data hours", () => {
    expect(buildHours(marine(), forecast())).toEqual([
      { kind: "data", time: T[0], waveHeight: 2, wavePeriod: 7, windSpeed: 5, windDirection: 10 },
      { kind: "data", time: T[1], waveHeight: 3, wavePeriod: 8, windSpeed: 6, windDirection: 20 },
      { kind: "data", time: T[2], waveHeight: 4, wavePeriod: 9, windSpeed: 7, windDirection: 30 },
    ]);
  });

  it("makes a gap of an hour with a null in any one of the four values", () => {
    const hours = buildHours(
      marine({ waveHeight: [null, 3, 4], wavePeriod: [7, null, 9] }),
      forecast({ windSpeed: [5, 6, null] }),
    );
    expect(hours.map((h) => h.kind)).toEqual(["gap", "gap", "gap"]);
    const dir = buildHours(marine(), forecast({ windDirection: [10, null, 30] }));
    expect(dir.map((h) => h.kind)).toEqual(["data", "gap", "data"]);
  });

  it("keeps only the time on a gap", () => {
    const hours = buildHours(marine({ waveHeight: [null, 3, 4] }), forecast());
    expect(hours[0]).toEqual({ kind: "gap", time: T[0] });
  });

  it("makes a gap of a marine hour the forecast does not have", () => {
    const hours = buildHours(
      marine(),
      forecast({ time: [T[0] as string, T[2] as string], windSpeed: [5, 7], windDirection: [10, 30] }),
    );
    expect(hours.map((h) => h.kind)).toEqual(["data", "gap", "data"]);
    expect(hours[2]).toMatchObject({ windSpeed: 7, windDirection: 30 });
  });

  it("ignores forecast hours with no marine time", () => {
    const hours = buildHours(
      marine(),
      forecast({
        time: [...T, "2026-10-03T09:00"],
        windSpeed: [5, 6, 7, 8],
        windDirection: [10, 20, 30, 40],
      }),
    );
    expect(hours).toHaveLength(3);
    expect(hours.map((h) => h.time)).toEqual(T);
  });

  it("follows the marine order even when the forecast is shuffled", () => {
    const hours = buildHours(
      marine(),
      forecast({ time: [T[2] as string, T[0] as string, T[1] as string], windSpeed: [7, 5, 6], windDirection: [30, 10, 20] }),
    );
    expect(hours.map((h) => h.time)).toEqual(T);
    expect(hours[0]).toMatchObject({ windSpeed: 5 });
    expect(hours[2]).toMatchObject({ windSpeed: 7 });
  });

  it("treats a zero as a value, not a missing one", () => {
    const hours = buildHours(
      marine({ waveHeight: [0, 3, 4] }),
      forecast({ windSpeed: [0, 6, 7], windDirection: [0, 20, 30] }),
    );
    expect(hours[0]).toEqual({ kind: "data", time: T[0], waveHeight: 0, wavePeriod: 7, windSpeed: 0, windDirection: 0 });
  });

  it("makes a gap where a value array is shorter than its time array", () => {
    const hours = buildHours(marine({ wavePeriod: [7] }), forecast());
    expect(hours.map((h) => h.kind)).toEqual(["data", "gap", "gap"]);
  });

  it("returns nothing for an empty marine series", () => {
    expect(buildHours(marine({ time: [], waveHeight: [], wavePeriod: [] }), forecast())).toEqual([]);
  });

  it("makes every hour a gap when the forecast is empty", () => {
    const hours = buildHours(marine(), forecast({ time: [], windSpeed: [], windDirection: [] }));
    expect(hours.map((h) => h.kind)).toEqual(["gap", "gap", "gap"]);
  });
});

describe("daylightOf", () => {
  it("takes the sunrise and sunset slice of a forecast", () => {
    expect(daylightOf(forecast())).toEqual({
      sunrise: ["2026-10-03T06:57"],
      sunset: ["2026-10-03T18:15"],
    });
  });
});
