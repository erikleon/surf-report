import { describe, expect, it } from "vitest";
import { createCache } from "../src/cache.js";
import { tideDateRange } from "../src/time.js";
import { buildForecastUrl } from "../src/upstream/forecast.js";
import { buildMarineUrl } from "../src/upstream/marine.js";
import { buildTidesUrl } from "../src/upstream/tides.js";
import { buildWindGridUrl } from "../src/upstream/windGrid.js";
import type { FetchFn } from "../src/types.js";
import { fakeFetch, fixture, hangingFetch } from "./upstream/fakeFetch.js";

const NOW = Date.UTC(2026, 9, 3, 14, 0);
const TIDES_URL = buildTidesUrl(tideDateRange(NOW, 6));
const WIND_URL = buildWindGridUrl();

const goodRoutes = {
  [buildMarineUrl()]: { file: "marine.json" },
  [buildForecastUrl()]: { file: "forecast.json" },
  [TIDES_URL]: { file: "tides.json" },
  [WIND_URL]: { file: "windgrid.json" },
};

/** Fake timers: records callbacks so a test can fire a tick by hand. */
function fakeTimers() {
  const live = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    live,
    setIntervalImpl: (fn: () => void, ms: number) => {
      live.set(next, { fn, ms });
      return next++;
    },
    clearIntervalImpl: (h: unknown) => void live.delete(h as number),
    fireAll: () => [...live.values()].forEach((t) => t.fn()),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("refresh", () => {
  it("stores the value, sets fetchedAt and clears the error", async () => {
    let now = NOW;
    const cache = createCache({ fetchImpl: fakeFetch(goodRoutes), now: () => now, log: () => undefined });
    await cache.refresh("marine");
    const snap = cache.snapshot();
    expect(snap.marine.value?.time).toHaveLength(168);
    expect(snap.marine.fetchedAt).toBe(NOW);
    expect(snap.marine.lastError).toBeUndefined();
    expect(snap.forecast).toEqual({});
    now += 1000;
    await cache.refresh("forecast");
    await cache.refresh("tides");
    expect(cache.snapshot().forecast.fetchedAt).toBe(NOW + 1000);
    expect(cache.snapshot().tides.value?.feet.length).toBeGreaterThan(0);
  });

  it("requests tides for six days from the New York date", async () => {
    const urls: string[] = [];
    const inner = fakeFetch(goodRoutes);
    const spy = ((input: Parameters<FetchFn>[0], init?: RequestInit) => {
      urls.push(String(input));
      return inner(input, init);
    }) as FetchFn;
    const cache = createCache({ fetchImpl: spy, now: () => NOW });
    await cache.refresh("tides");
    expect(urls).toEqual([TIDES_URL]);
    expect(TIDES_URL).toContain("begin_date=20261003");
    expect(TIDES_URL).toContain("end_date=20261009");
  });

  it("keeps the old value and fetchedAt on failure, and logs once", async () => {
    let routes: Record<string, { file: string; status?: number }> = goodRoutes;
    const logs: string[] = [];
    let now = NOW;
    const fetchImpl = ((input: Parameters<FetchFn>[0], init?: RequestInit) =>
      fakeFetch(routes)(input, init)) as FetchFn;
    const cache = createCache({ fetchImpl, now: () => now, log: (l) => logs.push(l) });
    await cache.refresh("marine");
    const before = cache.snapshot().marine;

    routes = { ...goodRoutes, [buildMarineUrl()]: { file: "marine.json", status: 500 } };
    now += 60_000;
    await cache.refresh("marine");
    const after = cache.snapshot().marine;
    expect(after.value).toEqual(before.value);
    expect(after.fetchedAt).toBe(NOW);
    expect(after.lastError).toContain("HTTP 500");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("marine");
    expect(logs[0]).toContain("HTTP 500");

    routes = goodRoutes;
    now += 60_000;
    await cache.refresh("marine");
    expect(cache.snapshot().marine.lastError).toBeUndefined();
    expect(cache.snapshot().marine.fetchedAt).toBe(NOW + 120_000);
    expect(logs).toHaveLength(1);
  });

  it("reports the result to onRefresh after the snapshot is updated", async () => {
    const seen: Array<[string, boolean, number | undefined]> = [];
    const cache = createCache({
      fetchImpl: fakeFetch(goodRoutes),
      now: () => NOW,
      onRefresh: (name, result) => seen.push([name, result.ok, cache.snapshot()[name].fetchedAt]),
    });
    await cache.refresh("marine");
    expect(seen).toEqual([["marine", true, NOW]]);
  });

  it("does not overlap two refreshes of the same upstream", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async () => {
      calls++;
      await gate;
      return new Response(fixture("marine.json"));
    }) as FetchFn;
    const cache = createCache({ fetchImpl: slow, now: () => NOW });
    const first = cache.refresh("marine");
    await cache.refresh("marine");
    await cache.refresh("marine");
    expect(calls).toBe(1);
    release?.();
    await first;
    expect(cache.snapshot().marine.fetchedAt).toBe(NOW);
    await cache.refresh("marine");
    expect(calls).toBe(2);
  });
});

