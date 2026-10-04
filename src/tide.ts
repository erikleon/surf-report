// Tide height through the forecast window.
//
// At a beach break the tide decides whether a given swell has anything to
// break on, so it belongs next to the wave height rather than a page away.
// It does not get a line on the chart: the density budget in DESIGN.md allows
// three continuous series and the surf chart already spends them on wave
// height, period and wind. A fourth wiggle would compete with the two that
// answer the question. It rides in the scrub readout instead, which is what
// the readout is for.
//
// NOAA returns predictions rather than observations, so this keeps answering
// when the gauge is out of the water. The fetcher has already parsed the NOAA
// response into a TideSeries, so nothing here reads raw NOAA rows.

import type { TideSeries } from "./types.js";

export type TideTrend = "rising" | "falling" | "slack";

export interface TideReading {
  feet: number;
  trend: TideTrend;
}

/** Below this change over the neighbouring hours the water is not going anywhere. */
const SLACK_FT = 0.15;

/**
 * The tide at one local stamp, or nothing when the series does not reach it.
 *
 * The trend is read across the neighbouring hours rather than from one step,
 * so an hour sitting on the turn reads as slack instead of picking a direction
 * on rounding noise.
 */
export function tideAt(tide: TideSeries, stamp: string): TideReading | undefined {
  const i = tide.time.indexOf(stamp);
  if (i < 0) return undefined;
  const feet = tide.feet[i];
  if (feet === undefined) return undefined;

  const prev = i > 0 ? tide.feet[i - 1] : undefined;
  const next = i < tide.feet.length - 1 ? tide.feet[i + 1] : undefined;
  const delta =
    prev !== undefined && next !== undefined
      ? (next - prev) / 2
      : next !== undefined
        ? next - feet
        : prev !== undefined
          ? feet - prev
          : 0;

  const trend: TideTrend = delta > SLACK_FT ? "rising" : delta < -SLACK_FT ? "falling" : "slack";
  return { feet, trend };
}

/** "3.2 ft rising", the way it reads in the readout. */
export function formatTide(r: TideReading): string {
  return `${r.feet.toFixed(1)} ft ${r.trend}`;
}

export interface TideTurn {
  kind: "high" | "low";
  /** Local stamp of the turn. */
  stamp: string;
  feet: number;
}

/**
 * The next high or low water at or after a stamp.
 *
 * NOAA is asked for hourly predictions rather than the extremes, so the turn
 * is the hour whose neighbours are both lower or both higher. That puts it
 * within half an hour of the real one, which is the resolution a tile can use
 * anyway.
 */
export function nextTurn(tide: TideSeries, fromStamp: string): TideTurn | undefined {
  const start = tide.time.findIndex((t) => t >= fromStamp);
  if (start < 0) return undefined;

  for (let i = Math.max(start, 1); i < tide.feet.length - 1; i++) {
    const prev = tide.feet[i - 1];
    const here = tide.feet[i];
    const next = tide.feet[i + 1];
    const stamp = tide.time[i];
    if (prev === undefined || here === undefined || next === undefined || stamp === undefined) continue;
    if (here === prev && here === next) continue;
    if (here >= prev && here >= next) return { kind: "high", stamp, feet: here };
    if (here <= prev && here <= next) return { kind: "low", stamp, feet: here };
  }
  return undefined;
}
