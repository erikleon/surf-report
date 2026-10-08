import { describe, it, expect } from "vitest";
import { axisMaxFt, fromNow, renderSurfChart, surfFrames } from "../src/chart.js";
import type { DataHour, GapHour, Hour, TideSeries } from "../src/types.js";

const stamp = (i: number): string => {
  const day = 5 + Math.floor(i / 24);
  return `2026-09-${String(day).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`;
};

const NOW = "2026-09-05T00:00";

function data(i: number, over: Partial<DataHour> = {}): DataHour {
  return { kind: "data", time: stamp(i), waveHeight: 2, wavePeriod: 8, windSpeed: 5, windDirection: 10, ...over };
}
function gap(i: number): GapHour {
  return { kind: "gap", time: stamp(i) };
}

// Four hours as the old fixture had them: dark, then growing swell, then a
// next-day midnight.
const base: Hour[] = [
  { kind: "data", time: "2026-09-05T00:00", waveHeight: 1.0, wavePeriod: 7, windSpeed: 5, windDirection: 10 },
  { kind: "data", time: "2026-09-05T01:00", waveHeight: 1.4, wavePeriod: 8, windSpeed: 9, windDirection: 10 },
  { kind: "data", time: "2026-09-05T02:00", waveHeight: 2.0, wavePeriod: 9, windSpeed: 14, windDirection: 190 },
  { kind: "data", time: "2026-09-06T00:00", waveHeight: 3.0, wavePeriod: 11, windSpeed: 20, windDirection: 190 },
];

const sun = {
  sunrise: ["2026-09-05T06:30", "2026-09-06T06:31"],
  sunset: ["2026-09-05T19:30", "2026-09-06T19:28"],
};

/** Ten data hours with the given indices turned into gaps. */
function withGaps(gaps: number[], count = 10): Hour[] {
  return Array.from({ length: count }, (_, i) => (gaps.includes(i) ? gap(i) : data(i, { waveHeight: 1 + i * 0.2, wavePeriod: 6 + i })));
}

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe("fromNow", () => {
  it("starts at the current hour, not at the start of the data", () => {
    expect(fromNow(base, "2026-09-05T01:00", 48)[0]?.time).toBe("2026-09-05T01:00");
  });

  it("starts at the next hour when now falls between two", () => {
    expect(fromNow(base, "2026-09-05T01:30", 48)[0]?.time).toBe("2026-09-05T02:00");
  });

  it("caps the window", () => {
    expect(fromNow(base, NOW, 2)).toHaveLength(2);
  });

  it("defaults to 48 hours", () => {
    const many = Array.from({ length: 80 }, (_, i) => data(i));
    expect(fromNow(many, NOW)).toHaveLength(48);
  });

  // Past the end of the forecast, show the last hour rather than nothing.
  it("does not return an empty window when now is past the data", () => {
    const w = fromNow(base, "2027-01-01T00:00", 48);
    expect(w).toHaveLength(1);
    expect(w[0]?.time).toBe("2026-09-06T00:00");
  });

  it("returns nothing for no hours", () => {
    expect(fromNow([], NOW)).toEqual([]);
  });

  it("keeps gap hours in the window", () => {
    expect(fromNow([data(0), gap(1), data(2)], NOW)).toHaveLength(3);
  });
});