describe("start and stop", () => {
  it("resolves after the first fetches and starts one timer per upstream", async () => {
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: fakeFetch(goodRoutes), now: () => NOW, ...timers });
    await cache.start();
    const snap = cache.snapshot();
    expect(snap.marine.value).toBeDefined();
    expect(snap.forecast.value).toBeDefined();
    expect(snap.tides.value).toBeDefined();
    expect([...timers.live.values()].map((t) => t.ms).sort((a, b) => a - b)).toEqual([
      900_000, 900_000, 3_600_000, 3_600_000,
    ]);
    cache.stop();
  });

  it("resolves after the timeout when an upstream hangs", async () => {
    const hangTides = ((input: Parameters<FetchFn>[0], init?: RequestInit) =>
      String(input) === TIDES_URL ? hangingFetch(input, init) : fakeFetch(goodRoutes)(input, init)) as FetchFn;
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: hangTides, now: () => NOW, startTimeoutMs: 30, ...timers });
    const t0 = Date.now();
    await cache.start();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    const snap = cache.snapshot();
    expect(snap.marine.value).toBeDefined();
    expect(snap.tides.value).toBeUndefined();
    expect(timers.live.size).toBe(4);
    cache.stop();
  });

  it("skips a timer tick while the previous fetch is still running", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const routes = fakeFetch(goodRoutes);
    const slowMarine = (async (input: Parameters<FetchFn>[0], init?: RequestInit) => {
      if (String(input) === buildMarineUrl()) {
        calls++;
        if (calls === 2) await gate;
      }
      return routes(input, init);
    }) as FetchFn;
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: slowMarine, now: () => NOW, ...timers });
    await cache.start();
    expect(calls).toBe(1);
    timers.fireAll();
    timers.fireAll();
    timers.fireAll();
    expect(calls).toBe(2);
    release?.();
    await tick();
    timers.fireAll();
    await tick();
    expect(calls).toBe(3);
    cache.stop();
  });

  it("stop clears the timers and is safe to call twice", async () => {
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: fakeFetch(goodRoutes), now: () => NOW, ...timers });
    await cache.start();
    cache.stop();
    expect(timers.live.size).toBe(0);
    expect(() => cache.stop()).not.toThrow();
  });

  it("stop before start is harmless", () => {
    const cache = createCache({ fetchImpl: fakeFetch(goodRoutes) });
    expect(() => cache.stop()).not.toThrow();
  });

  it("unrefs the timers so they do not hold the process open", async () => {
    const unrefs: number[] = [];
    const cache = createCache({
      fetchImpl: fakeFetch(goodRoutes),
      now: () => NOW,
      setIntervalImpl: () => ({ unref: () => void unrefs.push(1) }),
      clearIntervalImpl: () => undefined,
    });
    await cache.start();
    expect(unrefs).toHaveLength(4);
  });
});

