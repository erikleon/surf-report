// The forecast timeline, drawn on the server as SVG.
//
// A tile answers "what is it now". This answers "when is it worth going", which
// is a shape rather than a number: where the swell builds, where the wind turns
// onshore and ruins it, and which of those two happen at the same time.
//
// Drawn as SVG rather than with a chart library for the same reason the rest of
// this site has no client framework. It is a picture of an array; a dependency
// that renders it in the browser would ship more code than the picture.
//
// CSS classes the SVG uses, for the stylesheet:
//   chart        the svg element
//   night        shaded block behind the plot for dark hours
//   nodata       shaded block behind the plot for an hour with no forecast
//   grid         horizontal wave height rules
//   tideline     tide height line, one per run of hours the prediction covers
//   axis         wave height labels and the period label
//   day          vertical rule at midnight
//   daylabel     day name at the start of each day
//   wavearea     wave height area, one per run of data hours
//   periodline   wave period line, one per run of data hours
//   bridge       dashed line across a short gap (also wavebridge or periodbridge)
//   vb-good, vb-marg, vb-poor, vb-nodata   one band cell per hour
//   bandlabel    the "call" label beside the band
//   wind         wind arrow, with off, on or cross
//   tick         hour label under the chart
//   head         the playhead group the scrub script moves
//   empty        the message that replaces the chart when there is nothing to draw
//
// Gap hours keep their slot on the axis. The wave and period lines break at a
// gap. A gap of up to three hours with data on both sides is bridged by a
// dashed straight line between the two neighbouring points; the bridge is a
// drawing aid and no bridged number is shown or scored anywhere.

import { windRelativeToBeach, compass } from "./beach.js";
import { CALL_CLASS, CALL_LABEL, hourCall } from "./call.js";
import { nightRects } from "./daylight.js";
import { escapeHtml } from "./html.js";
import type { ScrubCell, ScrubFrame } from "./scrub.js";
import { formatTide, tideAt } from "./tide.js";
import { dayLabel, hourLabel, timeLabel } from "./time.js";
import type { DataHour, Daylight, Hour, TideSeries } from "./types.js";

/** The longest run of gap hours that still gets a dashed bridge. */
const MAX_BRIDGE_HOURS = 3;

/** The wave height axis tops out here unless the swell needs more room. */
const DEFAULT_AXIS_MAX_FT = 6;
/** A forecast wave above this widens the axis so the peak is not pinned to the top. */
const EXPAND_ABOVE_FT = 5.5;
/** Gridline and label spacing, in feet. */
const AXIS_STEP_FT = 2;

/**
 * Top of the wave height axis: 6 ft, or the next even foot above the tallest
 * wave (with 10 percent headroom) once a wave passes 5.5 ft. The tide shares
 * this axis but never moves it.
 */
export function axisMaxFt(tallestWaveFt: number): number {
  if (!(tallestWaveFt > EXPAND_ABOVE_FT)) return DEFAULT_AXIS_MAX_FT;
  return Math.ceil((tallestWaveFt * 1.1) / AXIS_STEP_FT) * AXIS_STEP_FT;
}

/** Keep the hours from `nowStamp` forward, at most `count` of them. */
export function fromNow(hours: Hour[], nowStamp: string, count = 48): Hour[] {
  let start = hours.findIndex((h) => h.time >= nowStamp);
  // Past the end of the forecast, show the last hour rather than nothing.
  if (start < 0) start = Math.max(0, hours.length - 1);
  return hours.slice(start, start + count);
}

const W = 960;
const H = 330;
const PAD = { top: 18, right: 44, bottom: 88, left: 40 };
const PLOT_H = H - PAD.top - PAD.bottom;
/** The verdict band, then the wind row, then the hour ticks. */
const BAND_Y = PAD.top + PLOT_H + 8;
const BAND_H = 12;
const WIND_Y = BAND_Y + BAND_H + 20;

const xAt = (i: number, n: number): number =>
  PAD.left + (n < 2 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));

const f1 = (v: number): string => v.toFixed(1);

/** `[start, end]` inclusive index runs of consecutive hours that match. */
function runsWhere(hours: Hour[], keep: (h: Hour) => boolean): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  hours.forEach((h, i) => {
    if (keep(h)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, hours.length - 1]);
  return runs;
}

function dataAt(hours: Hour[], i: number): DataHour | undefined {
  const h = hours[i];
  return h?.kind === "data" ? h : undefined;
}

