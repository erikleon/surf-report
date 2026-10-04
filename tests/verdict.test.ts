import { describe, it, expect } from "vitest";
import { hourCall } from "../src/call.js";
import { dayVerdict } from "../src/verdict.js";
import type { DataHour, Daylight, GapHour, Hour } from "../src/types.js";

const sun: Daylight = {
  sunrise: ["2026-10-03T06:57", "2026-10-04T06:58", "2026-12-31T07:20", "2027-01-01T07:20"],
  sunset: ["2026-10-03T18:15", "2026-10-04T18:13", "2026-12-31T16:40", "2027-01-01T16:41"],
};

const OFFSHORE = 10;
const ONSHORE = 190;

// Good: 4 stars. Raise waveHeight to 3 for 5 stars.
function data(time: string, over: Partial<Omit<DataHour, "kind" | "time">> = {}): DataHour {
  return { kind: "data", time, waveHeight: 2, wavePeriod: 7, windSpeed: 4, windDirection: OFFSHORE, ...over };
}
const gap = (time: string): GapHour => ({ kind: "gap", time });

const MARGINAL = { waveHeight: 1.2 };
const POOR = { windDirection: ONSHORE, windSpeed: 20 };

const day = (date: string, from: number, to: number, make: (t: string) => Hour): Hour[] => {
  const out: Hour[] = [];
  for (let h = from; h <= to; h++) out.push(make(`${date}T${String(h).padStart(2, "0")}:00`));
  return out;
};

