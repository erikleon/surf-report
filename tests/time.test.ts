import { describe, expect, it } from "vitest";
import {
  dateLabel,
  dayLabel,
  dayName,
  hourLabel,
  nyDate,
  nyMinuteStamp,
  nyStamp,
  tideDateRange,
  timeLabel,
} from "../src/time.js";

// Instants are given in UTC and the expectations are New York wall time. The
// suite runs under several host timezones (npm run test:tz), so a result that
// followed the host would fail in at least one of them.
const ms = (iso: string): number => Date.parse(iso);

describe("nyStamp", () => {
  it("is T06:00 at 6am New York", () => {
    expect(nyStamp(ms("2026-10-03T10:00:00Z"))).toBe("2026-10-03T06:00");
  });

  it("rounds down to the hour", () => {
    expect(nyStamp(ms("2026-10-03T10:45:59Z"))).toBe("2026-10-03T06:00");
  });

  it("keeps the New York date at 11pm when UTC is already tomorrow", () => {
    const now = ms("2026-10-04T03:00:00Z");
    expect(nyStamp(now)).toBe("2026-10-03T23:00");
    expect(nyDate(now)).toBe("2026-10-03");
  });

  it("jumps from 01:00 to 03:00 on the spring-forward day", () => {
    expect(nyStamp(ms("2026-03-08T06:59:00Z"))).toBe("2026-03-08T01:00");
    expect(nyStamp(ms("2026-03-08T07:00:00Z"))).toBe("2026-03-08T03:00");
  });

  it("shows 01:00 twice on the fall-back day", () => {
    expect(nyStamp(ms("2026-11-01T05:30:00Z"))).toBe("2026-11-01T01:00");
    expect(nyStamp(ms("2026-11-01T06:30:00Z"))).toBe("2026-11-01T01:00");
    expect(nyStamp(ms("2026-11-01T07:00:00Z"))).toBe("2026-11-01T02:00");
  });

  // The old localStamp read getHours() on a Date, so on a New York host it gave
  // the New York hour. This is that value, written out for a fixed instant.
  it("matches what the old localStamp gave on a New York host", () => {
    expect(nyStamp(ms("2026-09-10T13:30:00Z"))).toBe("2026-09-10T09:00");
  });
});

describe("nyMinuteStamp", () => {
  it("keeps the minutes that nyStamp drops", () => {
    const now = ms("2026-09-10T13:30:00Z");
    expect(nyStamp(now)).toBe("2026-09-10T09:00");
    expect(nyMinuteStamp(now)).toBe("2026-09-10T09:30");
    expect(timeLabel(nyMinuteStamp(now))).toBe("9:30 AM");
  });

  it("shows 01:30 twice on the fall-back day", () => {
    expect(nyMinuteStamp(ms("2026-11-01T05:30:00Z"))).toBe("2026-11-01T01:30");
    expect(nyMinuteStamp(ms("2026-11-01T06:30:00Z"))).toBe("2026-11-01T01:30");
  });

  it("skips 02:xx on the spring-forward day", () => {
    expect(nyMinuteStamp(ms("2026-03-08T06:59:00Z"))).toBe("2026-03-08T01:59");
    expect(nyMinuteStamp(ms("2026-03-08T07:00:00Z"))).toBe("2026-03-08T03:00");
  });

  it("reads 06:45 for a quarter to seven", () => {
    expect(nyMinuteStamp(ms("2026-10-03T10:45:00Z"))).toBe("2026-10-03T06:45");
  });
});

describe("nyDate", () => {
  it("rolls to the next New York day at midnight New York", () => {
    expect(nyDate(ms("2026-10-04T03:59:59Z"))).toBe("2026-10-03");
    expect(nyDate(ms("2026-10-04T04:00:00Z"))).toBe("2026-10-04");
  });
});

describe("tideDateRange", () => {
  it("defaults to today and two days later", () => {
    expect(tideDateRange(ms("2026-10-03T10:00:00Z"))).toEqual({ begin: "20261003", end: "20261005" });
  });

  it("uses the New York date at 11pm New York, when UTC is already tomorrow", () => {
    expect(tideDateRange(ms("2026-10-04T03:00:00Z"))).toEqual({ begin: "20261003", end: "20261005" });
  });

  it("starts the new day at midnight New York", () => {
    expect(tideDateRange(ms("2026-10-04T04:00:00Z"))).toEqual({ begin: "20261004", end: "20261006" });
  });

  it("rolls over a month end", () => {
    expect(tideDateRange(ms("2026-01-31T15:00:00Z"))).toEqual({ begin: "20260131", end: "20260202" });
  });

  it("rolls over a year end", () => {
    expect(tideDateRange(ms("2026-12-31T15:00:00Z"))).toEqual({ begin: "20261231", end: "20270102" });
  });

  it("takes a days argument other than 2", () => {
    const now = ms("2026-12-31T15:00:00Z");
    expect(tideDateRange(now, 1)).toEqual({ begin: "20261231", end: "20270101" });
    expect(tideDateRange(now, 7)).toEqual({ begin: "20261231", end: "20270107" });
    expect(tideDateRange(now, 0)).toEqual({ begin: "20261231", end: "20261231" });
  });

  it("counts the extra day in a leap year February", () => {
    expect(tideDateRange(ms("2028-02-28T15:00:00Z"))).toEqual({ begin: "20280228", end: "20280301" });
  });

  it("adds calendar days across the spring-forward day", () => {
    expect(tideDateRange(ms("2026-03-07T15:00:00Z"))).toEqual({ begin: "20260307", end: "20260309" });
  });
});

// These read the stamp as characters rather than parsing it into a Date. The
// stamps carry no offset, and a Date would put a timezone back onto data that
// does not have one.
describe("timeLabel", () => {
  it("is twelve hour, with the minutes", () => {
    expect(timeLabel("2026-09-13T14:00")).toBe("2:00 PM");
    expect(timeLabel("2026-09-13T09:30")).toBe("9:30 AM");
  });

  it("gets both ends of the clock right", () => {
    expect(timeLabel("2026-09-13T00:00")).toBe("12:00 AM");
    expect(timeLabel("2026-09-13T12:00")).toBe("12:00 PM");
  });
});

describe("hourLabel", () => {
  it("drops the minutes, for an axis with no room", () => {
    expect(hourLabel("2026-09-13T14:00")).toBe("2 PM");
    expect(hourLabel("2026-09-13T00:00")).toBe("12 AM");
  });
});

describe("dateLabel", () => {
  it("is day, month, year, in that order", () => {
    expect(dateLabel("2026-09-13T14:00")).toBe("13 Sep 2026");
    expect(dateLabel("2026-10-01T00:00")).toBe("1 Oct 2026");
  });
});

describe("dayName and dayLabel", () => {
  it("names the weekday of a date", () => {
    expect(dayName("2026-10-03")).toBe("Sat");
    expect(dayName("2026-10-04")).toBe("Sun");
  });

  it("says Today for the same date and the weekday otherwise", () => {
    expect(dayLabel("2026-10-03T18:00", "2026-10-03T06:00")).toBe("Today");
    expect(dayLabel("2026-10-05T06:00", "2026-10-03T06:00")).toBe("Mon");
  });
});