export function renderSurfChart(
  hours: Hour[],
  nowStamp: string,
  daylight?: Daylight,
  tide?: TideSeries,
): string {
  const n = hours.length;
  const dataRuns = runsWhere(hours, (h) => h.kind === "data");
  if (n < 2 || dataRuns.length === 0) {
    return `<p class="empty">Not enough forecast data to draw a timeline.</p>`;
  }

  const x = (i: number): number => xAt(i, n);
  const plotBottom = PAD.top + PLOT_H;
  // Cell edges for hour i: from its own x to the next hour's. The last hour
  // reuses the previous slot width so it reaches the plot edge.
  const cellEnd = (i: number): number => (i < n - 1 ? x(i + 1) : x(i) + (x(i) - x(i - 1)));

  const data = hours.filter((h): h is DataHour => h.kind === "data");
  const maxWave = axisMaxFt(Math.max(0, ...data.map((h) => h.waveHeight)));
  const maxPeriod = Math.max(1, ...data.map((h) => h.wavePeriod)) * 1.15;
  const yWave = (v: number): number => plotBottom - (v / maxWave) * PLOT_H;
  const yPeriod = (v: number): number => plotBottom - (v / maxPeriod) * PLOT_H;

  // The tide on the same feet axis as the waves. NOAA predicts it whether or
  // not the forecast has data, so gap hours still get a point. A tide above the
  // axis or below its floor is pinned to the edge rather than widening the axis.
  const tideByStamp = new Map<string, number>();
  tide?.time.forEach((t, i) => {
    const feet = tide.feet[i];
    if (feet !== undefined) tideByStamp.set(t, feet);
  });
  const tideAtHour = (i: number): number | undefined => tideByStamp.get(hours[i]?.time ?? "");
  const yTide = (v: number): number => yWave(Math.min(maxWave, Math.max(0, v)));
  const tideLines = runsWhere(hours, (h) => tideByStamp.has(h.time))
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const pts: string[] = [];
      for (let i = a; i <= b; i++) {
        const v = tideAtHour(i);
        if (v !== undefined) pts.push(`${pts.length === 0 ? "M" : "L"} ${f1(x(i))} ${f1(yTide(v))}`);
      }
      return `<path d="${pts.join(" ")}" class="tideline" fill="none" />`;
    })
    .join("");

  // Wave height as an area, one closed shape per run of data hours. The eye
  // reads bulk as size, which is the point. A single isolated hour has no
  // width to fill, so it draws nothing.
  const area = dataRuns
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const top: string[] = [];
      for (let i = a; i <= b; i++) {
        const h = dataAt(hours, i);
        if (h) top.push(`L ${f1(x(i))} ${f1(yWave(h.waveHeight))}`);
      }
      return (
        `<path d="M ${f1(x(a))} ${f1(plotBottom)} ${top.join(" ")} L ${f1(x(b))} ${f1(plotBottom)} Z" class="wavearea" />`
      );
    })
    .join("");

  const periodLines = dataRuns
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const pts: string[] = [];
      for (let i = a; i <= b; i++) {
        const h = dataAt(hours, i);
        if (h) pts.push(`${pts.length === 0 ? "M" : "L"} ${f1(x(i))} ${f1(yPeriod(h.wavePeriod))}`);
      }
      return `<path d="${pts.join(" ")}" class="periodline" fill="none" />`;
    })
    .join("");

  // A short gap with data on both sides gets a straight dashed line between the
  // two neighbouring points, so a multi-hour gap reads as a ramp. Longer gaps,
  // and gaps at either end of the window, get nothing: there is too little to
  // say what happened in between.
  const bridges = runsWhere(hours, (h) => h.kind === "gap")
    .filter(([a, b]) => a > 0 && b < n - 1 && b - a + 1 <= MAX_BRIDGE_HOURS)
    .map(([a, b]) => {
      const before = dataAt(hours, a - 1);
      const after = dataAt(hours, b + 1);
      if (!before || !after) return "";
      return (
        `<path d="M ${f1(x(a - 1))} ${f1(yWave(before.waveHeight))} L ${f1(x(b + 1))} ${f1(yWave(after.waveHeight))}" ` +
        `class="bridge wavebridge" fill="none" />` +
        `<path d="M ${f1(x(a - 1))} ${f1(yPeriod(before.wavePeriod))} L ${f1(x(b + 1))} ${f1(yPeriod(after.wavePeriod))}" ` +
        `class="bridge periodbridge" fill="none" />`
      );
    })
    .join("");

  // Ground behind the plot for each hour with no forecast, full plot height.
  const shades = hours
    .map((h, i) =>
      h.kind === "gap"
        ? `<rect class="nodata" x="${f1(x(i))}" y="${PAD.top}" width="${f1(cellEnd(i) - x(i))}" height="${PLOT_H}" />`
        : "",
    )
    .join("");

  // Midnight boundaries, so a day is legible without counting hours.
  const dayMarks = hours
    .map((h, i) => ({ t: h.time, i }))
    .filter(({ t, i }) => i === 0 || t.slice(11, 13) === "00")
    .map(({ t, i }) => {
      const rule =
        i === 0
          ? ""
          : `<line x1="${f1(x(i))}" y1="${PAD.top}" x2="${f1(x(i))}" y2="${plotBottom}" class="day" />`;
      return (
        rule +
        `<text x="${f1(x(i) + 5)}" y="${PAD.top + 12}" class="daylabel">${escapeHtml(dayLabel(t, nowStamp))}</text>`
      );
    })
    .join("");

  // One cell per hour, scored by the same function the readout uses.
  const band = hours
    .map((h, i) => {
      const call = hourCall(h, daylight);
      return (
        `<rect class="vb-${CALL_CLASS[call.kind]}" x="${f1(x(i))}" y="${BAND_Y}" ` +
        `width="${(cellEnd(i) - x(i) + 0.6).toFixed(1)}" height="${BAND_H}" />`
      );
    })
    .join("");

  // Wind every three hours: an arrow pointing the way the wind blows, coloured
  // by what it does to this beach and scaled by how hard it does it. Without
  // the length, 4mph onshore and 22mph onshore look identical, and only one of
  // them ends the session. Gap hours have no wind to draw.
  const windMarks = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i % 3 === 0 && h.kind === "data")
    .map(({ h, i }) => {
      if (h.kind !== "data") return "";
      const cls = hourCall(h, daylight).wind ?? "cross";
      const len = 4 + Math.min(11, Math.max(0, h.windSpeed) * 0.55);
      // The meteorological convention is the direction wind comes FROM, so the
      // arrow is drawn pointing the opposite way: where it is going.
      return (
        `<g transform="translate(${f1(x(i))} ${WIND_Y}) rotate(${(h.windDirection + 180) % 360})">` +
        `<path d="M 0 ${(-len).toFixed(1)} L 3.4 ${(len * 0.55).toFixed(1)} ` +
        `L 0 ${(len * 0.28).toFixed(1)} L -3.4 ${(len * 0.55).toFixed(1)} Z" class="wind ${cls}" /></g>`
      );
    })
    .join("");

  const hourTicks = hours
    .map((h, i) => ({ t: h.time, i }))
    .filter(({ i }) => i % 6 === 0)
    .map(({ t, i }) => `<text x="${f1(x(i))}" y="${H - 8}" class="tick">${escapeHtml(hourLabel(t))}</text>`)
    .join("");

  const gridLines = Array.from({ length: Math.floor(maxWave / AXIS_STEP_FT) }, (_, k) => (k + 1) * AXIS_STEP_FT)
    .map((v) => {
      const y = yWave(v);
      return (
        `<line x1="${PAD.left}" y1="${f1(y)}" x2="${W - PAD.right}" y2="${f1(y)}" class="grid" />` +
        `<text x="${PAD.left - 6}" y="${f1(y + 3.5)}" class="axis" text-anchor="end">${v}</text>`
      );
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" ` +
    `data-vbw="${W}" data-x0="${f1(x(0))}" data-x1="${f1(x(n - 1))}" ` +
    `aria-label="Wave height, period, tide, wind and the call for the next ${n} hours">` +
    nightRects(
      hours.map((h) => h.time),
      daylight,
      x,
      PAD.top,
      PLOT_H,
    ) +
    shades +
    gridLines +
    dayMarks +
    area +
    periodLines +
    tideLines +
    bridges +
    band +
    `<text x="${PAD.left - 6}" y="${BAND_Y + 9}" class="bandlabel" text-anchor="end">call</text>` +
    windMarks +
    hourTicks +
    `<text x="${W - PAD.right + 6}" y="${PAD.top + 10}" class="axis">${maxPeriod.toFixed(0)}s</text>` +
    `<g class="head"><line x1="${f1(x(0))}" y1="${PAD.top}" ` +
    `x2="${f1(x(0))}" y2="${BAND_Y + BAND_H}" /><circle cx="${f1(x(0))}" ` +
    `cy="${PAD.top}" r="3" /></g>` +
    `</svg>`
  );
}

