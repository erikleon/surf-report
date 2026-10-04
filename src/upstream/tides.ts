// NOAA CO-OPS tide predictions for station 8517137 (Beach Channel bridge).

import type { FetchFn, Result, TideSeries } from "../types.js";
import { getJson, isRecord, LOCAL_STAMP } from "./http.js";

export interface TideRange {
  /** "YYYYMMDD", New York date. */
  begin: string;
  /** "YYYYMMDD", New York date. */
  end: string;
}

// The API also has a `range=` parameter. It returns an empty list without
// saying why, so the dates are always passed as begin_date and end_date.
export function buildTidesUrl(range: TideRange): string {
  const params = new URLSearchParams({
    product: "predictions",
    application: "surf-report",
    begin_date: range.begin,
    end_date: range.end,
    datum: "MLLW",
    station: "8517137",
    time_zone: "lst_ldt",
    units: "english",
    interval: "h",
    format: "json",
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`;
}

export function parseTides(body: unknown): Result<TideSeries> {
  if (!isRecord(body)) {
    return { ok: false, reason: "tides: response is not an object" };
  }
  const error = body["error"];
  if (error !== undefined) {
    const message = isRecord(error) ? error["message"] : undefined;
    return {
      ok: false,
      reason: `tides: ${typeof message === "string" ? message : "NOAA reported an error"}`,
    };
  }
  const predictions = body["predictions"];
  if (!Array.isArray(predictions)) {
    return { ok: false, reason: "tides: response has no predictions list" };
  }
  if (predictions.length === 0) {
    return {
      ok: false,
      reason: "tides: NOAA returned an empty predictions list for this date range",
    };
  }

  const time: string[] = [];
  const feet: number[] = [];
  for (const row of predictions) {
    if (!isRecord(row)) continue;
    const t = row["t"];
    const v = row["v"];
    if (typeof t !== "string" || typeof v !== "string" || v.trim() === "") continue;
    const stamp = t.replace(" ", "T");
    const height = Number(v);
    if (!LOCAL_STAMP.test(stamp) || !Number.isFinite(height)) continue;
    time.push(stamp);
    feet.push(height);
  }
  if (time.length === 0) {
    return { ok: false, reason: "tides: no prediction row could be read" };
  }
  return { ok: true, value: { time, feet } };
}

export async function fetchTides(
  range: TideRange,
  fetchImpl: FetchFn = fetch,
): Promise<Result<TideSeries>> {
  const body = await getJson(buildTidesUrl(range), fetchImpl);
  if (!body.ok) return { ok: false, reason: `tides: ${body.reason}` };
  return parseTides(body.value);
}
