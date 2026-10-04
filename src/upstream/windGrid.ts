// Open-Meteo forecast for a 10 by 10 grid of points over the New York Bight,
// the wind field behind the wind map. One request covers all 100 points:
// Open-Meteo takes comma-separated latitude and longitude lists and answers
// with an array of per-location objects in the same order.

import type { FetchFn, Result } from "../types.js";
import {
  getJson,
  isRecord,
  openMeteoError,
  readNumbers,
  readStamps,
} from "./http.js";

/** Hourly wind on a grid, indexed `[time][latIndex][lonIndex]`. */
export interface WindField {
  /** New York local stamps, "2026-10-03T06:00". */
  times: string[];
  /** South to north. */
  lats: number[];
  /** West to east. */
  lons: number[];
  /** Miles per hour. */
  speed: number[][][];
  /** Degrees the wind comes FROM. */
  dir: number[][][];
}

const GRID_SIZE = 10;

/** `count` values from `from` to `to`, both ends included, at 4 decimals. */
function evenlySpaced(from: number, to: number, count: number): number[] {
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((from + i * step) * 1e4) / 1e4);
}

export const GRID_LATS: readonly number[] = evenlySpaced(40.35, 40.75, GRID_SIZE);
export const GRID_LONS: readonly number[] = evenlySpaced(-74.15, -73.55, GRID_SIZE);

/** Points in request order: latitude rows, longitudes within each row. */
const POINT_COUNT = GRID_LATS.length * GRID_LONS.length;

export function buildWindGridUrl(): string {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const lat of GRID_LATS) {
    for (const lon of GRID_LONS) {
      lats.push(lat);
      lons.push(lon);
    }
  }
  const params = new URLSearchParams({
    latitude: lats.join(","),
    longitude: lons.join(","),
    hourly: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "mph",
    timezone: "America/New_York",
    forecast_days: "2",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

interface PointSeries {
  speed: Array<number | null>;
  dir: Array<number | null>;
}

export function parseWindGrid(body: unknown): Result<WindField> {
  const apiError = openMeteoError(body);
  if (apiError !== undefined) return { ok: false, reason: `wind: ${apiError}` };

  if (!Array.isArray(body)) {
    return { ok: false, reason: "wind: response is not an array of locations" };
  }
  if (body.length !== POINT_COUNT) {
    return { ok: false, reason: `wind: expected ${POINT_COUNT} locations, got ${body.length}` };
  }

  let times: string[] | undefined;
  const points: PointSeries[] = [];
  for (const [index, location] of body.entries()) {
    const hourly = isRecord(location) ? location["hourly"] : undefined;
    if (!isRecord(hourly)) {
      return { ok: false, reason: `wind: location ${index} has no hourly data` };
    }
    const time = readStamps(hourly["time"]);
    const speed = readNumbers(hourly["wind_speed_10m"]);
    const dir = readNumbers(hourly["wind_direction_10m"]);
    if (!time || !speed || !dir) {
      return { ok: false, reason: `wind: location ${index} hourly arrays are missing or malformed` };
    }
    if (speed.length !== time.length || dir.length !== time.length) {
      return { ok: false, reason: `wind: location ${index} hourly arrays differ in length` };
    }
    if (times === undefined) {
      if (time.length === 0) return { ok: false, reason: "wind: hourly data is empty" };
      times = time;
    } else if (time.length !== times.length || time.some((stamp, i) => stamp !== times?.[i])) {
      return { ok: false, reason: `wind: location ${index} has different hours from location 0` };
    }
    points.push({ speed, dir });
  }
  if (times === undefined) return { ok: false, reason: "wind: hourly data is empty" };

  // An hour with a null at any point is dropped from the whole field, so the
  // map never draws a hole or an invented value.
  const field: WindField = { times: [], lats: [...GRID_LATS], lons: [...GRID_LONS], speed: [], dir: [] };
  for (const [t, stamp] of times.entries()) {
    const speedRows: number[][] = [];
    const dirRows: number[][] = [];
    let complete = true;
    for (let i = 0; i < GRID_LATS.length && complete; i++) {
      const speedRow: number[] = [];
      const dirRow: number[] = [];
      for (let j = 0; j < GRID_LONS.length; j++) {
        const point = points[i * GRID_LONS.length + j];
        const s = point?.speed[t];
        const d = point?.dir[t];
        if (s === null || s === undefined || d === null || d === undefined) {
          complete = false;
          break;
        }
        speedRow.push(s);
        dirRow.push(d);
      }
      speedRows.push(speedRow);
      dirRows.push(dirRow);
    }
    if (!complete) continue;
    field.times.push(stamp);
    field.speed.push(speedRows);
    field.dir.push(dirRows);
  }

  if (field.times.length === 0) {
    return { ok: false, reason: "wind: every hour has a missing value at some point" };
  }

  // Open-Meteo snaps each point to its model grid and reports the snapped
  // coordinates. `lats` and `lons` keep the requested grid, so the map can
  // place the points evenly. In a live check the snapped points were up to
  // 0.05 degrees (about 5 km) from the requested ones.
  return { ok: true, value: field };
}

export async function fetchWindGrid(fetchImpl: FetchFn = fetch): Promise<Result<WindField>> {
  const body = await getJson(buildWindGridUrl(), fetchImpl);
  if (!body.ok) return { ok: false, reason: `wind: ${body.reason}` };
  return parseWindGrid(body.value);
}