describe("dayVerdict", () => {
  it("takes the word, stars and reason from the best hour when a good hour is present", () => {
    const hours = [
      data("2026-10-03T09:00", POOR),
      data("2026-10-03T10:00", MARGINAL),
      data("2026-10-03T11:00", { waveHeight: 3, wavePeriod: 9 }),
      data("2026-10-03T12:00", POOR),
    ];
    const v = dayVerdict(hours, sun, "2026-10-03T08:30");
    expect(v.word).toBe("Worth it");
    expect(v.kind).toBe("good");
    expect(v.stars).toBe(5);
    expect(v.why).toBe("4 mph offshore, 3.0 ft, 9s, daylight");
    expect(v.bestHour).toBe("2026-10-03T11:00");
    expect(v.day).toBe("today");
  });

  it("says Marginal when marginal is the best kind", () => {
    const hours = [data("2026-10-03T09:00", POOR), data("2026-10-03T10:00", MARGINAL)];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v).toMatchObject({ word: "Marginal", kind: "marginal", stars: 2, bestHour: "2026-10-03T10:00" });
    expect(v.why).toBe("4 mph offshore, 1.2 ft, 7s");
  });

  it("says Not today when every hour is poor, with the best poor hour's reason", () => {
    const hours = [
      data("2026-10-03T09:00", { waveHeight: 0.5 }),
      data("2026-10-03T10:00", POOR),
      data("2026-10-03T11:00", { waveHeight: 0.5 }),
    ];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v).toMatchObject({ word: "Not today", kind: "poor", stars: 1, bestHour: "2026-10-03T10:00" });
    expect(v.why).toBe("20 mph onshore");
  });

  it("ranks a marginal hour above a poor one even when the poor hour comes first", () => {
    const hours = [data("2026-10-03T09:00", POOR), data("2026-10-03T10:00", MARGINAL)];
    expect(dayVerdict(hours, sun, "2026-10-03T08:00").kind).toBe("marginal");
  });

  it("counts all of today's daylight before sunrise", () => {
    const hours = day("2026-10-03", 0, 23, (t) => data(t));
    const v = dayVerdict(hours, sun, "2026-10-03T04:00");
    expect(v.day).toBe("today");
    expect(v.cells.map((c) => c.time)).toEqual(day("2026-10-03", 7, 18, (t) => data(t)).map((h) => h.time));
    expect(v.bestHour).toBe("2026-10-03T07:00");
  });

  it("keeps an hour that starts exactly at now", () => {
    const hours = [data("2026-10-03T10:00"), data("2026-10-03T11:00")];
    expect(dayVerdict(hours, sun, "2026-10-03T10:00").cells).toHaveLength(2);
    expect(dayVerdict(hours, sun, "2026-10-03T10:01").cells).toHaveLength(1);
  });

  it("drops today's past hours", () => {
    const hours = day("2026-10-03", 7, 18, (t) => data(t));
    const v = dayVerdict(hours, sun, "2026-10-03T15:30");
    // Sunset is 18:15, so the 18:00 hour is still lit.
    expect(v.cells.map((c) => c.time)).toEqual(["2026-10-03T16:00", "2026-10-03T17:00", "2026-10-03T18:00"]);
  });

  it("moves to tomorrow's daylight hours after sunset", () => {
    const hours = [
      ...day("2026-10-03", 7, 22, (t) => data(t, POOR)),
      ...day("2026-10-04", 0, 23, (t) => data(t, { waveHeight: 3, wavePeriod: 9 })),
    ];
    const v = dayVerdict(hours, sun, "2026-10-03T20:00");
    expect(v.day).toBe("tomorrow");
    expect(v.word).toBe("Worth it");
    expect(v.bestHour).toBe("2026-10-04T07:00");
    expect(v.cells[0]?.time).toBe("2026-10-04T07:00");
    expect(v.cells.at(-1)?.time).toBe("2026-10-04T18:00");
    expect(v.cells.every((c) => c.time.startsWith("2026-10-04"))).toBe(true);
  });

  it("moves to tomorrow when today has no hours left in the series", () => {
    const hours = day("2026-10-04", 8, 10, (t) => data(t));
    const v = dayVerdict(hours, sun, "2026-10-03T22:00");
    expect(v.day).toBe("tomorrow");
    expect(v.cells).toHaveLength(3);
  });

  it("steps over a month and year end to find tomorrow", () => {
    const hours = day("2027-01-01", 8, 9, (t) => data(t));
    const v = dayVerdict(hours, sun, "2026-12-31T22:00");
    expect(v.day).toBe("tomorrow");
    expect(v.cells.map((c) => c.time)).toEqual(["2027-01-01T08:00", "2027-01-01T09:00"]);
  });

  it("returns no forecast with no hours at all", () => {
    expect(dayVerdict([], sun, "2026-10-03T10:00")).toEqual({
      word: "No forecast",
      kind: "none",
      stars: 0,
      why: "No forecast for the remaining daylight hours",
      day: "tomorrow",
      cells: [],
    });
  });

  it("returns no forecast when neither day has a lit hour", () => {
    const hours = [data("2026-10-03T22:00"), data("2026-10-04T02:00")];
    const v = dayVerdict(hours, sun, "2026-10-03T21:00");
    expect(v.kind).toBe("none");
    expect(v.cells).toEqual([]);
  });

  it("shows a gap inside the run as nodata and ignores it for the verdict", () => {
    const hours = [data("2026-10-03T09:00", MARGINAL), gap("2026-10-03T10:00"), data("2026-10-03T11:00", POOR)];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v.cells.map((c) => c.kind)).toEqual(["marginal", "nodata", "poor"]);
    expect(v.kind).toBe("marginal");
    expect(v.bestHour).toBe("2026-10-03T09:00");
  });

  it("never picks a gap hour as best, even when it comes first", () => {
    const hours = [gap("2026-10-03T09:00"), data("2026-10-03T10:00", POOR)];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v.bestHour).toBe("2026-10-03T10:00");
    expect(v.word).toBe("Not today");
  });

  it("says no forecast when every remaining hour is a gap, and keeps the cells", () => {
    const hours = day("2026-10-03", 9, 11, gap);
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v).toMatchObject({ word: "No forecast", kind: "none", stars: 0, day: "today" });
    expect(v.bestHour).toBeUndefined();
    expect(v.cells.map((c) => c.kind)).toEqual(["nodata", "nodata", "nodata"]);
  });

  it("does not fall through to tomorrow when today only has gap hours", () => {
    const hours = [...day("2026-10-03", 9, 10, gap), data("2026-10-04T09:00")];
    expect(dayVerdict(hours, sun, "2026-10-03T08:00").day).toBe("today");
  });

  it("picks the earlier hour when stars tie", () => {
    const hours = [
      data("2026-10-03T09:00", { waveHeight: 2 }),
      data("2026-10-03T10:00", { waveHeight: 2.2 }),
      data("2026-10-03T11:00", { waveHeight: 2 }),
    ];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v.stars).toBe(4);
    expect(v.bestHour).toBe("2026-10-03T09:00");
  });

  it("picks a later hour that has more stars", () => {
    const hours = [data("2026-10-03T09:00"), data("2026-10-03T10:00", { waveHeight: 3, wavePeriod: 9 })];
    const v = dayVerdict(hours, sun, "2026-10-03T08:00");
    expect(v.stars).toBe(5);
    expect(v.bestHour).toBe("2026-10-03T10:00");
  });

  it("builds cells that match hourCall hour for hour", () => {
    const hours: Hour[] = [
      data("2026-10-03T08:00", POOR),
      gap("2026-10-03T09:00"),
      data("2026-10-03T10:00", MARGINAL),
      data("2026-10-03T11:00"),
      data("2026-10-03T12:00", { waveHeight: 0.3 }),
    ];
    const v = dayVerdict(hours, sun, "2026-10-03T07:00");
    expect(v.cells).toEqual(hours.map((h) => ({ time: h.time, kind: hourCall(h, sun).kind })));
  });

  it("treats every hour of the date as lit when there are no sun times", () => {
    const hours = [data("2026-10-03T02:00"), data("2026-10-03T23:00")];
    const v = dayVerdict(hours, undefined, "2026-10-03T01:00");
    expect(v.cells).toHaveLength(2);
    expect(v.day).toBe("today");
  });

  it("treats a date missing from the sun times as lit", () => {
    const hours = [data("2026-11-10T02:00")];
    const v = dayVerdict(hours, sun, "2026-11-10T01:00");
    expect(v.cells).toHaveLength(1);
    expect(v.kind).toBe("good");
  });
});