describe("wind", () => {
  it("stores the grid like the other upstreams", async () => {
    const cache = createCache({ fetchImpl: fakeFetch(goodRoutes), now: () => NOW, log: () => undefined });
    await cache.refresh("wind");
    const wind = cache.snapshot().wind;
    expect(wind.value?.times).toHaveLength(48);
    expect(wind.value?.speed[0]?.[0]).toHaveLength(10);
    expect(wind.fetchedAt).toBe(NOW);
    expect(cache.snapshot().marine).toEqual({});
  });

  it("keeps the old field when a refresh fails", async () => {
    let routes: Record<string, { file: string; status?: number }> = goodRoutes;
    const logs: string[] = [];
    let now = NOW;
    const fetchImpl = ((input: Parameters<FetchFn>[0], init?: RequestInit) =>
      fakeFetch(routes)(input, init)) as FetchFn;
    const cache = createCache({ fetchImpl, now: () => now, log: (l) => logs.push(l) });
    await cache.refresh("wind");
    const before = cache.snapshot().wind;

    routes = { ...goodRoutes, [WIND_URL]: { file: "windgrid-error.json" } };
    now += 3_600_000;
    await cache.refresh("wind");
    const after = cache.snapshot().wind;
    expect(after.value).toEqual(before.value);
    expect(after.fetchedAt).toBe(NOW);
    expect(after.lastError).toContain("must have the same number of elements");
    expect(logs).toEqual([expect.stringContaining("wind refresh failed")]);
  });

  it("start() does not wait for a wind fetch that hangs", async () => {
    let release: ((r: Response) => void) | undefined;
    const pending = new Promise<Response>((r) => (release = r));
    const routes = fakeFetch(goodRoutes);
    const slowWind = ((input: Parameters<FetchFn>[0], init?: RequestInit) =>
      String(input) === WIND_URL ? pending : routes(input, init)) as FetchFn;
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: slowWind, now: () => NOW, startTimeoutMs: 5_000, ...timers });
    const t0 = Date.now();
    await cache.start();
    expect(Date.now() - t0).toBeLessThan(1_000);
    let snap = cache.snapshot();
    expect(snap.marine.value).toBeDefined();
    expect(snap.forecast.value).toBeDefined();
    expect(snap.tides.value).toBeDefined();
    expect(snap.wind).toEqual({});
    expect(timers.live.size).toBe(4);

    release?.(new Response(fixture("windgrid.json")));
    await tick();
    snap = cache.snapshot();
    expect(snap.wind.value?.times).toHaveLength(48);
    expect(snap.wind.fetchedAt).toBe(NOW);
    cache.stop();
  });

  it("start() resolves with no wind when the first wind fetch fails", async () => {
    const routes = { ...goodRoutes, [WIND_URL]: { file: "windgrid.json", status: 503 } };
    const logs: string[] = [];
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: fakeFetch(routes), now: () => NOW, log: (l) => logs.push(l), ...timers });
    await cache.start();
    await tick();
    const snap = cache.snapshot();
    expect(snap.marine.value).toBeDefined();
    expect(snap.wind.value).toBeUndefined();
    expect(snap.wind.lastError).toBe("wind: HTTP 503");
    expect(logs).toEqual(["[cache] wind refresh failed: wind: HTTP 503"]);
    cache.stop();
  });

  it("refreshes wind on its own hourly timer", async () => {
    let windCalls = 0;
    const routes = fakeFetch(goodRoutes);
    const counting = ((input: Parameters<FetchFn>[0], init?: RequestInit) => {
      if (String(input) === WIND_URL) windCalls++;
      return routes(input, init);
    }) as FetchFn;
    const timers = fakeTimers();
    const cache = createCache({ fetchImpl: counting, now: () => NOW, ...timers });
    await cache.start();
    await tick();
    expect(windCalls).toBe(1);
    const hourly = [...timers.live.values()].filter((t) => t.ms === 3_600_000);
    expect(hourly).toHaveLength(2);
    for (const t of hourly) t.fn();
    await tick();
    expect(windCalls).toBe(2);
    cache.stop();
  });
});