/**
 * One readout per hour, formatted here so the browser formats nothing.
 *
 * The reasoning behind each verdict rides along with it: a band that says an
 * hour is poor without saying why is a colour nobody can check. A gap hour
 * gets no numbers at all, only the statement that there is no forecast.
 */
export function surfFrames(
  hours: Hour[],
  nowStamp: string,
  daylight?: Daylight,
  tide?: TideSeries,
): ScrubFrame[] {
  return hours.map((h, i) => {
    const when = i === 0 ? "Now" : dayLabel(h.time, nowStamp);
    const time = timeLabel(h.time);
    const call = hourCall(h, daylight);
    if (h.kind === "gap") {
      return {
        when,
        time,
        cells: [],
        verdict: { label: CALL_LABEL.nodata, cls: CALL_CLASS.nodata },
        note: "No forecast for this hour",
      };
    }

    const rel = windRelativeToBeach(h.windDirection);
    const cells: ScrubCell[] = [
      { k: "Wave", v: `${h.waveHeight.toFixed(1)} ft` },
      { k: "Period", v: `${Math.round(h.wavePeriod)}s` },
      { k: "Wind", v: `${Math.round(h.windSpeed)} mph ${compass(h.windDirection)}` },
      {
        k: "Direction",
        v: rel,
        ...(rel === "offshore" ? { cls: "good" } : rel === "onshore" ? { cls: "poor" } : {}),
      },
    ];
    // The tide only appears for hours the prediction actually reaches. A hole
    // shows as a missing cell rather than as a confident zero.
    const water = tide ? tideAt(tide, h.time) : undefined;
    if (water) cells.push({ k: "Tide", v: formatTide(water) });

    return {
      when,
      time,
      cells,
      verdict: { label: CALL_LABEL[call.kind], cls: CALL_CLASS[call.kind] },
      note: call.why,
    };
  });
}
