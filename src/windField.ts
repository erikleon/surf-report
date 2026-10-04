// What the wind map gets: the cached wind grid with its freshness decided on
// the server, and the JSON the server sends for it.

import type { Entry } from "./cache.js";
import { WIND_STALE_AFTER_MS, ageState } from "./freshness.js";
import { nyStamp } from "./time.js";
import type { WindField } from "./upstream/windGrid.js";

export interface WindView {
  state: "fresh" | "stale" | "missing";
  /** Epoch ms of the last good fetch. */
  asOf?: number;
  field?: WindField;
  /** Index of the current New York hour in `field.times`. Absent when the field does not cover now. */
  hourIndex?: number;
}

export function windView(entry: Entry<WindField>, nowMs: number): WindView {
  const state = ageState(entry.fetchedAt, nowMs, WIND_STALE_AFTER_MS);
  if (state === "missing" || entry.value === undefined || entry.fetchedAt === undefined) {
    return { state: "missing" };
  }
  const view: WindView = { state, asOf: entry.fetchedAt, field: entry.value };
  const index = entry.value.times.indexOf(nyStamp(nowMs));
  if (index !== -1) view.hourIndex = index;
  return view;
}

const tenth = (n: number): number => Math.round(n * 10) / 10;

/** Whole degrees in 0 to 359, so 359.6 becomes 0 and not 360. */
const degrees = (n: number): number => ((Math.round(n) % 360) + 360) % 360;

/**
 * The JSON the map page receives. Speeds are rounded to 0.1 mph and
 * directions to whole degrees to keep it small. `hourIndex` is null when the
 * field does not cover the current hour, so the key is always there.
 */
export function toWindJson(view: WindView): string {
  if (view.state === "missing" || view.field === undefined) return JSON.stringify({ state: "missing" });
  const { field } = view;
  return JSON.stringify({
    state: view.state,
    asOf: view.asOf,
    times: field.times,
    lats: field.lats,
    lons: field.lons,
    speed: field.speed.map((grid) => grid.map((row) => row.map(tenth))),
    dir: field.dir.map((grid) => grid.map((row) => row.map(degrees))),
    hourIndex: view.hourIndex ?? null,
  });
}
