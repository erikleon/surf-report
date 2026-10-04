import { describe, it, expect } from "vitest";
import { formatTide, nextTurn, tideAt } from "../src/tide.js";
import type { TideSeries } from "../src/types.js";

const t: TideSeries = {
  time: [0, 1, 2, 3, 4, 5].map((h) => `2026-09-08T0${h}:00`),
  feet: [0.352, 1.382, 2.163, 2.2, 1.9, 0.7],
};

describe("tideAt", () => {
  it("reads the height at an hour it covers", () => {
    expect(tideAt(t, "2026-09-08T01:00")?.feet).toBeCloseTo(1.382);
  });

  it("is undefined for an hour outside the prediction", () => {
    expect(tideAt(t, "2026-09-09T12:00")).toBeUndefined();
  });

  it("calls a filling tide rising and a draining one falling", () => {
    expect(tideAt(t, "2026-09-08T01:00")?.trend).toBe("rising");
    expect(tideAt(t, "2026-09-08T04:00")?.trend).toBe("falling");
  });

  // An hour sitting on the turn should not pick a direction on rounding noise.
  it("calls the turn slack", () => {
    expect(tideAt(t, "2026-09-08T03:00")?.trend).toBe("slack");
  });

  it("reads the ends off one neighbour", () => {
    expect(tideAt(t, "2026-09-08T00:00")?.trend).toBe("rising");
    expect(tideAt(t, "2026-09-08T05:00")?.trend).toBe("falling");
  });

  it("calls a one-point series slack", () => {
    expect(tideAt({ time: ["2026-09-08T00:00"], feet: [1] }, "2026-09-08T00:00")?.trend).toBe("slack");
  });
});

describe("formatTide", () => {
  it("reads the way it appears in the readout", () => {
    expect(formatTide({ feet: 3.24, trend: "rising" })).toBe("3.2 ft rising");
  });
});

describe("nextTurn", () => {
  const series = (feet: number[]): TideSeries => ({
    time: feet.map((_, i) => `2026-09-09T${String(i).padStart(2, "0")}:00`),
    feet,
  });

  it("finds the next high", () => {
    const r = nextTurn(series([0.5, 1.4, 2.2, 2.6, 2.1, 1.0]), "2026-09-09T00:00");
    expect(r).toEqual({ kind: "high", stamp: "2026-09-09T03:00", feet: 2.6 });
  });

  it("finds the next low", () => {
    const r = nextTurn(series([2.6, 1.8, 0.4, -0.1, 0.6, 1.9]), "2026-09-09T00:00");
    expect(r?.kind).toBe("low");
    expect(r?.stamp).toBe("2026-09-09T03:00");
  });

  // The turn behind you is not the next one.
  it("ignores a turn before the stamp asked for", () => {
    const r = nextTurn(series([0.5, 2.6, 1.2, 0.2, 1.1, 2.4]), "2026-09-09T02:00");
    expect(r?.kind).toBe("low");
    expect(r?.stamp).toBe("2026-09-09T03:00");
  });

  it("returns nothing when the water only goes one way", () => {
    expect(nextTurn(series([0.1, 0.6, 1.2, 1.9, 2.4, 3.0]), "2026-09-09T00:00")).toBeUndefined();
  });

  it("returns nothing when the series does not reach the stamp", () => {
    expect(nextTurn(series([0.5, 1.4, 2.2]), "2026-09-10T00:00")).toBeUndefined();
  });
});
