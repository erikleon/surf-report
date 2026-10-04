// Test helper: a fake fetch that serves saved fixtures from a map of URL to
// fixture file and HTTP status. The tests never touch the network.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchFn } from "../../src/types.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixture(name: string): string {
  return readFileSync(`${FIXTURE_DIR}${name}`, "utf8");
}

export interface Canned {
  /** File name inside tests/fixtures/. */
  file: string;
  status?: number;
}

/** Serves each URL in the map. A URL that is not in the map is a test bug. */
export function fakeFetch(routes: Record<string, Canned>): FetchFn {
  const fake = async (input: Parameters<FetchFn>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    if (!route) throw new Error(`fakeFetch: no fixture for ${url}`);
    return new Response(fixture(route.file), { status: route.status ?? 200 });
  };
  return fake as FetchFn;
}

/** A fetch that never answers, to exercise the timeout. */
export const hangingFetch: FetchFn = (() => new Promise<Response>(() => undefined)) as FetchFn;

/** A fetch that fails the way a dropped connection does. */
export const failingFetch: FetchFn = (async () => {
  throw new TypeError("fetch failed");
}) as FetchFn;
