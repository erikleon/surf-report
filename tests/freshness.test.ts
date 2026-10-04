import { describe, expect, it } from "vitest";
import {
  CALL_STALE_AFTER_MS,
  EDGE_TTL_MS,
  RAW_STALE_AFTER_MS,
  REFRESH_MS,
  TIDE_STALE_AFTER_MS,
  ageState,
} from "../src/freshness.js";

describe("constants", () => {
  it("have the documented values", () => {
    expect(REFRESH_MS).toEqual({ marine: 900_000, forecast: 900_000, tides: 3_600_000 });
    expect(EDGE_TTL_MS).toBe(120_000);
    expect(CALL_STALE_AFTER_MS).toBe(32 * 60_000);
    expect(RAW_STALE_AFTER_MS).toBe(17 * 60_000);
    expect(TIDE_STALE_AFTER_MS).toBe(6 * 3_600_000);
  });
});

describe("ageState", () => {
  it("is missing when never fetched", () => {
    expect(ageState(undefined, 1000, 500)).toBe("missing");
  });
  it("is fresh just under the limit and stale at it", () => {
    expect(ageState(0, 499, 500)).toBe("fresh");
    expect(ageState(0, 500, 500)).toBe("stale");
    expect(ageState(0, 501, 500)).toBe("stale");
  });
  it("treats a fetch time slightly in the future as fresh", () => {
    expect(ageState(1000, 900, 500)).toBe("fresh");
  });
});
