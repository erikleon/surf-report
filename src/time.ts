// New York time for the whole site.
//
// The site shows New York hours whatever timezone the server runs in, so every
// function that needs "now" takes it as epoch milliseconds and projects it into
// America/New_York with strictdatetime. Nothing here reads the host's zone.
//
// Forecast hours from the upstream APIs are strings like "2026-10-03T06:00"
// with no offset. They are compared as strings against a stamp built the same
// way. Parsing them into Dates would put a timezone back onto data that does
// not carry one, and the bug that follows is an off-by-one day that looks
// entirely plausible.

import {
  addCalendarToPlainDate,
  createCalendarDuration,
  plainDateOf,
  projectInstant,
  toPlainDateString,
  toPlainDateTimeString,
} from "strictdatetime";

export const NY_ZONE = "America/New_York";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** New York wall time as "2026-10-03T06:45:00.000" for an instant. */
function nyWallTime(nowMs: number): string {
  return toPlainDateTimeString(projectInstant(nowMs, NY_ZONE));
}

/** "2026-10-03T06:00" in New York, rounded down to the hour to match hourly forecast series. */
export function nyStamp(nowMs: number): string {
  return `${nyWallTime(nowMs).slice(0, 13)}:00`;
}

/**
 * "2026-10-03T06:45" in New York, minutes included.
 *
 * `nyStamp` rounds to the hour on purpose. Anything that shows a real clock
 * time to a person wants this one.
 */
export function nyMinuteStamp(nowMs: number): string {
  return nyWallTime(nowMs).slice(0, 16);
}

/** "2026-10-03", the calendar date in New York. */
export function nyDate(nowMs: number): string {
  return nyWallTime(nowMs).slice(0, 10);
}

/**
 * Start and end dates for a NOAA tide request, as "YYYYMMDD".
 *
 * `begin` is today in New York. `end` is `days` calendar days later, added to
 * the New York date so month and year ends roll over correctly.
 */
export function tideDateRange(nowMs: number, days = 2): { begin: string; end: string } {
  const today = plainDateOf(projectInstant(nowMs, NY_ZONE));
  const last = addCalendarToPlainDate(today, createCalendarDuration({ years: 0, months: 0, weeks: 0, days }));
  return {
    begin: toPlainDateString(today).replaceAll("-", ""),
    end: toPlainDateString(last).replaceAll("-", ""),
  };
}

/** Day name for a stamp: "Today" when it falls on the same date as `todayStamp`. */
export function dayLabel(stamp: string, todayStamp: string): string {
  if (stamp.slice(0, 10) === todayStamp.slice(0, 10)) return "Today";
  return dayName(stamp.slice(0, 10));
}

/** Weekday for a "YYYY-MM-DD" date, read through UTC so no offset applies. */
export function dayName(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
  return DAYS[dow] as string;
}

/**
 * "2026-09-13T14:00" -> "2:00 PM".
 *
 * Read off the string, not a Date, for the reason in the header.
 */
export function timeLabel(stamp: string): string {
  const hh = Number(stamp.slice(11, 13));
  const mm = stamp.slice(14, 16) || "00";
  if (!Number.isFinite(hh)) return "";
  const suffix = hh < 12 ? "AM" : "PM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${mm} ${suffix}`;
}

/** The same, without the minutes, for an axis tick where space is short. */
export function hourLabel(stamp: string): string {
  const hh = Number(stamp.slice(11, 13));
  if (!Number.isFinite(hh)) return "";
  const suffix = hh < 12 ? "AM" : "PM";
  return `${hh % 12 === 0 ? 12 : hh % 12} ${suffix}`;
}

/** "2026-09-13T14:00" -> "13 Sep 2026". Day, month, year, in that order. */
export function dateLabel(stamp: string): string {
  const y = stamp.slice(0, 4);
  const m = Number(stamp.slice(5, 7));
  const d = Number(stamp.slice(8, 10));
  if (!Number.isFinite(m) || !Number.isFinite(d)) return "";
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}