describe("renderSurfChart", () => {
  it("draws an svg with the wave area and the period line", () => {
    const svg = renderSurfChart(base, NOW);
    expect(svg).toContain("<svg");
    expect(svg).toContain("wavearea");
    expect(svg).toContain("periodline");
  });

  it("colours the wind by what it does to this beach", () => {
    expect(renderSurfChart(base, NOW)).toContain("wind off");
  });

  it("draws onshore and cross shore wind classes", () => {
    const hours = [data(0, { windDirection: 190 }), data(1), data(2), data(3, { windDirection: 100 })];
    const svg = renderSurfChart(hours, NOW);
    expect(svg).toContain("wind on");
    expect(svg).toContain("wind cross");
  });

  it("marks the day boundary", () => {
    const svg = renderSurfChart(base, NOW);
    expect(svg).toContain("daylabel");
    expect(svg).toContain("Today");
    expect(svg).toContain("Sun");
  });

  it("says so rather than drawing a line through one point", () => {
    expect(renderSurfChart([data(0)], NOW)).toContain("Not enough forecast data");
    expect(renderSurfChart([], NOW)).toContain("Not enough forecast data");
  });

  it("shades the dark hours when it knows the sun times", () => {
    expect(renderSurfChart(base, NOW, sun)).toContain('class="night"');
  });

  // Without sun times the chart is still a chart. Shading everything, or
  // nothing but silently, would both be worse than leaving it out.
  it("draws no night at all without sun times", () => {
    expect(renderSurfChart(base, NOW)).not.toContain('class="night"');
  });

  it("scores every hour into the band", () => {
    const svg = renderSurfChart(base, NOW, sun);
    expect(count(svg, /class="vb-(good|marg|poor)"/g)).toBe(base.length);
  });

  it("never tints anything amber", () => {
    const svg = renderSurfChart(withGaps([3]), NOW, sun);
    expect(svg).not.toContain("amber");
  });

  // Colour says what the wind does to the beach; only length says how hard.
  it("scales the wind arrow by speed", () => {
    const calm = base.map((h, i) => data(i, { windSpeed: 2 }));
    const gale = base.map((h, i) => data(i, { windSpeed: 30 }));
    const arm = (svg: string): number => Number(svg.match(/<path d="M 0 (-[\d.]+)/)?.[1] ?? 0);
    expect(Math.abs(arm(renderSurfChart(gale, NOW, sun)))).toBeGreaterThan(Math.abs(arm(renderSurfChart(calm, NOW, sun))));
  });

  it("publishes the geometry the scrubber needs to map a pointer to an hour", () => {
    const svg = renderSurfChart(base, NOW, sun);
    expect(svg).toMatch(/data-vbw="\d+"/);
    expect(svg).toMatch(/data-x0="[\d.]+"/);
    expect(svg).toMatch(/data-x1="[\d.]+"/);
  });

  it("carries a playhead, parked on the first hour", () => {
    expect(renderSurfChart(base, NOW, sun)).toContain('<g class="head">');
  });

  it("spaces hours by index, not by clock", () => {
    // The base series jumps from 02:00 to the next midnight; the slots stay even.
    const svg = renderSurfChart(base, NOW);
    const xs = [...svg.matchAll(/<rect class="vb-\w+" x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(4);
    const step = (xs[1] as number) - (xs[0] as number);
    expect((xs[3] as number) - (xs[2] as number)).toBeCloseTo(step, 0);
  });

  it("emits exactly one closed svg element", () => {
    const svg = renderSurfChart(withGaps([2, 3]), NOW, sun);
    expect(count(svg, /<svg/g)).toBe(1);
    expect(count(svg, /<\/svg>/g)).toBe(1);
  });
});

describe("gap hours in the chart", () => {
  const bridgePaths = (svg: string): string[] => [...svg.matchAll(/<path d="([^"]*)" class="bridge[^"]*"/g)].map((m) => m[1] as string);
  const wavePath = (svg: string): string => (svg.match(/<path d="([^"]*)" class="bridge wavebridge"/)?.[1] ?? "");
  const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

  it("bridges a one hour gap with a dashed line between the neighbours", () => {
    const hours = withGaps([4]);
    const svg = renderSurfChart(hours, NOW);
    expect(svg).toContain('class="bridge wavebridge"');
    expect(svg).toContain('class="bridge periodbridge"');

    const a = hours[3] as DataHour;
    const b = hours[5] as DataHour;
    const [x1, y1, x2, y2] = nums(wavePath(svg)) as [number, number, number, number];
    // The ends sit on the neighbours' x positions, three slots apart overall.
    const slot = (x2 - x1) / 2;
    expect(slot).toBeGreaterThan(0);
    // Both ends match the y the wave line uses for those neighbours: the
    // higher neighbour sits higher up the plot (smaller y).
    expect(a.waveHeight).toBeLessThan(b.waveHeight);
    expect(y2).toBeLessThan(y1);
  });

  it("puts the bridge endpoints exactly on the neighbouring line points", () => {
    const svg = renderSurfChart(withGaps([4]), NOW);
    const bridge = nums(wavePath(svg));
    const area = svg.match(/<path d="([^"]*)" class="wavearea"/g) ?? [];
    expect(area).toHaveLength(2);
    // The first run ends where the bridge starts; the second begins where it ends.
    const firstRun = nums(area[0] as string);
    const secondRun = nums(area[1] as string);
    // Area path: M x yBottom, L points..., L xEnd yBottom Z. The last top point
    // is the pair before the closing corner.
    const lastTop = firstRun.slice(-4, -2);
    const firstTop = secondRun.slice(2, 4);
    expect(bridge.slice(0, 2)).toEqual(lastTop);
    expect(bridge.slice(2, 4)).toEqual(firstTop);
  });

  it("adds a nodata shade and a vb-nodata band cell for the gap hour", () => {
    const svg = renderSurfChart(withGaps([4]), NOW);
    expect(count(svg, /class="nodata"/g)).toBe(1);
    expect(count(svg, /class="vb-nodata"/g)).toBe(1);
  });

  it("makes the shade one slot wide and the full plot height", () => {
    const svg = renderSurfChart(withGaps([4]), NOW);
    const m = svg.match(/<rect class="nodata" x="([\d.]+)" y="(\d+)" width="([\d.]+)" height="(\d+)"/);
    expect(m).not.toBeNull();
    const slot = (960 - 40 - 44) / 9;
    expect(Number(m?.[3])).toBeCloseTo(slot, 0);
    expect(Number(m?.[2])).toBe(18);
    expect(Number(m?.[4])).toBe(330 - 18 - 88);
  });

  it("breaks the area and the period line into runs around a gap", () => {
    const svg = renderSurfChart(withGaps([4]), NOW);
    expect(count(svg, /class="wavearea"/g)).toBe(2);
    expect(count(svg, /class="periodline"/g)).toBe(2);
  });

  it("bridges a three hour gap as a straight ramp", () => {
    const hours = withGaps([3, 4, 5]);
    const svg = renderSurfChart(hours, NOW);
    expect(count(svg, /class="bridge wavebridge"/g)).toBe(1);
    expect(count(svg, /class="bridge periodbridge"/g)).toBe(1);
    // One straight segment from the hour before to the hour after: two points,
    // not one point per gap hour, so there is no flat average in between.
    expect(nums(wavePath(svg))).toHaveLength(4);
    expect(wavePath(svg)).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    const [x1, , x2] = nums(wavePath(svg)) as [number, number, number];
    const slot = (960 - 40 - 44) / 9;
    expect((x2 - x1) / slot).toBeCloseTo(4, 0);
    expect(count(svg, /class="nodata"/g)).toBe(3);
  });

  it("does not bridge a four hour gap", () => {
    const svg = renderSurfChart(withGaps([3, 4, 5, 6]), NOW);
    expect(svg).not.toContain('class="bridge');
    expect(count(svg, /class="nodata"/g)).toBe(4);
    expect(count(svg, /class="vb-nodata"/g)).toBe(4);
    expect(count(svg, /class="wavearea"/g)).toBe(2);
  });

  it("draws no line at a gap at the start, only the shade", () => {
    const svg = renderSurfChart(withGaps([0, 1]), NOW);
    expect(svg).not.toContain('class="bridge');
    expect(count(svg, /class="nodata"/g)).toBe(2);
    expect(count(svg, /class="wavearea"/g)).toBe(1);
    const area = nums(svg.match(/<path d="([^"]*)" class="wavearea"/)?.[1] ?? "");
    // The area starts at the third hour's x, not at the plot's left edge.
    const slot = (960 - 40 - 44) / 9;
    expect(area[0]).toBeCloseTo(40 + 2 * slot, 0);
  });

  it("draws no line at a gap at the end, only the shade", () => {
    const svg = renderSurfChart(withGaps([8, 9]), NOW);
    expect(svg).not.toContain('class="bridge');
    expect(count(svg, /class="nodata"/g)).toBe(2);
    expect(count(svg, /class="wavearea"/g)).toBe(1);
  });

  it("shades the last hour to the edge of the plot", () => {
    const svg = renderSurfChart(withGaps([9]), NOW);
    const m = svg.match(/<rect class="nodata" x="([\d.]+)" y="\d+" width="([\d.]+)"/);
    expect(Number(m?.[1]) + Number(m?.[2])).toBeCloseTo(960 - 44 + (960 - 40 - 44) / 9, 0);
  });

  it("returns the empty message when every hour is a gap, with no NaN", () => {
    const svg = renderSurfChart(withGaps([0, 1, 2, 3, 4, 5], 6), NOW);
    expect(svg).toContain("Not enough forecast data");
    expect(svg).not.toContain("NaN");
  });

  it("skips gap hours when it draws wind marks", () => {
    // Wind marks sit on hours 0, 3, 6 and 9. Gap out hours 3 and 6.
    const all = renderSurfChart(withGaps([]), NOW);
    const some = renderSurfChart(withGaps([3, 6]), NOW);
    expect(count(all, /class="wind /g)).toBe(4);
    expect(count(some, /class="wind /g)).toBe(2);
  });

  it("keeps wind marks on data hours next to a gap", () => {
    const svg = renderSurfChart(withGaps([1, 2]), NOW);
    expect(count(svg, /class="wind /g)).toBe(4);
  });

  it("emits no NaN for a series with scattered gaps", () => {
    const svg = renderSurfChart(withGaps([1, 4, 5, 6, 7, 9], 14), NOW, sun);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("undefined");
  });

  it("emits no NaN when only two hours exist and one is a gap", () => {
    expect(renderSurfChart([data(0), gap(1)], NOW)).not.toContain("NaN");
  });

  it("still publishes the geometry attributes with gaps", () => {
    const svg = renderSurfChart(withGaps([2]), NOW);
    expect(svg).toMatch(/data-vbw="960"/);
    expect(svg).toMatch(/data-x0="40\.0"/);
    expect(svg).toMatch(/data-x1="916\.0"/);
    expect(svg).toContain('<g class="head">');
  });

  it("keeps the dashed bridge out of the amber palette", () => {
    expect(renderSurfChart(withGaps([2]), NOW)).not.toMatch(/amber|stale/);
  });

  it("returns every bridge path as a pair of two points", () => {
    const svg = renderSurfChart(withGaps([2, 6]), NOW);
    expect(bridgePaths(svg)).toHaveLength(4);
  });
});

describe("surfFrames", () => {
  it("makes one frame per hour", () => {
    expect(surfFrames(base, NOW, sun)).toHaveLength(base.length);
  });

  it("makes one frame per hour with gaps", () => {
    const hours = withGaps([1, 2, 7]);
    expect(surfFrames(hours, NOW)).toHaveLength(hours.length);
  });

  it("labels the first hour Now", () => {
    expect(surfFrames(base, NOW, sun)[0]?.when).toBe("Now");
  });

  it("labels later hours by day", () => {
    const frames = surfFrames(base, NOW, sun);
    expect(frames[1]?.when).toBe("Today");
    expect(frames[3]?.when).toBe("Sun");
  });

  it("formats every value on the server, units and all", () => {
    const f = surfFrames(base, NOW, sun)[0];
    expect(f?.cells.map((c) => c.k)).toEqual(["Wave", "Period", "Wind", "Direction"]);
    expect(f?.cells[0]?.v).toBe("1.0 ft");
    expect(f?.cells[1]?.v).toBe("7s");
    expect(f?.cells[2]?.v).toMatch(/^\d+ mph [NESW]+$/);
    expect(f?.time).toBe("12:00 AM");
  });

  it("marks offshore good and onshore poor", () => {
    const frames = surfFrames(base, NOW, sun);
    expect(frames[0]?.cells[3]).toEqual({ k: "Direction", v: "offshore", cls: "good" });
    expect(frames[2]?.cells[3]).toEqual({ k: "Direction", v: "onshore", cls: "poor" });
  });

  it("leaves cross shore without a class", () => {
    const f = surfFrames([data(0, { windDirection: 100 })], NOW)[0];
    expect(f?.cells[3]).toEqual({ k: "Direction", v: "cross shore" });
  });

  // The band is a colour; the frame is the reason for it. Shipping one without
  // the other leaves a verdict nobody can check.
  it("carries the verdict and its reasoning on every frame", () => {
    for (const f of surfFrames(base, NOW, sun)) {
      expect(f.verdict?.label).toBeTruthy();
      expect(f.note).toBeTruthy();
    }
  });

  it("says dark on the hours it shaded", () => {
    const f = surfFrames(base, NOW, sun)[0];
    expect(f?.note).toBe("dark");
    expect(f?.verdict?.cls).toBe("poor");
  });

  it("gives a gap frame no cells and says there is no forecast", () => {
    const frames = surfFrames(withGaps([2]), NOW);
    const g = frames[2];
    expect(g?.cells).toEqual([]);
    expect(g?.verdict).toEqual({ label: "No forecast", cls: "nodata" });
    expect(g?.note).toBe("No forecast for this hour");
    expect(g?.time).toBe("2:00 AM");
  });

  it("labels a gap in the first slot Now", () => {
    expect(surfFrames(withGaps([0]), NOW)[0]?.when).toBe("Now");
  });

  it("shows no digits from a bridge on a gap frame", () => {
    const g = surfFrames(withGaps([4]), NOW)[4];
    expect(JSON.stringify(g?.cells)).toBe("[]");
    expect(g?.note).not.toMatch(/\d ft|mph/);
  });
});

describe("the tide in the surf readout", () => {
  const tide: TideSeries = {
    time: ["2026-09-05T00:00", "2026-09-05T01:00", "2026-09-05T02:00"],
    feet: [0.4, 1.5, 2.6],
  };

  it("adds a tide cell for the hours it covers", () => {
    const frames = surfFrames(base, NOW, sun, tide);
    expect(frames[0]?.cells.map((c) => c.k)).toContain("Tide");
    expect(frames[0]?.cells.find((c) => c.k === "Tide")?.v).toBe("0.4 ft rising");
  });

  // The fourth hour of the series is the next day, which the tide does not
  // reach. A missing hour drops the cell rather than showing a confident zero.
  it("leaves the cell out for an hour the prediction misses", () => {
    expect(surfFrames(base, NOW, sun, tide)[3]?.cells.map((c) => c.k)).not.toContain("Tide");
  });

  it("says nothing about tide when there is no tide series", () => {
    for (const f of surfFrames(base, NOW, sun)) {
      expect(f.cells.map((c) => c.k)).not.toContain("Tide");
    }
  });

  it("gives a gap hour no tide cell either", () => {
    const hours: Hour[] = [data(0), gap(1), data(2)];
    expect(surfFrames(hours, NOW, undefined, tide)[1]?.cells).toEqual([]);
  });
});

describe("the wave height axis", () => {
  const axisLabels = (svg: string): string[] =>
    [...svg.matchAll(/class="axis" text-anchor="end">(\d+)</g)].map((m) => m[1] as string);

  it("tops out at 6 ft by default", () => {
    expect(axisMaxFt(0)).toBe(6);
    expect(axisMaxFt(3)).toBe(6);
    expect(axisMaxFt(5.5)).toBe(6);
  });

  it("widens once a wave passes 5.5 ft", () => {
    expect(axisMaxFt(5.6)).toBe(8);
    expect(axisMaxFt(7.4)).toBe(10);
  });

  it("labels the default axis 2, 4 and 6", () => {
    expect(axisLabels(renderSurfChart(base, NOW))).toEqual(["2", "4", "6"]);
  });

  it("labels a widened axis up to its new top", () => {
    const big: Hour[] = [data(0), data(1, { waveHeight: 6.5 })];
    expect(axisLabels(renderSurfChart(big, NOW))).toEqual(["2", "4", "6", "8"]);
  });
});

describe("the tide line", () => {
  const tide: TideSeries = {
    time: ["2026-09-05T00:00", "2026-09-05T01:00", "2026-09-05T02:00"],
    feet: [0.4, 1.5, 2.6],
  };

  it("draws a line for the hours the prediction covers", () => {
    expect(renderSurfChart(base, NOW, sun, tide)).toContain('class="tideline"');
  });

  it("draws nothing without a tide series", () => {
    expect(renderSurfChart(base, NOW, sun)).not.toContain("tideline");
  });

  it("scales the tide on its own, so a low tide still spans the panel", () => {
    const low: TideSeries = { time: tide.time, feet: [-0.4, 0.2, 0.9] };
    const svg = renderSurfChart(base, NOW, sun, low);
    expect(svg).not.toContain("NaN");
    const d = svg.match(/<path d="([^"]+)" class="tideline"/)?.[1] ?? "";
    const ys = [...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(30);
  });

  it("labels the panel with the low and high of the window", () => {
    const labels = [...renderSurfChart(base, NOW, sun, tide).matchAll(/class="tideaxis" text-anchor="end">([-\d.]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["2.6", "0.4"]);
  });

  it("makes room for the panel only when there is a tide", () => {
    const height = (svg: string): number => Number(/viewBox="0 0 960 (\d+)"/.exec(svg)?.[1]);
    expect(height(renderSurfChart(base, NOW, sun, tide))).toBeGreaterThan(height(renderSurfChart(base, NOW, sun)));
  });

  it("runs the playhead through the tide panel to the call band", () => {
    const svg = renderSurfChart(base, NOW, sun, tide);
    const y2 = Number(/<g class="head"><line [^>]*y2="([\d.]+)"/.exec(svg)?.[1]);
    const tideBase = Number(/y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" class="tidebase"/.exec(svg)?.[1]);
    expect(y2).toBeGreaterThan(tideBase);
  });
});
