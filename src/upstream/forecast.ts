// Open-Meteo forecast: hourly wind, plus sunrise and sunset for each day.

import type { FetchFn, ForecastSeries, Result } from "../types.js";
import {
  getJson,
  isRecord,
  openMeteoError,
  readNumbers,
  readStamps,
} from "./http.js";

export function buildForecastUrl(): string {
  const params = new URLSearchParams({
    latitude: "40.585",
    longitude: "-73.820",
    hourly: "wind_speed_10m,wind_direction_10m",
    daily: "sunrise,sunset",
    wind_speed_unit: "mph",
    timezone: "America/New_York",
    forecast_days: "7",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseForecast(body: unknown): Result<ForecastSeries> {
  const apiError = openMeteoError(body);
  if (apiError !== undefined) return { ok: false, reason: `forecast: ${apiError}` };

  const hourly = isRecord(body) ? body["hourly"] : undefined;
  const daily = isRecord(body) ? body["daily"] : undefined;
  if (!isRecord(hourly)) {
    return { ok: false, reason: "forecast: response has no hourly data" };
  }
  if (!isRecord(daily)) {
    return { ok: false, reason: "forecast: response has no daily data" };
  }

  const time = readStamps(hourly["time"]);
  const windSpeed = readNumbers(hourly["wind_speed_10m"]);
  const windDirection = readNumbers(hourly["wind_direction_10m"]);
  if (!time || !windSpeed || !windDirection) {
    return { ok: false, reason: "forecast: hourly arrays are missing or malformed" };
  }
  if (time.length === 0) {
    return { ok: false, reason: "forecast: hourly data is empty" };
  }
  if (windSpeed.length !== time.length || windDirection.length !== time.length) {
    return { ok: false, reason: "forecast: hourly arrays differ in length" };
  }

  const sunrise = readStamps(daily["sunrise"]);
  const sunset = readStamps(daily["sunset"]);
  if (!sunrise || !sunset) {
    return { ok: false, reason: "forecast: sunrise or sunset is missing or malformed" };
  }
  if (sunrise.length === 0 || sunrise.length !== sunset.length) {
    return { ok: false, reason: "forecast: sunrise and sunset differ in length" };
  }

  return { ok: true, value: { time, windSpeed, windDirection, sunrise, sunset } };
}

export async function fetchForecast(
  fetchImpl: FetchFn = fetch,
): Promise<Result<ForecastSeries>> {
  const body = await getJson(buildForecastUrl(), fetchImpl);
  if (!body.ok) return { ok: false, reason: `forecast: ${body.reason}` };
  return parseForecast(body.value);
}
