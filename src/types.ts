// Types shared between the fetchers, the cache, the call logic and the pages.
//
// Every "now" in this codebase is epoch milliseconds, a plain number. A Date
// carries the host's timezone, and the site's hours are New York hours.
//
// Forecast hours are strings like "2026-10-03T06:00" in New York local time,
// compared as strings. They are never parsed into a Date.

/** What a fetcher gives back. A failure carries a reason a person can read. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Injected so tests can serve saved responses. Defaults to the global fetch. */
export type FetchFn = typeof fetch;

// ---- What the three upstreams give back, before they are combined ----

/** Open-Meteo marine. A null is an hour the marine model does not cover. */
export interface MarineSeries {
  time: string[];
  /** Feet. */
  waveHeight: Array<number | null>;
  /** Seconds. */
  wavePeriod: Array<number | null>;
}

/** Open-Meteo forecast: wind, plus one sunrise and sunset per day. */
export interface ForecastSeries {
  time: string[];
  /** Miles per hour. */
  windSpeed: Array<number | null>;
  /** Degrees the wind comes FROM. */
  windDirection: Array<number | null>;
  /** One local stamp per day, "2026-10-03T06:57". */
  sunrise: string[];
  sunset: string[];
}

/** NOAA tide predictions, hourly, in feet above MLLW. */
export interface TideSeries {
  time: string[];
  feet: number[];
}

/** Sunrise and sunset per day. A slice of ForecastSeries. */
export interface Daylight {
  sunrise: string[];
  sunset: string[];
}

// ---- One hour of the forecast ----

/** An hour with all four values. */
export interface DataHour {
  kind: "data";
  time: string;
  waveHeight: number;
  wavePeriod: number;
  windSpeed: number;
  windDirection: number;
}

/**
 * An hour the forecast does not cover. It keeps its place in the series so
 * every hour is one slot wide on the chart; it carries no numbers.
 */
export interface GapHour {
  kind: "gap";
  time: string;
}

export type Hour = DataHour | GapHour;

// ---- The call ----

export type CallKind = "good" | "marginal" | "poor" | "nodata";
export type WindClass = "off" | "on" | "cross";

export interface HourCall {
  kind: CallKind;
  /** 0 to 5. Poor is 0 or 1, marginal 2 or 3, good 4 or 5, nodata 0. */
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  /** The rule that produced the verdict, in words. */
  why: string;
  /** Present for a data hour: what the wind does to this beach. */
  wind?: WindClass;
}

export interface HourCell {
  time: string;
  kind: CallKind;
}

/** The first-screen answer: one word, stars, a reason, and the hour cells. */
export interface DayVerdict {
  word: "Worth it" | "Marginal" | "Not today" | "No forecast";
  /** "none" when there is no data hour left to judge. */
  kind: CallKind | "none";
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  why: string;
  /** Local stamp of the hour the word, stars and reason came from. */
  bestHour?: string;
  /** Whose daylight hours the cells cover. */
  day: "today" | "tomorrow";
  cells: HourCell[];
}
