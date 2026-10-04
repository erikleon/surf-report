// What the site relies on from strictdatetime, pinned so an upgrade that
// changes it fails here rather than shifting every hour on the page.
//
// Every expectation below is a New York wall-clock value for a fixed instant.
// The suite is run under several host timezones (see the test:tz script in
// CLAUDE.md) because the point of the package here is that the host's own zone
// never leaks in.

import { describe, expect, it } from "vitest";
import { projectInstant, toPlainDateTimeString } from "strictdatetime";

const NY = "America/New_York";
const at = (iso: string): string => toPlainDateTimeString(projectInstant(Date.parse(iso), NY));

describe("strictdatetime in America/New_York", () => {
  it("projects an instant to New York wall time, seconds and milliseconds included", () => {
    // 10:00 UTC on 3 Oct 2026 is 06:00 EDT.
    expect(at("2026-10-03T10:00:00Z")).toBe("2026-10-03T06:00:00.000");
  });

  it("keeps a New York evening on its own day when UTC is already tomorrow", () => {
    // 11pm EDT on the 3rd is 03:00 UTC on the 4th.
    expect(at("2026-10-04T03:00:00Z")).toBe("2026-10-03T23:00:00.000");
  });

  it("jumps from 01:59 EST to 03:00 EDT on the spring-forward day", () => {
    expect(at("2026-03-08T06:59:00Z")).toBe("2026-03-08T01:59:00.000");
    expect(at("2026-03-08T07:00:00Z")).toBe("2026-03-08T03:00:00.000");
  });

  it("shows 01:30 twice on the fall-back day", () => {
    expect(at("2026-11-01T05:30:00Z")).toBe("2026-11-01T01:30:00.000");
    expect(at("2026-11-01T06:30:00Z")).toBe("2026-11-01T01:30:00.000");
  });

  it("gives the hourly stamp the charts compare as strings", () => {
    // The first 13 characters plus ":00", the same shape as an Open-Meteo hour.
    const stamp = `${at("2026-10-03T10:45:00Z").slice(0, 13)}:00`;
    expect(stamp).toBe("2026-10-03T06:00");
  });
});
