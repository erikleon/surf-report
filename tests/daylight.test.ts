import { describe, it, expect } from "vitest";
import { isDaylight, nightSpans, nightRects } from "../src/daylight.js";

const sun = {
  sunrise: ["2026-09-05T06:30", "2026-09-06T06:31"],
  sunset: ["2026-09-05T19:30", "2026-09-06T19:28"],
};

describe("isDaylight", () => {
  it("puts midday inside the day and midnight outside it", () => {
    expect(isDaylight("2026-09-05T12:00", sun)).toBe(true);
    expect(isDaylight("2026-09-05T00:00", sun)).toBe(false);
    expect(isDaylight("2026-09-05T22:00", sun)).toBe(false);
  });

  it("counts sunrise as day and sunset as night", () => {
    expect(isDaylight("2026-09-05T06:30", sun)).toBe(true);
    expect(isDaylight("2026-09-05T19:30", sun)).toBe(false);
  });

  it("uses each day's own sun times", () => {
    expect(isDaylight("2026-09-06T19:29", sun)).toBe(false);
    expect(isDaylight("2026-09-05T19:29", sun)).toBe(true);
  });

  // A day we have no sun times for is not the same thing as a dark day, and
  // the two must stay distinguishable or a gap in the forecast shades the
  // whole chart as night.
  it("is undefined for a day with no sun times, not false", () => {
    expect(isDaylight("2026-09-09T12:00", sun)).toBeUndefined();
  });

  it("is undefined when the sunset for a matched sunrise is missing", () => {
    expect(isDaylight("2026-09-05T12:00", { sunrise: ["2026-09-05T06:30"], sunset: [] })).toBeUndefined();
  });

  it("is undefined for empty sun times", () => {
    expect(isDaylight("2026-09-05T12:00", { sunrise: [], sunset: [] })).toBeUndefined();
  });
});

describe("nightSpans", () => {
  it("finds a run of dark hours as a half-open range", () => {
    const times = ["2026-09-05T04:00", "2026-09-05T05:00", "2026-09-05T07:00", "2026-09-05T08:00"];
    expect(nightSpans(times, sun)).toEqual([[0, 2]]);
  });

  it("carries a run across midnight as one span", () => {
    const times = [
      "2026-09-05T19:00",
      "2026-09-05T20:00",
      "2026-09-06T00:00",
      "2026-09-06T05:00",
      "2026-09-06T07:00",
    ];
    expect(nightSpans(times, sun)).toEqual([[1, 4]]);
  });

  it("closes a run that reaches the end of the series", () => {
    const times = ["2026-09-05T18:00", "2026-09-05T20:00", "2026-09-05T21:00"];
    expect(nightSpans(times, sun)).toEqual([[1, 3]]);
  });

  it("treats an hour of unknown daylight as lit", () => {
    const times = ["2026-09-09T00:00", "2026-09-09T01:00"];
    expect(nightSpans(times, sun)).toEqual([]);
  });

  it("returns no spans for an empty series", () => {
    expect(nightSpans([], sun)).toEqual([]);
  });

  it("returns two spans for two separate dark runs", () => {
    const times = ["2026-09-05T03:00", "2026-09-05T12:00", "2026-09-05T21:00"];
    expect(nightSpans(times, sun)).toEqual([[0, 1], [2, 3]]);
  });
});

describe("nightRects", () => {
  const x = (i: number): number => 40 + i * 10;

  it("draws nothing when there are no sun times at all", () => {
    expect(nightRects(["2026-09-05T00:00", "2026-09-05T01:00"], undefined, x, 0, 100)).toBe("");
  });

  it("draws nothing for a series too short to have a slot width", () => {
    expect(nightRects(["2026-09-05T00:00"], sun, x, 0, 100)).toBe("");
  });

  it("draws nothing when every hour is lit", () => {
    expect(nightRects(["2026-09-05T10:00", "2026-09-05T11:00"], sun, x, 0, 100)).toBe("");
  });

  it("draws one rect per dark run", () => {
    const times = ["2026-09-05T04:00", "2026-09-05T05:00", "2026-09-05T07:00", "2026-09-05T08:00"];
    const out = nightRects(times, sun, x, 18, 200);
    expect(out.match(/<rect/g)).toHaveLength(1);
    expect(out).toContain('class="night"');
    expect(out).toContain('x="40.0"');
    expect(out).toContain('width="20.0"');
  });

  // A run that reaches the last hour would otherwise stop at that hour's own
  // x and leave a lit sliver at the right edge that means nothing.
  it("widens a trailing run by one slot so it reaches the edge", () => {
    const times = ["2026-09-05T18:00", "2026-09-05T20:00", "2026-09-05T21:00"];
    const out = nightRects(times, sun, x, 0, 100);
    // Hours 1 and 2 are dark, one slot each, so the run ends at the plot edge
    // rather than at hour 2's own x.
    expect(out).toContain('x="50.0"');
    expect(out).toContain('width="20.0"');
  });
});
