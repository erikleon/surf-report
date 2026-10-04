// The week page: one table per day, one row per three-hour block.

import { hourCall } from "../call.js";
import { escapeHtml } from "../html.js";
import type { SiteModel } from "../model.js";
import { formatTide, tideAt } from "../tide.js";
import { timeLabel } from "../time.js";
import type { Hour } from "../types.js";
import type { PageContext } from "./context.js";
import { page } from "./layout.js";
import { clock, compass, fullDayName, shortDate, stars, windArrow, windWord } from "./parts.js";

/** The stamp of the three-hour block that contains `stamp`. */
function blockStart(stamp: string): string {
  const h = Math.floor(Number(stamp.slice(11, 13)) / 3) * 3;
  return `${stamp.slice(0, 11)}${String(h).padStart(2, "0")}:00`;
}

/**
 * The hours that start a three-hour block, grouped by New York date.
 *
 * Blocks are picked by the hour in the stamp, so a 25 hour or 23 hour day
 * still gets its midnight, 3 AM, 6 AM and so on. A repeated stamp (the hour
 * that clocks go back through) is listed once. Blocks before the current one
 * are dropped.
 */
export function weekBlocks(hours: Hour[], nowStamp: string): Array<{ date: string; blocks: Hour[] }> {
  const first = blockStart(nowStamp);
  const days = new Map<string, Hour[]>();
  const seen = new Set<string>();
  for (const h of hours) {
    if (Number(h.time.slice(11, 13)) % 3 !== 0 || h.time < first || seen.has(h.time)) continue;
    seen.add(h.time);
    const date = h.time.slice(0, 10);
    const list = days.get(date) ?? [];
    list.push(h);
    days.set(date, list);
  }
  return [...days.entries()].map(([date, blocks]) => ({ date, blocks }));
}

function row(model: SiteModel, h: Hour, rated: boolean): string {
  const when = escapeHtml(timeLabel(h.time));
  if (h.kind === "gap") {
    return `<tr class="gap-row"><th scope="row">${when}</th><td colspan="${rated ? 3 : 2}">No forecast</td></tr>`;
  }
  const call = hourCall(h, model.daylight);
  const water = model.tide !== undefined ? tideAt(model.tide, h.time) : undefined;
  const tide = water !== undefined ? `<span class="tide-line">Tide ${escapeHtml(formatTide(water))}</span>` : "";
  const w = windWord(h.windDirection);
  const rating = rated
    ? `<td class="c-rating">${stars(call.stars, call.swellStars)}<span class="why">${escapeHtml(call.why)}</span></td>`
    : "";
  return (
    `<tr><th scope="row">${when}${tide}</th>${rating}` +
    `<td class="c-wave"><span class="num">${h.waveHeight.toFixed(1)} ft</span><span class="sub">${Math.round(h.wavePeriod)}s</span></td>` +
    `<td class="c-wind"><span class="num">${Math.round(h.windSpeed)} mph</span>` +
    `<span class="sub">${compass(h.windDirection)}, <span class="v-${w.cls}">${w.text}</span> ${windArrow(h.windDirection)}</span></td></tr>`
  );
}

function daySection(model: SiteModel, date: string, blocks: Hour[], rated: boolean, today: string): string {
  const name = date === today ? "Today" : fullDayName(date);
  const heading = `${name} <span class="date">${shortDate(date)}</span>`;
  const head =
    `<tr><th scope="col">Time</th>` +
    (rated ? `<th scope="col">Rating</th>` : "") +
    `<th scope="col">Wave ft</th><th scope="col">Wind</th></tr>`;
  return (
    `<section class="day" id="day-${date}" aria-labelledby="h-${date}">` +
    `<h2 id="h-${date}">${heading}</h2>` +
    `<table class="week${rated ? "" : " unrated"}"><caption class="sr">${escapeHtml(fullDayName(date))} ${shortDate(date)}, three hour blocks, New York time</caption>` +
    `<thead>${head}</thead><tbody>${blocks.map((b) => row(model, b, rated)).join("")}</tbody></table></section>`
  );
}

export function renderWeek(model: SiteModel, ctx: PageContext): string {
  const days = weekBlocks(model.hours, model.nowStamp);
  const rated = model.callState === "ok";
  const today = model.nowStamp.slice(0, 10);

  let notes = "";
  if (model.callState === "stale" && model.callAsOf !== undefined) {
    notes =
      `<p class="stale-note stale"><span class="stale-sq" aria-hidden="true"></span>` +
      `No current ratings. Forecast data is from ${clock(model.callAsOf)}.</p>`;
  } else if (days.length === 0) {
    notes = `<p class="plain">Forecast not loaded yet. Try again in a minute.</p>`;
  }

  const body =
    `<h1 class="page-title">Week</h1>` +
    `<p class="lede">Every three hours, New York time. Wave is open-water wave height in feet.</p>` +
    notes +
    `<div class="week-days">${days.map((d) => daySection(model, d.date, d.blocks, rated, today)).join("")}</div>`;

  return page(ctx, {
    title: "Week - Rockaway surf report",
    description: "Rockaway Beach surf forecast every three hours for the week: rating, wave height and period, wind and tide.",
    path: "/week",
    current: "week",
    body,
  });
}
