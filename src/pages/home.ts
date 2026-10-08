// The home page: the call, the now strip, the 48 hour chart, the next three days.

import { renderSurfChart, fromNow, surfFrames } from "../chart.js";
import { CALL_CLASS, CALL_LABEL } from "../call.js";
import { isDaylight } from "../daylight.js";
import { escapeHtml } from "../html.js";
import type { SiteModel } from "../model.js";
import { renderScrub } from "../scrub.js";
import { tideAt } from "../tide.js";
import { hourLabel } from "../time.js";
import type { DataHour, Hour } from "../types.js";
import { dayVerdict } from "../verdict.js";
import type { PageContext } from "./context.js";
import { page } from "./layout.js";
import { addDays, clock, compass, fullDayName, staleAsOf, stars, windWord } from "./parts.js";

// ---- The call ----

function hourCells(model: SiteModel): string {
  const v = model.verdict;
  if (v === undefined || v.cells.length === 0) return "";
  const items = v.cells
    .map((c) => {
      const label = c.time.slice(11, 13);
      const showLabel = Number(label) % 3 === 0;
      const name = `${hourLabel(c.time)}: ${CALL_LABEL[c.kind]}`;
      return (
        `<li class="cell ${CALL_CLASS[c.kind]}"><span class="cell-fill"></span>` +
        (showLabel ? `<span class="cell-label" aria-hidden="true">${escapeHtml(hourLabel(c.time))}</span>` : "") +
        `<span class="sr">${escapeHtml(name)}</span></li>`
      );
    })
    .join("");
  const when = v.day === "tomorrow" ? "tomorrow" : "today";
  return `<ol class="cells" aria-label="Daylight hours ${when}">${items}</ol>`;
}

function callBlock(model: SiteModel): string {
  const v = model.verdict;
  if (model.callState === "ok" && v !== undefined) {
    if (v.kind === "none") {
      return (
        `<section class="call" aria-label="The call">` +
        `<h1 class="call-word">${escapeHtml(v.word)}</h1>` +
        `<p class="call-why">${escapeHtml(v.why)}</p></section>`
      );
    }
    const asOf = model.callAsOf !== undefined ? `<p class="call-asof">As of ${clock(model.callAsOf)}</p>` : "";
    const day = v.day === "tomorrow" ? `<p class="call-day">Tomorrow</p>` : "";
    return (
      `<section class="call" aria-label="The call">${day}` +
      `<h1 class="call-word">${escapeHtml(v.word)}</h1>${asOf}` +
      `<div class="call-stars">${stars(v.stars, v.swellStars)}</div>` +
      `<p class="call-why">${escapeHtml(v.why)}</p>` +
      hourCells(model) +
      `</section>`
    );
  }
  if (model.callState === "stale" && model.callAsOf !== undefined) {
    return (
      `<section class="call stale" aria-label="The call">` +
      `<h1 class="call-word call-none">No current call.</h1>` +
      `<p class="call-why"><span class="stale-sq" aria-hidden="true"></span>` +
      `Forecast data is from ${clock(model.callAsOf)}.</p></section>`
    );
  }
  return (
    `<section class="call" aria-label="The call">` +
    `<h1 class="call-word call-none">Checking the water...</h1></section>`
  );
}

// ---- The now strip ----

interface Col {
  label: string;
  value: string;
  sub?: string;
  /** Epoch ms of the upstream's last good fetch, when that upstream is stale. */
  staleAt?: number;
}

function col(c: Col): string {
  const stale = c.staleAt !== undefined;
  return (
    `<div class="now-col${stale ? " stale" : ""}"><dt>${c.label}</dt><dd>` +
    c.value +
    (c.sub ? `<span class="sub">${c.sub}</span>` : "") +
    (c.staleAt !== undefined ? staleAsOf(c.staleAt) : "") +
    `</dd></div>`
  );
}

const num = (n: string, unit: string): string => `<span class="num">${n}</span><span class="unit"> ${unit}</span>`;

