import { describe, expect, it } from "vitest";
import { buildTidesUrl, fetchTides } from "../../src/upstream/tides.js";
import { fakeFetch } from "./fakeFetch.js";

const RANGE = { begin: "20261003", end: "20261009" };
const URL = buildTidesUrl(RANGE);
const serve = (file: string, status = 200) => fakeFetch({ [URL]: { file, status } });

describe("buildTidesUrl", () => {
  it("carries the exact parameters and never uses range", () => {
    const url = new globalThis.URL(URL);
    expect(url.origin + url.pathname).toBe(
      "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product: "predictions",
      application: "surf-report",
      begin_date: "20261003",
      end_date: "20261009",
      datum: "MLLW",
      station: "8517137",
      time_zone: "lst_ldt",
      units: "english",
      interval: "h",
      format: "json",
    });
    expect(url.searchParams.has("range")).toBe(false);
  });
});

describe("fetchTides", () => {
  it("reads the saved live response and turns the space into a T", async () => {
    const result = await fetchTides(RANGE, serve("tides.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.time).toHaveLength(168);
    expect(result.value.feet).toHaveLength(168);
    expect(result.value.time[0]).toBe("2026-10-03T00:00");
    expect(result.value.feet[0]).toBe(4.104);
    for (const stamp of result.value.time) expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("skips rows that cannot be read and keeps the rest", async () => {
    const result = await fetchTides(RANGE, serve("tides-bad-row.json"));
    expect(result).toEqual({
      ok: true,
      value: { time: ["2026-10-03T00:00", "2026-10-03T04:00"], feet: [4.104, 3.437] },
    });
  });

  it("returns the NOAA error message", async () => {
    const result = await fetchTides(RANGE, serve("tides-error.json"));
    expect(result).toEqual({
      ok: false,
      reason: "tides: Wrong Station ID: The station id you requested is not valid.",
    });
  });

  it("fails on an empty predictions list with a clear reason", async () => {
    const result = await fetchTides(RANGE, serve("tides-empty.json"));
    expect(result).toEqual({
      ok: false,
      reason: "tides: NOAA returned an empty predictions list for this date range",
    });
  });

  it("fails on HTTP 429 and 500", async () => {
    expect(await fetchTides(RANGE, serve("tides.json", 429))).toEqual({
      ok: false,
      reason: "tides: HTTP 429",
    });
    expect(await fetchTides(RANGE, serve("tides.json", 500))).toEqual({
      ok: false,
      reason: "tides: HTTP 500",
    });
  });

  it("fails on a body that is not JSON", async () => {
    const result = await fetchTides(RANGE, serve("not-json.html"));
    expect(result).toEqual({ ok: false, reason: "tides: response was not valid JSON" });
  });
});
