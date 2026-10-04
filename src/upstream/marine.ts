// Open-Meteo marine model: wave height and period for Rockaway Beach.

import type { FetchFn, MarineSeries, Result } from "../types.js";
import {
  getJson,
  isRecord,
  openMeteoError,
  readNumbers,
  readStamps,
} from "./http.js";

export function buildMarineUrl(): string {
  const params = new URLSearchParams({
    latitude: "40.585",
    longitude: "-73.820",
    hourly: "wave_height,wave_period",
    length_unit: "imperial",
    timezone: "America/New_York",
    forecast_days: "7",
  });
  return `https://marine-api.open-meteo.com/v1/marine?${params}`;
}

export function parseMarine(body: unknown): Result<MarineSeries> {
  const apiError = openMeteoError(body);
  if (apiError !== undefined) return { ok: false, reason: `marine: ${apiError}` };

  const hourly = isRecord(body) ? body["hourly"] : undefined;
  if (!isRecord(hourly)) {
    return { ok: false, reason: "marine: response has no hourly data" };
  }
  const time = readStamps(hourly["time"]);
  const waveHeight = readNumbers(hourly["wave_height"]);
  const wavePeriod = readNumbers(hourly["wave_period"]);
  if (!time || !waveHeight || !wavePeriod) {
    return { ok: false, reason: "marine: hourly arrays are missing or malformed" };
  }
  if (time.length === 0) {
    return { ok: false, reason: "marine: hourly data is empty" };
  }
  if (waveHeight.length !== time.length || wavePeriod.length !== time.length) {
    return { ok: false, reason: "marine: hourly arrays differ in length" };
  }
  return { ok: true, value: { time, waveHeight, wavePeriod } };
}

export async function fetchMarine(
  fetchImpl: FetchFn = fetch,
): Promise<Result<MarineSeries>> {
  const body = await getJson(buildMarineUrl(), fetchImpl);
  if (!body.ok) return { ok: false, reason: `marine: ${body.reason}` };
  return parseMarine(body.value);
}
