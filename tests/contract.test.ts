import { describe, expect, it } from "vitest";
import { formatReport, runContractCheck } from "../src/contract.js";
import { tideDateRange } from "../src/time.js";
import { buildForecastUrl } from "../src/upstream/forecast.js";
import { buildMarineUrl } from "../src/upstream/marine.js";
import { buildTidesUrl } from "../src/upstream/tides.js";
import { fakeFetch, type Canned } from "./upstream/fakeFetch.js";

// The saved fixtures start at 2026-10-03T00:00 New York time.
const NOW = Date.UTC(2026, 9, 3, 16, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const TIDES_URL = buildTidesUrl(tideDateRange(NOW, 6));

function routes(overrides: Record<string, Canned> = {}): Record<string, Canned> {
  return {
    [buildMarineUrl()]: { file: "marine.json" },
    [buildForecastUrl()]: { file: "forecast.json" },
    [TIDES_URL]: { file: "tides.json" },
    ...overrides,
  };
}

describe("runContractCheck", () => {
  it("passes when all three upstreams answer well", async () => {
    const report = await runContractCheck(fakeFetch(routes()), NOW);
    expect(report.ok).toBe(true);
    expect(report.lines.map((l) => [l.upstream, l.ok])).toEqual([
      ["marine", true],
      ["forecast", true],
      ["tides", true],
    ]);
    expect(formatReport(report).at(-1)).toBe("contract check passed");
  });

  it("fails and names the upstream that returned an error body", async () => {
    const fetchImpl = fakeFetch(routes({ [TIDES_URL]: { file: "tides-error.json" } }));
    const report = await runContractCheck(fetchImpl, NOW);
    expect(report.ok).toBe(false);
    const tides = report.lines.find((l) => l.upstream === "tides");
    expect(tides?.ok).toBe(false);
    expect(tides?.reason).toMatch(/^tides:/);
    expect(report.lines.filter((l) => l.ok)).toHaveLength(2);
    expect(formatReport(report).join("\n")).toContain("tides: FAIL");
  });

  it("fails when Open-Meteo answers 200 with an error body", async () => {
    const fetchImpl = fakeFetch(routes({ [buildMarineUrl()]: { file: "openmeteo-error.json" } }));
    const report = await runContractCheck(fetchImpl, NOW);
    expect(report.ok).toBe(false);
    expect(report.lines[0]?.upstream).toBe("marine");
    expect(report.lines[0]?.ok).toBe(false);
  });

  it("fails the sanity check when a series is too short", async () => {
    // Ten hours parse fine but sit far below the 100 hour floor.
    const inner = fakeFetch(routes());
    const shortMarine = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await inner(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== buildMarineUrl()) return response;
      const body = (await response.json()) as { hourly: Record<string, unknown[]> };
      for (const key of Object.keys(body.hourly)) body.hourly[key] = (body.hourly[key] ?? []).slice(0, 10);
      return new Response(JSON.stringify(body));
    }) as typeof fetch;

    const report = await runContractCheck(shortMarine, NOW);
    expect(report.ok).toBe(false);
    const marine = report.lines[0];
    expect(marine?.reason).toBeUndefined();
    expect(marine?.facts.some((f) => !f.ok && f.label.includes("hours"))).toBe(true);
    expect(report.lines[1]?.ok).toBe(true);
  });

  it("fails when the first marine hour is more than a day from now", async () => {
    const later = NOW + 3 * DAY_MS;
    const fetchImpl = fakeFetch(routes({ [buildTidesUrl(tideDateRange(later, 6))]: { file: "tides.json" } }));
    const report = await runContractCheck(fetchImpl, later);
    const marine = report.lines.find((l) => l.upstream === "marine");
    expect(marine?.ok).toBe(false);
    expect(marine?.facts.some((f) => !f.ok && f.label.includes("within one day"))).toBe(true);
  });
});
