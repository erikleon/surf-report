// Everything a page needs, decided on the server from one cache snapshot.

import type { CacheSnapshot } from "./cache.js";
import {
  CALL_STALE_AFTER_MS,
  RAW_STALE_AFTER_MS,
  TIDE_STALE_AFTER_MS,
  ageState,
  type AgeState,
} from "./freshness.js";
import { buildHours, daylightOf } from "./hour.js";
import { nyStamp } from "./time.js";
import type { Daylight, DayVerdict, Hour, TideSeries } from "./types.js";
import { dayVerdict } from "./verdict.js";

export type { AgeState };

export interface SiteModel {
  nowStamp: string;
  hours: Hour[];
  daylight?: Daylight;
  tide?: TideSeries;
  verdict?: DayVerdict;
  callState: "ok" | "stale" | "missing";
  /** Epoch ms of the older of the marine and forecast fetches. */
  callAsOf?: number;
  marineState: AgeState;
  forecastState: AgeState;
  tideState: AgeState;
  /** True only for a complete, fresh page that the edge may keep. */
  cacheable: boolean;
}

export function buildModel(snapshot: CacheSnapshot, nowMs: number): SiteModel {
  const { marine, forecast, tides } = snapshot;
  const nowStamp = nyStamp(nowMs);

  // Old numbers stay on the page, shown amber. Only the call is hidden.
  const hours =
    marine.value !== undefined && forecast.value !== undefined
      ? buildHours(marine.value, forecast.value)
      : [];
  const daylight = forecast.value !== undefined ? daylightOf(forecast.value) : undefined;

  // The call is only as fresh as its oldest input.
  let callAsOf: number | undefined;
  let callState: SiteModel["callState"] = "missing";
  if (marine.fetchedAt !== undefined && forecast.fetchedAt !== undefined) {
    callAsOf = Math.min(marine.fetchedAt, forecast.fetchedAt);
    callState = nowMs - callAsOf < CALL_STALE_AFTER_MS ? "ok" : "stale";
  }

  const verdict = callState === "ok" ? dayVerdict(hours, daylight, nowStamp) : undefined;

  const model: SiteModel = {
    nowStamp,
    hours,
    callState,
    marineState: ageState(marine.fetchedAt, nowMs, RAW_STALE_AFTER_MS),
    forecastState: ageState(forecast.fetchedAt, nowMs, RAW_STALE_AFTER_MS),
    tideState: ageState(tides.fetchedAt, nowMs, TIDE_STALE_AFTER_MS),
    cacheable:
      callState === "ok" &&
      marine.value !== undefined &&
      forecast.value !== undefined &&
      tides.value !== undefined,
  };
  if (daylight !== undefined) model.daylight = daylight;
  if (tides.value !== undefined) model.tide = tides.value;
  if (verdict !== undefined) model.verdict = verdict;
  if (callAsOf !== undefined) model.callAsOf = callAsOf;
  return model;
}
