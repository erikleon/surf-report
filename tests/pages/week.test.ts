import { describe, expect, it } from "vitest";
import { renderWeek } from "../../src/pages/index.js";
import { weekBlocks } from "../../src/pages/week.js";
import { buildModel, type SiteModel } from "../../src/model.js";
import type { Hour } from "../../src/types.js";
import { MIN, NOW, count, ctx, freshModel, snap } from "./helpers.js";

/** The row header times of one day's table, in order. */
function rowTimes(html: string, date: string): string[] {
  const section = html.split(`id="day-${date}"`)[1]?.split("</section>")[0] ?? "";
  return [...section.matchAll(/<th scope="row">([^<]+)/g)].map((m) => m[1] as string);
}

function dataHour(time: string): Hour {
  return { kind: "data", time, waveHeight: 2, wavePeriod: 8, windSpeed: 5, windDirection: 0 };
}

function withHours(hours: Hour[], nowStamp: string): SiteModel {
  return { ...freshModel(), hours, nowStamp, tide: undefined } as unknown as SiteModel;
}

describe("week page", () => {
  const model = freshModel();
  const html = renderWeek(model, ctx);

  it("has one section per day, each with an h2 and a table", () => {
    const days = new Set(model.hours.map((h) => h.time.slice(0, 10)));
    expect(count(html, /<section class="day"/g)).toBe(days.size);
    expect(count(html, /<table\b/g)).toBe(days.size);
    expect(html).toContain('id="day-2026-10-03"');
    expect(html).toContain('id="day-2026-10-09"');
  });

  it("uses column and row header scopes", () => {
    const section = html.split('id="day-2026-10-04"')[1]?.split("</section>")[0] ?? "";
    for (const h of ["Time", "Rating", "Wave ft", "Wind"]) expect(section).toContain(`<th scope="col">${h}</th>`);
    expect(section).toContain("<caption");
    expect(count(section, /<th scope="row">/g)).toBe(8);
    expect(rowTimes(html, "2026-10-04")).toEqual([
      "12:00 AM",
      "3:00 AM",
      "6:00 AM",
      "9:00 AM",
      "12:00 PM",
      "3:00 PM",
      "6:00 PM",
      "9:00 PM",
    ].map((t) => t));
  });

  it("starts today at the current block", () => {
    // 10:00 AM sits in the 9:00 AM block.
    expect(rowTimes(html, "2026-10-03")).toEqual(["9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM", "9:00 PM"]);
  });

  it("shows stars with a reason, wave height, period, wind and a tide line", () => {
    const section = html.split('id="day-2026-10-04"')[1]?.split("</section>")[0] ?? "";
    expect(section).toMatch(/class="stars" role="img" aria-label="\d of 5 stars/);
    expect(section).toMatch(/<span class="why">/);
    expect(section).toMatch(/\d\.\d ft<\/span><span class="sub">\d+s/);
    expect(section).toMatch(/\d+ mph<\/span>/);
    expect(section).toContain('class="arrow"');
    expect(section).toMatch(/<span class="tide-line">Tide \d\.\d ft (rising|falling|slack)/);
  });

  it("shows only the blocks a short day has", () => {
    const hours = ["2026-10-05T06:00", "2026-10-05T07:00", "2026-10-05T08:00", "2026-10-05T09:00", "2026-10-05T10:00"].map(dataHour);
    const out = renderWeek(withHours(hours, "2026-10-05T00:00"), ctx);
    expect(rowTimes(out, "2026-10-05")).toEqual(["6:00 AM", "9:00 AM"]);
  });

  it("renders a gap block as No forecast and nothing else", () => {
    const hours: Hour[] = [dataHour("2026-10-05T06:00"), { kind: "gap", time: "2026-10-05T09:00" }];
    const out = renderWeek(withHours(hours, "2026-10-05T00:00"), ctx);
    expect(out).toContain('<tr class="gap-row"><th scope="row">9:00 AM</th><td colspan="3">No forecast</td></tr>');
  });

  it("hides ratings and says so when the call is stale", () => {
    const m = buildModel(snap(NOW - 45 * MIN, NOW - 45 * MIN, NOW - 5 * MIN), NOW);
    const out = renderWeek(m, ctx);
    expect(out).not.toContain('<th scope="col">Rating</th>');
    expect(out).not.toContain('class="stars"');
    expect(out).toContain("Forecast data is from 9:15 AM.");
    expect(out).toContain("<th scope=\"col\">Wave ft");
  });

  it("says the forecast is not loaded when there are no hours", () => {
    const out = renderWeek(buildModel(snap(), NOW), ctx);
    expect(out).toContain("Forecast not loaded yet.");
    expect(count(out, /<table/g)).toBe(0);
  });
});

describe("week blocks across clock changes", () => {
  it("keeps the eight blocks on the 25 hour fall-back day", () => {
    // Clocks go back at 2 AM: the 1 AM hour appears twice in a 25 hour day.
    const stamps: string[] = [];
    for (let h = 0; h < 24; h++) {
      const s = `2026-11-01T${String(h).padStart(2, "0")}:00`;
      stamps.push(s);
      if (h === 1) stamps.push(s);
    }
    expect(stamps).toHaveLength(25);
    const days = weekBlocks(stamps.map(dataHour), "2026-11-01T00:00");
    expect(days).toHaveLength(1);
    expect(days[0]?.blocks.map((b) => b.time.slice(11))).toEqual([
      "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00",
    ]);
    const out = renderWeek(withHours(stamps.map(dataHour), "2026-11-01T00:00"), ctx);
    expect(count(out, /<th scope="row">/g)).toBe(8);
    expect(out).toContain('id="day-2026-11-01"');
  });

  it("keeps the eight blocks on the 23 hour spring-forward day", () => {
    // Clocks jump from 2 AM to 3 AM: there is no 02:00 stamp.
    const stamps: string[] = [];
    for (let h = 0; h < 24; h++) if (h !== 2) stamps.push(`2026-03-08T${String(h).padStart(2, "0")}:00`);
    expect(stamps).toHaveLength(23);
    const days = weekBlocks(stamps.map(dataHour), "2026-03-08T00:00");
    expect(days[0]?.blocks.map((b) => b.time.slice(11))).toEqual([
      "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00",
    ]);
    const out = renderWeek(withHours(stamps.map(dataHour), "2026-03-08T00:00"), ctx);
    expect(rowTimes(out, "2026-03-08")).toHaveLength(8);
  });

  it("drops blocks before the current one", () => {
    const stamps = Array.from({ length: 24 }, (_, h) => `2026-10-03T${String(h).padStart(2, "0")}:00`);
    const days = weekBlocks(stamps.map(dataHour), "2026-10-03T14:00");
    expect(days[0]?.blocks.map((b) => b.time.slice(11))).toEqual(["12:00", "15:00", "18:00", "21:00"]);
  });
});
