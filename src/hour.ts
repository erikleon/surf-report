// Joins the marine and forecast series into one list of hours.

import type { Daylight, ForecastSeries, Hour, MarineSeries } from "./types.js";

/**
 * One record per marine time, in marine order.
 *
 * The marine series is the spine because wave data is the scarcer half. An
 * hour missing any of its four values, or missing from the forecast, becomes a
 * gap that keeps its slot so the chart stays one slot wide per hour. Forecast
 * hours the marine series does not list are dropped.
 */
export function buildHours(marine: MarineSeries, forecast: ForecastSeries): Hour[] {
  const forecastIndex = new Map<string, number>();
  forecast.time.forEach((t, i) => {
    // Keep the first entry if a time repeats.
    if (!forecastIndex.has(t)) forecastIndex.set(t, i);
  });

  return marine.time.map((time, i): Hour => {
    const j = forecastIndex.get(time);
    if (j === undefined) return { kind: "gap", time };
    const waveHeight = marine.waveHeight[i];
    const wavePeriod = marine.wavePeriod[i];
    const windSpeed = forecast.windSpeed[j];
    const windDirection = forecast.windDirection[j];
    if (
      waveHeight === undefined || waveHeight === null ||
      wavePeriod === undefined || wavePeriod === null ||
      windSpeed === undefined || windSpeed === null ||
      windDirection === undefined || windDirection === null
    ) {
      return { kind: "gap", time };
    }
    return { kind: "data", time, waveHeight, wavePeriod, windSpeed, windDirection };
  });
}

/** The sunrise and sunset slice of a forecast. */
export function daylightOf(forecast: ForecastSeries): Daylight {
  return { sunrise: forecast.sunrise, sunset: forecast.sunset };
}
