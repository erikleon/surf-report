// Shared setup for the page tests: models built from the saved upstream
// fixtures through the real parsers, and a page context with fake asset URLs.

import type { CacheSnapshot } from "../../src/cache.js";
import { buildModel, type SiteModel } from "../../src/model.js";
import type { PageContext } from "../../src/pages/index.js";
import { parseForecast } from "../../src/upstream/forecast.js";
import { parseMarine } from "../../src/upstream/marine.js";
import { parseTides } from "../../src/upstream/tides.js";
import { fixture } from "../upstream/fakeFetch.js";

/** 10:00 in New York on 2026-10-03. */
export const NOW = Date.UTC(2026, 9, 3, 14, 0);
/** 22:00 in New York on 2026-10-03, after sunset. */
export const NOW_NIGHT = Date.UTC(2026, 9, 4, 2, 0);
export const MIN = 60_000;

function load<T>(parse: (b: unknown) => { ok: boolean; value?: T }, file: string): T {
  const r = parse(JSON.parse(fixture(file)));
  if (!r.ok || r.value === undefined) throw new Error(`bad fixture ${file}`);
  return r.value;
}

export const marine = load(parseMarine, "marine.json");
export const forecast = load(parseForecast, "forecast.json");
export const tides = load(parseTides, "tides.json");

export const ctx: PageContext = {
  nowMs: NOW,
  siteUrl: "https://surf.example.test",
  assets: {
    css: "/assets/site.abc123.css",
    js: "/assets/scrub.def456.js",
    geist: "/assets/geist.111.woff2",
    serif: "/assets/serif.222.woff2",
  },
};

export function snap(marineAt?: number, forecastAt?: number, tidesAt?: number): CacheSnapshot {
  return {
    marine: marineAt === undefined ? {} : { value: marine, fetchedAt: marineAt },
    forecast: forecastAt === undefined ? {} : { value: forecast, fetchedAt: forecastAt },
    tides: tidesAt === undefined ? {} : { value: tides, fetchedAt: tidesAt },
  };
}

/** A complete snapshot fetched five minutes before `nowMs`. */
export function freshModel(nowMs = NOW): SiteModel {
  const at = nowMs - 5 * MIN;
  return buildModel(snap(at, at, at), nowMs);
}

/** Every page, rendered from the same fresh model, for the checks that apply to all of them. */
export function allPages(
  render: {
    home: (m: SiteModel, c: PageContext) => string;
    week: (m: SiteModel, c: PageContext) => string;
    about: (m: SiteModel, c: PageContext) => string;
    notFound: (c: PageContext) => string;
    unavailable: (c: PageContext) => string;
  },
  c: PageContext = ctx,
  m: SiteModel = freshModel(),
): Record<string, string> {
  return {
    home: render.home(m, c),
    week: render.week(m, c),
    about: render.about(m, c),
    notFound: render.notFound(c),
    unavailable: render.unavailable(c),
  };
}

export function count(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}
