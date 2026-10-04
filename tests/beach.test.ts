import { describe, it, expect } from "vitest";
import { BEACH_FACING_DEG, compass, windRelativeToBeach } from "../src/beach.js";

describe("compass", () => {
  it("names the cardinal points", () => {
    expect(compass(0)).toBe("N");
    expect(compass(90)).toBe("E");
    expect(compass(180)).toBe("S");
    expect(compass(270)).toBe("W");
  });

  it("wraps negative and over-full angles", () => {
    expect(compass(-90)).toBe("W");
    expect(compass(360)).toBe("N");
    expect(compass(450)).toBe("E");
  });

  it("rounds to the nearest of sixteen points", () => {
    expect(compass(12)).toBe("NNE");
    expect(compass(11)).toBe("N");
    expect(compass(190)).toBe("S");
    expect(compass(359)).toBe("N");
  });
});

describe("windRelativeToBeach", () => {
  it("faces 190 degrees by default", () => {
    expect(BEACH_FACING_DEG).toBe(190);
  });

  it("calls wind off the land offshore and wind off the sea onshore", () => {
    expect(windRelativeToBeach(10)).toBe("offshore");
    expect(windRelativeToBeach(190)).toBe("onshore");
  });

  it("calls the sides cross shore", () => {
    expect(windRelativeToBeach(100)).toBe("cross shore");
    expect(windRelativeToBeach(280)).toBe("cross shore");
  });

  it("puts the boundaries at 60 and 120 degrees from offshore", () => {
    expect(windRelativeToBeach(70)).toBe("offshore");
    expect(windRelativeToBeach(71)).toBe("cross shore");
    expect(windRelativeToBeach(310)).toBe("offshore");
    expect(windRelativeToBeach(130)).toBe("onshore");
    expect(windRelativeToBeach(129)).toBe("cross shore");
  });

  it("handles wrap-around at north", () => {
    expect(windRelativeToBeach(350)).toBe("offshore");
    expect(windRelativeToBeach(370)).toBe("offshore");
    expect(windRelativeToBeach(-10)).toBe("offshore");
  });

  it("takes another facing", () => {
    // A beach facing east is groomed by wind from the west.
    expect(windRelativeToBeach(270, 90)).toBe("offshore");
    expect(windRelativeToBeach(90, 90)).toBe("onshore");
  });
});
