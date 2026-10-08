// The day page: one calendar day in detail. The chart and readout, an hourly
// table and the map, all for the 24 hours of that New York date.

import { escapeHtml } from "../html.js";
import type { SiteModel } from "../model.js";
import { dayVerdict } from "../verdict.js";
import type { PageContext } from "./context.js";
import { timelineBlock } from "./home.js";
import { page } from "./layout.js";
import { mapHead, mapSection } from "./map.js";
import { addDays, clock, fullDayName, shortDate, stars } from "./parts.js";
import { hourTable } from "./week.js";

/** Undefined when the forecast has no hours on this date, which the server answers with a 404. */
export function renderDay(model: SiteModel, ctx: PageContext, date: string): string | undefined {
  const hours = model.hours.filter((h) => h.time.slice(0, 10) === date);
  if (hours.length === 0) return undefined;

  const today = model.nowStamp.slice(0, 10);
  const name = date === today ? "Today" : fullDayName(date);
  const rated = model.callState === "ok";

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const has = (d: string): boolean => model.hours.some((h) => h.time.slice(0, 10) === d);
  const daynav =
    `<p class="daynav"><a href="/week">All days</a>` +
    (has(prev) ? `<a href="/day/${prev}" rel="prev">Previous day</a>` : "") +
    (has(next) ? `<a href="/day/${next}" rel="next">Next day</a>` : "") +
    `</p>`;

  // Scoring from midnight makes the verdict cover the whole daylight day.
  const v = dayVerdict(model.hours, model.daylight, `${date}T00:00`);
  const call =
    rated && v.day === "today" && v.kind !== "none"
      ? `<p class="day-call">${escapeHtml(v.word)} ${stars(v.stars, v.swellStars)}</p>`
      : "";

  const stale =
    model.callState === "stale" && model.callAsOf !== undefined
      ? `<p class="stale-note stale"><span class="stale-sq" aria-hidden="true"></span>` +
        `No current ratings. Forecast data is from ${clock(model.callAsOf)}.</p>`
      : "";

  const m = ctx.assets.map;
  const map =
    m === undefined
      ? ""
      : `<section aria-labelledby="h-day-map"><h2 id="h-day-map" class="label">Map</h2>` +
        `<p class="plain">The moving lines are the wind forecast over the water. The slider covers this day.</p>` +
        `${mapSection(m, date)}</section>`;

  const body =
    daynav +
    `<h1 class="page-title">${escapeHtml(name)} <span class="date">${shortDate(date)}</span></h1>` +
    `<p class="lede">Midnight to midnight, New York time.</p>` +
    call +
    stale +
    timelineBlock(model, hours, "24 hours", true) +
    `<section aria-labelledby="h-day-table"><h2 id="h-day-table" class="label">Hour by hour</h2>` +
    hourTable(model, hours, rated, `${fullDayName(date)} ${shortDate(date)}, every hour, New York time`) +
    `</section>` +
    map;

  return page(ctx, {
    title: `${fullDayName(date)} ${shortDate(date)} - Rockaway surf report`,
    description: `Rockaway Beach surf forecast for ${fullDayName(date)} ${shortDate(date)}: hourly chart, table and wind map.`,
    path: `/day/${date}`,
    current: "week",
    script: true,
    ...(m === undefined ? {} : { head: mapHead(m) }),
    body,
  });
}
