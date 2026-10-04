import { describe, it, expect } from "vitest";
import { CALL, CALL_CLASS, CALL_LABEL, hourCall } from "../src/call.js";
import type { DataHour, Daylight, GapHour } from "../src/types.js";

// The beach faces 190 degrees, so wind from the north is offshore and wind
// from the south is onshore.
const OFFSHORE = 10;
const ONSHORE = 190;
const CROSS = 100;

const sun: Daylight = { sunrise: ["2026-10-03T06:57"], sunset: ["2026-10-03T18:15"] };
const NOON = "2026-10-03T12:00";
const MIDNIGHT = "2026-10-03T00:00";

function hour(over: Partial<Omit<DataHour, "kind">> = {}): DataHour {
  return {
    kind: "data",
    time: NOON,
    waveHeight: 3,
    wavePeriod: 9,
    windSpeed: 5,
    windDirection: OFFSHORE,
    ...over,
  };
}

const call = (over: Partial<Omit<DataHour, "kind">> = {}, d: Daylight | undefined = sun) =>
  hourCall(hour(over), d);

describe("hourCall kind and reason", () => {
  it("calls a clean, sizeable, daylit hour good", () => {
    expect(call().kind).toBe("good");
  });

  it("calls a dark hour poor whatever the swell is doing", () => {
    const c = call({ time: MIDNIGHT, waveHeight: 8, wavePeriod: 14 });
    expect(c.kind).toBe("poor");
    expect(c.why).toBe("dark");
  });

  it("calls a blown out hour poor and says the wind did it", () => {
    const c = call({ windDirection: ONSHORE, windSpeed: CALL.blownOutMph + 3 });
    expect(c.kind).toBe("poor");
    expect(c.why).toContain("onshore");
    expect(c.why).toContain("15 mph");
  });

  it("calls an hour with nothing to ride poor and says so", () => {
    const c = call({ waveHeight: 0.5 });
    expect(c.kind).toBe("poor");
    expect(c.why).toContain("too small");
    expect(c.why).toContain("0.5 ft");
  });

  it("treats light wind as good as offshore", () => {
    expect(call({ windDirection: ONSHORE, windSpeed: 3 }).kind).toBe("good");
  });

  it("calls an onshore hour under the blowout speed marginal, not poor", () => {
    expect(call({ windDirection: ONSHORE, windSpeed: 10 }).kind).toBe("marginal");
  });

  it("does not call onshore wind exactly at the blowout speed blown out", () => {
    expect(call({ windDirection: ONSHORE, windSpeed: CALL.blownOutMph }).kind).toBe("marginal");
  });

  it("calls a strong cross shore wind marginal, since only onshore blows out", () => {
    expect(call({ windDirection: CROSS, windSpeed: 25 }).kind).toBe("marginal");
  });

  it("holds short period back from good", () => {
    expect(call({ wavePeriod: CALL.minPeriodS - 1 }).kind).toBe("marginal");
  });

  it("holds a small but rideable hour back from good", () => {
    expect(call({ waveHeight: 1.2 }).kind).toBe("marginal");
  });

  it("builds the good reason from wind, size, period and daylight", () => {
    expect(call().why).toBe("5 mph offshore, 3.0 ft, 9s, daylight");
  });

  it("builds the marginal reason without the daylight word", () => {
    expect(call({ waveHeight: 1.2 }).why).toBe("5 mph offshore, 1.2 ft, 9s");
  });

  // Dark is the only disqualifier nothing can argue with, so it has to be
  // reported even when the wind is also wrong.
  it("reports dark ahead of the wind when both are against you", () => {
    const c = call({ time: MIDNIGHT, windDirection: ONSHORE, windSpeed: 30 });
    expect(c.why).toBe("dark");
  });

  it("reports the wind ahead of size when both are against you", () => {
    const c = call({ windDirection: ONSHORE, windSpeed: 20, waveHeight: 0.4 });
    expect(c.why).toContain("onshore");
  });

  // A verdict nobody can check is worse than no verdict.
  it("always says why", () => {
    for (const time of [NOON, MIDNIGHT]) {
      for (const windDirection of [OFFSHORE, ONSHORE, CROSS]) {
        for (const waveHeight of [0.2, 1.2, 4]) {
          expect(call({ time, windDirection, waveHeight }).why.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("hourCall daylight", () => {
  it("counts sunrise as lit and sunset as dark", () => {
    expect(call({ time: "2026-10-03T06:57" }).kind).toBe("good");
    expect(call({ time: "2026-10-03T18:15" }).why).toBe("dark");
  });

  it("counts an hour as lit when its day has no sun times", () => {
    expect(call({ time: "2026-10-09T00:00" }).kind).toBe("good");
  });

  it("counts an hour as lit when no daylight is passed", () => {
    // Not via `call`: its default parameter would replace an explicit undefined.
    expect(hourCall(hour({ time: MIDNIGHT }), undefined).kind).toBe("good");
  });
});

describe("hourCall wind class", () => {
  it("maps the relative wind to off, on and cross", () => {
    expect(call({ windDirection: OFFSHORE }).wind).toBe("off");
    expect(call({ windDirection: ONSHORE }).wind).toBe("on");
    expect(call({ windDirection: CROSS }).wind).toBe("cross");
  });

  it("sets the wind on dark and too small hours too", () => {
    expect(call({ time: MIDNIGHT, windDirection: ONSHORE }).wind).toBe("on");
    expect(call({ waveHeight: 0.2, windDirection: CROSS }).wind).toBe("cross");
  });
});

describe("hourCall gap hours", () => {
  const gap: GapHour = { kind: "gap", time: NOON };

  it("returns nodata with no stars and no wind", () => {
    const c = hourCall(gap, sun);
    expect(c).toEqual({ kind: "nodata", stars: 0, swellStars: 0, why: "No forecast for this hour" });
    expect("wind" in c).toBe(false);
  });

  it("is nodata at night and with no daylight too", () => {
    expect(hourCall({ kind: "gap", time: MIDNIGHT }, sun).kind).toBe("nodata");
    expect(hourCall(gap, undefined).kind).toBe("nodata");
  });
});

describe("stars", () => {
  it("gives a dark hour 0 stars", () => {
    expect(call({ time: MIDNIGHT }).stars).toBe(0);
  });

  it("gives a too small hour 0 stars", () => {
    expect(call({ waveHeight: CALL.tooSmallFt - 0.1 }).stars).toBe(0);
  });

  it("gives a blown out hour 1 star", () => {
    expect(call({ windDirection: ONSHORE, windSpeed: 20 }).stars).toBe(1);
  });

  it("gives a blown out hour that is also too small 0 stars", () => {
    expect(call({ windDirection: ONSHORE, windSpeed: 20, waveHeight: 0.5 }).stars).toBe(0);
  });

  it("starts the 1 star band exactly at tooSmallFt", () => {
    expect(call({ waveHeight: CALL.tooSmallFt, windDirection: ONSHORE, windSpeed: 20 }).stars).toBe(1);
  });

  it("gives a marginal hour 2 stars when it is under the height floor", () => {
    expect(call({ waveHeight: CALL.minWaveFt - 0.1 }).stars).toBe(2);
  });

  it("gives a marginal hour 2 stars when it is under the period floor", () => {
    expect(call({ wavePeriod: CALL.minPeriodS - 0.1 }).stars).toBe(2);
  });

  it("gives a marginal hour 3 stars when only the wind holds it back", () => {
    const c = call({ windDirection: ONSHORE, windSpeed: 10 });
    expect(c.kind).toBe("marginal");
    expect(c.stars).toBe(3);
  });

  it("gives a good hour at the minimums 4 stars", () => {
    const c = call({ waveHeight: CALL.minWaveFt, wavePeriod: CALL.minPeriodS });
    expect(c.kind).toBe("good");
    expect(c.stars).toBe(4);
  });

  it("gives a good hour 5 stars at exactly 2.5 ft and 8 s", () => {
    const c = call({ waveHeight: CALL.topStarWaveFt, wavePeriod: CALL.topStarPeriodS });
    expect(c.stars).toBe(5);
  });

  it("holds the fifth star back when either value is just under", () => {
    expect(call({ waveHeight: CALL.topStarWaveFt - 0.1, wavePeriod: 12 }).stars).toBe(4);
    expect(call({ waveHeight: 5, wavePeriod: CALL.topStarPeriodS - 0.1 }).stars).toBe(4);
  });

  it("names the star thresholds as constants", () => {
    expect(CALL.topStarWaveFt).toBe(2.5);
    expect(CALL.topStarPeriodS).toBe(8);
  });

  // Property: stars nest inside the kind, so the chart band and the stars can
  // never disagree whatever the inputs are.
  it("keeps stars inside each kind across a grid of inputs", () => {
    const times = [NOON, MIDNIGHT, "2026-10-09T03:00"];
    const heights = [0, 0.4, 0.99, 1, 1.2, 1.49, 1.5, 2, 2.49, 2.5, 3, 8];
    const periods = [0, 3, 5.9, 6, 7, 7.9, 8, 10, 16];
    const speeds = [0, 3, 5.9, 6, 10, 12, 12.1, 20, 40];
    const dirs = [0, 10, 70, 100, 130, 190, 250, 310, 350];
    let seen = 0;
    for (const time of times) {
      for (const waveHeight of heights) {
        for (const wavePeriod of periods) {
          for (const windSpeed of speeds) {
            for (const windDirection of dirs) {
              const c = call({ time, waveHeight, wavePeriod, windSpeed, windDirection });
              seen++;
              if (c.kind === "poor") expect(c.stars).toBeLessThanOrEqual(1);
              else if (c.kind === "marginal") expect([2, 3]).toContain(c.stars);
              else if (c.kind === "good") expect(c.stars).toBeGreaterThanOrEqual(4);
              else throw new Error(`a data hour returned ${c.kind}`);
            }
          }
        }
      }
    }
    expect(seen).toBe(3 * 12 * 9 * 9 * 9);
  });
});

describe("labels and classes", () => {
  it("labels every call in words", () => {
    expect(CALL_LABEL).toEqual({
      good: "Worth it",
      marginal: "Marginal",
      poor: "Not today",
      nodata: "No forecast",
    });
  });

  // Amber is spent on staleness site-wide. A marginal hour wearing it would
  // make an unconfirmed reading and an ordinary one look the same.
  it("never spends amber", () => {
    expect(CALL_CLASS).toEqual({ good: "good", marginal: "marg", poor: "poor", nodata: "nodata" });
    expect(Object.values(CALL_CLASS)).not.toContain("amber");
  });
});

describe("swell stars", () => {
  it("equals the real stars when the wind is clean", () => {
    const c = hourCall(hour({ waveHeight: 3, wavePeriod: 9, windSpeed: 4, windDirection: OFFSHORE }), sun);
    expect(c.kind).toBe("good");
    expect(c.swellStars).toBe(c.stars);
  });

  it("shows what a blown-out hour would have scored with calm wind", () => {
    // Plenty of swell, but 15 mph onshore ends the session: one star, five if the wind dropped.
    const c = hourCall(hour({ waveHeight: 3, wavePeriod: 9, windSpeed: 15, windDirection: ONSHORE }), sun);
    expect(c.kind).toBe("poor");
    expect(c.stars).toBe(1);
    expect(c.swellStars).toBe(5);
  });

  it("shows what moderate onshore wind took off a marginal hour", () => {
    const c = hourCall(hour({ waveHeight: 2, wavePeriod: 8, windSpeed: 9, windDirection: ONSHORE }), sun);
    expect(c.kind).toBe("marginal");
    expect(c.stars).toBe(3);
    expect(c.swellStars).toBe(4);
  });

  it("does not credit a swell that is too small or too short", () => {
    const small = hourCall(hour({ waveHeight: 0.7, windSpeed: 20, windDirection: ONSHORE }), sun);
    expect(small.swellStars).toBe(0);
    const short = hourCall(hour({ waveHeight: 3, wavePeriod: 4, windSpeed: 0 }), sun);
    expect(short.stars).toBe(2);
    expect(short.swellStars).toBe(2);
  });

  it("is zero in the dark, whatever the swell", () => {
    const c = hourCall(hour({ time: MIDNIGHT, waveHeight: 4, wavePeriod: 12 }), sun);
    expect(c.stars).toBe(0);
    expect(c.swellStars).toBe(0);
  });

  it("is never below the real stars across a grid of inputs", () => {
    for (const waveHeight of [0.4, 0.9, 1.2, 1.6, 2.4, 3.2, 5]) {
      for (const wavePeriod of [3, 5, 6, 7, 8, 10, 14]) {
        for (const windSpeed of [0, 3, 6, 9, 12, 13, 20, 35]) {
          for (const windDirection of [0, 45, 100, 190, 280]) {
            for (const time of [NOON, MIDNIGHT]) {
              const c = hourCall(hour({ time, waveHeight, wavePeriod, windSpeed, windDirection }), sun);
              expect(c.swellStars).toBeGreaterThanOrEqual(c.stars);
            }
          }
        }
      }
    }
  });
});
