// Small pieces of markup used by more than one page.

import { compass, windRelativeToBeach } from "../beach.js";
import { escapeHtml } from "../html.js";
import { MONTHS, dateLabel, nyMinuteStamp, timeLabel } from "../time.js";

export const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Weekday name for a "YYYY-MM-DD" date. The UTC read keeps the host zone out of it. */
export function fullDayName(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return FULL_DAYS[new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay()] as string;
}

/** "3 Oct" for a "YYYY-MM-DD" date. */
export function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

/** The calendar date `n` days after a "YYYY-MM-DD" date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + n)).toISOString().slice(0, 10);
}

/** "6:15 AM" in New York time for an instant. */
export function clock(ms: number): string {
  return timeLabel(nyMinuteStamp(ms));
}

/** "3 Oct 2026, 6:15 AM" in New York time for an instant. */
export function clockWithDate(ms: number): string {
  const stamp = nyMinuteStamp(ms);
  return `${dateLabel(stamp)}, ${timeLabel(stamp)}`;
}

const STAR_PATH = "M5 .6 L6.4 3.7 L9.7 4 L7.2 6.2 L8 9.4 L5 7.7 L2 9.4 L2.8 6.2 L.3 4 L3.6 3.7 Z";

/**
 * Five stars: solid for the rating, faded for what the wind took away, and
 * outlines for the rest. The label carries the same facts in words, so the
 * drawing is never the only carrier.
 */
export function stars(solid: number, swell: number): string {
  const faded = Math.max(0, swell - solid);
  const empty = Math.max(0, 5 - solid - faded);
  const label = `${solid} of 5 stars${faded > 0 ? `, wind took away ${faded}` : ""}`;
  const one = (cls: string): string =>
    `<svg class="star ${cls}" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
  return (
    `<span class="stars" role="img" aria-label="${escapeHtml(label)}">` +
    one("solid").repeat(solid) +
    one("faded").repeat(faded) +
    one("empty").repeat(empty) +
    `</span>`
  );
}

/** The small amber square and the absolute time of an old reading. */
export function staleAsOf(ms: number): string {
  return `<span class="asof"><span class="stale-sq" aria-hidden="true"></span>as of ${clock(ms)}</span>`;
}

export function windWord(fromDeg: number): { text: string; cls: string } {
  const rel = windRelativeToBeach(fromDeg);
  return { text: rel, cls: rel === "offshore" ? "off" : rel === "onshore" ? "on" : "cross" };
}

export { compass };

/** A wind arrow pointing the way the wind blows, drawn inline so it costs no request. */
export function windArrow(fromDeg: number): string {
  const cls = windWord(fromDeg).cls;
  return (
    `<svg class="arrow" viewBox="-7 -8 14 16" aria-hidden="true" focusable="false">` +
    `<g transform="rotate(${(Math.round(fromDeg) + 180) % 360})">` +
    `<path class="wind ${cls}" d="M0 -7 L4 5 L0 3 L-4 5 Z"/></g></svg>`
  );
}