function nowStrip(model: SiteModel): string {
  const hour: Hour | undefined = fromNow(model.hours, model.nowStamp, 1)[0];
  const marineStale = model.marineState === "stale" ? model.fetchedAt.marine : undefined;
  const forecastStale = model.forecastState === "stale" ? model.fetchedAt.forecast : undefined;
  const tideStale = model.tideState === "stale" ? model.fetchedAt.tides : undefined;
  const none = hour === undefined ? "Not loaded" : "No forecast";
  const cols: Col[] = [];

  const withStale = (c: Col, at: number | undefined): Col => (at === undefined ? c : { ...c, staleAt: at });
  if (hour?.kind === "data") {
    const d: DataHour = hour;
    const w = windWord(d.windDirection);
    cols.push(withStale({ label: "Wave", value: num(d.waveHeight.toFixed(1), "ft") }, marineStale));
    cols.push(withStale({ label: "Period", value: num(String(Math.round(d.wavePeriod)), "s") }, marineStale));
    cols.push(
      withStale(
        {
          label: "Wind",
          value: num(String(Math.round(d.windSpeed)), "mph"),
          sub: `${compass(d.windDirection)}, <span class="v-${w.cls}">${w.text}</span>`,
        },
        forecastStale,
      ),
    );
  } else {
    const missing = (label: string): Col => ({ label, value: `<span class="none">${none}</span>` });
    cols.push(withStale(missing("Wave"), marineStale), withStale(missing("Period"), marineStale));
    cols.push(withStale(missing("Wind"), forecastStale));
  }

  const water = model.tide !== undefined ? tideAt(model.tide, hour?.time ?? model.nowStamp) : undefined;
  if (water !== undefined) {
    cols.push(withStale({ label: "Tide", value: num(water.feet.toFixed(1), "ft"), sub: water.trend }, tideStale));
  }

  return `<section aria-labelledby="h-now"><h2 id="h-now" class="label">Now</h2><dl class="now">${cols.map(col).join("")}</dl></section>`;
}

// ---- The chart ----

function chartBlock(model: SiteModel): string {
  const window = fromNow(model.hours, model.nowStamp);
  const chart = renderSurfChart(window, model.nowStamp, model.daylight, model.tide);
  // With the call hidden, the readout must not show a per-hour verdict either.
  const hideCall = model.callState !== "ok";
  const frames = surfFrames(window, model.nowStamp, model.daylight, model.tide).map((f) => {
    if (!hideCall) return f;
    const { verdict: _verdict, note: _note, ...raw } = f;
    return raw;
  });
  const body = window.length >= 2 ? renderScrub(frames, chart) : chart;
  const old =
    (model.marineState === "stale" || model.forecastState === "stale") && model.callAsOf !== undefined
      ? `<p class="stale-note stale"><span class="stale-sq" aria-hidden="true"></span>Forecast data is from ${clock(model.callAsOf)}.</p>`
      : "";
  return `<section aria-labelledby="h-chart"><h2 id="h-chart" class="label">Next 48 hours</h2>${old}` +
    `<div class="${hideCall ? "nocall" : "withcall"}">${body}</div></section>`;
}

// ---- The next three days ----

function waveRange(model: SiteModel, date: string): string | undefined {
  const waves = model.hours
    .filter((h): h is DataHour => h.kind === "data" && h.time.slice(0, 10) === date)
    .filter((h) => model.daylight === undefined || isDaylight(h.time, model.daylight) !== false)
    .map((h) => h.waveHeight);
  if (waves.length === 0) return undefined;
  const lo = Math.min(...waves).toFixed(1);
  const hi = Math.max(...waves).toFixed(1);
  return lo === hi ? `${lo} ft` : `${lo} to ${hi} ft`;
}

function nextDays(model: SiteModel): string {
  const today = model.nowStamp.slice(0, 10);
  const rows: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const date = addDays(today, n);
    if (!model.hours.some((h) => h.time.slice(0, 10) === date)) continue;
    // Scoring from midnight makes the verdict cover the whole daylight day.
    // When the day has no daylight hours it falls through to the next day, and
    // the row then shows raw numbers only.
    const v = dayVerdict(model.hours, model.daylight, `${date}T00:00`);
    const range = waveRange(model, date) ?? "No forecast";
    const rated = model.callState === "ok" && v.day === "today" && v.kind !== "none";
    rows.push(
      `<li><a class="dayrow" href="/week#day-${date}"><span class="d-name">${fullDayName(date)}</span>` +
        `<span class="d-call">${rated ? `${escapeHtml(v.word)} ${stars(v.stars, v.swellStars)}` : ""}</span>` +
        `<span class="d-wave">${escapeHtml(range)}</span></a></li>`,
    );
  }
  if (rows.length === 0) return "";
  return `<section aria-labelledby="h-days"><h2 id="h-days" class="label">Next three days</h2><ul class="days">${rows.join("")}</ul></section>`;
}

export function renderHome(model: SiteModel, ctx: PageContext): string {
  const body =
    callBlock(model) +
    nowStrip(model) +
    chartBlock(model) +
    nextDays(model) +
    `<p class="more"><a href="/about">How the rating works</a></p>`;
  return page(ctx, {
    title: "Rockaway surf report",
    description:
      "Surf forecast for Rockaway Beach, NYC: wave height, period, wind and tide, with a plain call on whether it is worth going.",
    path: "/",
    current: "today",
    script: true,
    body,
  });
}
