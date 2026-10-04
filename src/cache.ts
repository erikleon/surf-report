// In-memory cache with one entry per upstream, refreshed on timers.
//
// A failed refresh keeps the old value and its fetchedAt, so the page can keep
// showing old numbers while the freshness rules decide what to hide.

import { REFRESH_MS } from "./freshness.js";
import { tideDateRange } from "./time.js";
import { fetchForecast } from "./upstream/forecast.js";
import { fetchMarine } from "./upstream/marine.js";
import { fetchTides } from "./upstream/tides.js";
import type { FetchFn, ForecastSeries, MarineSeries, Result, TideSeries } from "./types.js";

export interface Entry<T> {
  value?: T;
  /** Epoch ms of the last successful fetch. */
  fetchedAt?: number;
  /** Reason the most recent refresh failed. Cleared by the next success. */
  lastError?: string;
}

export interface CacheSnapshot {
  marine: Entry<MarineSeries>;
  forecast: Entry<ForecastSeries>;
  tides: Entry<TideSeries>;
}

export type UpstreamName = keyof CacheSnapshot;

export type RefreshCallback = (name: UpstreamName, result: Result<unknown>) => void;

const NAMES: UpstreamName[] = ["marine", "forecast", "tides"];

export interface CacheOptions {
  fetchImpl?: FetchFn;
  now?: () => number;
  intervals?: Record<UpstreamName, number>;
  /** How long start() waits for the first fetches. */
  startTimeoutMs?: number;
  /** Called after each refresh, once the snapshot already holds the result. */
  onRefresh?: RefreshCallback;
  log?: (line: string) => void;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}

export interface Cache {
  start(): Promise<void>;
  stop(): void;
  snapshot(): CacheSnapshot;
  refresh(name: UpstreamName): Promise<void>;
  /** Replace the refresh callback after creation. */
  setOnRefresh(callback: RefreshCallback | undefined): void;
}

/** Timers must never keep the process alive. A fake timer handle may have no unref. */
function unrefTimer(handle: unknown): void {
  if (typeof handle === "object" && handle !== null && "unref" in handle && typeof handle.unref === "function") {
    handle.unref();
  }
}

export function createCache(opts: CacheOptions = {}): Cache {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const intervals = opts.intervals ?? REFRESH_MS;
  const startTimeoutMs = opts.startTimeoutMs ?? 10_000;
  const log = opts.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const setIntervalImpl = opts.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalImpl =
    opts.clearIntervalImpl ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let onRefresh = opts.onRefresh;

  const state: CacheSnapshot = { marine: {}, forecast: {}, tides: {} };
  const inFlight = new Set<UpstreamName>();
  let timers: unknown[] = [];

  function fetchOne(name: UpstreamName): Promise<Result<unknown>> {
    switch (name) {
      case "marine":
        return fetchMarine(fetchImpl);
      case "forecast":
        return fetchForecast(fetchImpl);
      case "tides":
        return fetchTides(tideDateRange(now(), 6), fetchImpl);
    }
  }

  async function refresh(name: UpstreamName): Promise<void> {
    // A slow fetch must not pile up behind the timer.
    if (inFlight.has(name)) return;
    inFlight.add(name);
    let result: Result<unknown>;
    try {
      result = await fetchOne(name);
    } finally {
      inFlight.delete(name);
    }
    // The three entries hold different value types, so write through a loose view.
    const entry = state[name] as Entry<unknown>;
    if (result.ok) {
      entry.value = result.value;
      entry.fetchedAt = now();
      delete entry.lastError;
    } else {
      entry.lastError = result.reason;
      log(`[cache] ${name} refresh failed: ${result.reason}`);
    }
    onRefresh?.(name, result);
  }

  async function start(): Promise<void> {
    const all = Promise.all(NAMES.map((name) => refresh(name)));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, startTimeoutMs);
      unrefTimer(timeout);
    });
    try {
      await Promise.race([all, timedOut]);
    } finally {
      clearTimeout(timeout);
    }
    if (timers.length > 0) return;
    timers = NAMES.map((name) => {
      const handle = setIntervalImpl(() => void refresh(name), intervals[name]);
      unrefTimer(handle);
      return handle;
    });
  }

  function stop(): void {
    for (const handle of timers) clearIntervalImpl(handle);
    timers = [];
  }

  return {
    start,
    stop,
    snapshot: () => ({
      marine: { ...state.marine },
      forecast: { ...state.forecast },
      tides: { ...state.tides },
    }),
    refresh,
    setOnRefresh: (callback) => {
      onRefresh = callback;
    },
  };
}
