import { describe, expect, it } from "vitest";
// @ts-expect-error: a browser module with no type declarations
import { sampleField, stepParticle, toUV } from "../assets/wind.js";

interface UV {
  u: number;
  v: number;
}

function expectUV(actual: UV | null, u: number, v: number): void {
  expect(actual).not.toBeNull();
  expect(actual?.u).toBeCloseTo(u, 9);
  expect(actual?.v).toBeCloseTo(v, 9);
}

describe("toUV", () => {
  it.each([
    ["north", 0, 0, -10],
    ["east", 90, -10, 0],
    ["south", 180, 0, 10],
    ["west", 270, 10, 0],
  ])("a wind from the %s blows the other way", (_name, dir, u, v) => {
    expectUV(toUV(10, dir), u, v);
  });

  it("a southwest wind blows toward the northeast", () => {
    const h = 10 * Math.SQRT1_2;
    expectUV(toUV(10, 225), h, h);
  });
});

// Two hours on a 2 by 3 grid. Hour 0 is a west wind whose speed grows to the
// east; hour 1 is a 20 mph north wind everywhere, so mixing them would show.
const field = {
  times: ["2026-10-04T06:00", "2026-10-04T07:00"],
  lats: [40.5, 40.6],
  lons: [-74.0, -73.9, -73.8],
  speed: [
    [
      [4, 8, 12],
      [6, 10, 14],
    ],
    [
      [20, 20, 20],
      [20, 20, 20],
    ],
  ],
  dir: [
    [
      [270, 270, 270],
      [270, 270, 270],
    ],
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  ],
};

describe("sampleField", () => {
  it("returns the grid value exactly at a grid point", () => {
    expectUV(sampleField(field, 0, -74.0, 40.5), 4, 0);
    expectUV(sampleField(field, 0, -73.9, 40.6), 10, 0);
    expectUV(sampleField(field, 0, -73.8, 40.6), 14, 0);
  });

  it("interpolates bilinearly between the four points around it", () => {
    // Centre of the first cell: the mean of 4, 8, 6 and 10.
    expectUV(sampleField(field, 0, -73.95, 40.55), 7, 0);
    // A quarter of the way east along the south edge: 4 + (8 - 4) / 4.
    expectUV(sampleField(field, 0, -73.975, 40.5), 5, 0);
  });

  it("interpolates the vector, not the direction", () => {
    const mixed = {
      ...field,
      speed: [
        [
          [10, 10, 10],
          [10, 10, 10],
        ],
      ],
      dir: [
        [
          [0, 90, 90],
          [0, 90, 90],
        ],
      ],
    };
    // Halfway between a north wind and an east wind.
    expectUV(sampleField(mixed, 0, -73.95, 40.55), -5, -5);
  });

  it("returns null outside the grid", () => {
    expect(sampleField(field, 0, -74.01, 40.55)).toBeNull();
    expect(sampleField(field, 0, -73.79, 40.55)).toBeNull();
    expect(sampleField(field, 0, -73.9, 40.49)).toBeNull();
    expect(sampleField(field, 0, -73.9, 40.61)).toBeNull();
  });

  it("reads only the requested hour", () => {
    expectUV(sampleField(field, 1, -73.95, 40.55), 0, -20);
    expectUV(sampleField(field, 0, -73.95, 40.55), 7, 0);
  });

  it("returns null for an hour the field does not have", () => {
    expect(sampleField(field, 2, -73.95, 40.55)).toBeNull();
    expect(sampleField(field, -1, -73.95, 40.55)).toBeNull();
  });
});

describe("stepParticle", () => {
  it("moves east under a west wind at the speed converted to metres per second", () => {
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos((40.58 * Math.PI) / 180);
    const start = { lon: -73.85, lat: 40.58 };
    const next = stepParticle(start, toUV(10, 270), 2, metersPerDegLat, metersPerDegLon);
    // 10 mph is 4.4704 m/s, so 2 seconds is 8.9408 m east and nothing north.
    expect((next.lon - start.lon) * metersPerDegLon).toBeCloseTo(8.9408, 6);
    expect((next.lat - start.lat) * metersPerDegLat).toBeCloseTo(0, 9);
  });

  it("moves south under a north wind", () => {
    const next = stepParticle({ lon: 0, lat: 0 }, toUV(10, 0), 1, 100000, 100000);
    expect(next.lon).toBeCloseTo(0, 12);
    expect(next.lat * 100000).toBeCloseTo(-4.4704, 6);
  });
});
