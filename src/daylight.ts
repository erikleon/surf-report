// Which forecast hours are dark.
//
// Half the hours a surf chart shows are hours nobody can surf, so shading them
// takes them out of the argument rather than leaving them to be discounted by
// eye.
//
// Sunrise and sunset arrive with the daily forecast, already in New York local
// time, so they are compared as strings against the same local stamps the
// hourly series carry. Parsing them into Dates would put a timezone on data
// that has none.

import type { Daylight } from "./types.js";

/**
 * Is a local stamp between sunrise and sunset on its own day?
 *
 * `undefined` when the day has no sun times, which is a different thing from
 * night and has to stay distinguishable: a missing day must not paint as dark.
 */
export function isDaylight(stamp: string, d: Daylight): boolean | undefined {
  const day = stamp.slice(0, 10);
  const i = d.sunrise.findIndex((s) => s.slice(0, 10) === day);
  if (i < 0) return undefined;
  const up = d.sunrise[i];
  const down = d.sunset[i];
  if (up === undefined || down === undefined) return undefined;
  return stamp >= up && stamp < down;
}

/**
 * Contiguous `[start, end)` index runs where the series is dark.
 *
 * An hour whose daylight cannot be determined counts as lit, so one missing
 * day shades nothing instead of shading everything.
 */
export function nightSpans(times: string[], d: Daylight): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let run: number | null = null;
  for (let i = 0; i < times.length; i++) {
    const dark = isDaylight(times[i] as string, d) === false;
    if (dark && run === null) run = i;
    if (!dark && run !== null) {
      spans.push([run, i]);
      run = null;
    }
  }
  if (run !== null) spans.push([run, times.length]);
  return spans;
}

/**
 * Night as shaded blocks behind everything, given a chart's own x mapping.
 *
 * Drawn first so it reads as ground rather than as another series, which is
 * also why it does not count against a chart's series budget.
 */
export function nightRects(
  times: string[],
  daylight: Daylight | undefined,
  x: (i: number) => number,
  top: number,
  height: number,
): string {
  if (!daylight) return "";
  const n = times.length;
  if (n < 2) return "";
  const slot = x(1) - x(0);
  return nightSpans(times, daylight)
    .map(([a, b]) => {
      const x0 = x(a);
      // A run reaching the end stops at the last hour's own x, so it is widened
      // by one slot to reach the edge of the plot rather than stopping short.
      const x1 = b >= n ? x(n - 1) + slot : x(b);
      return (
        `<rect class="night" x="${x0.toFixed(1)}" y="${top}" ` +
        `width="${Math.max(0, x1 - x0).toFixed(1)}" height="${height}" />`
      );
    })
    .join("");
}
