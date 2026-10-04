// Shared HTTP and response-shape helpers for the three upstream fetchers.

import type { FetchFn, Result } from "../types.js";

/** A forecast hour as the upstreams write it: "2026-10-03T06:00". */
export const LOCAL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * GET a URL and parse the body as JSON. Never throws: every failure comes back
 * as `{ ok: false, reason }` with text a person can read.
 *
 * The timeout covers the whole exchange, including reading the body. It is
 * raced against the fetch by hand, so a fetch that ignores its abort signal
 * still ends on time.
 */
export async function getJson(
  url: string,
  fetchImpl: FetchFn,
  timeoutMs = 10000,
): Promise<Result<unknown>> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  // If the exchange finishes first, this promise still rejects later. The
  // rejection is only a timer firing, so mark it handled to keep Node quiet.
  timedOut.catch(() => undefined);

  const exchange = async (): Promise<Result<unknown>> => {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const text = await response.text();
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      return { ok: false, reason: "response was not valid JSON" };
    }
  };

  try {
    return await Promise.race([exchange(), timedOut]);
  } catch (err) {
    // fetch raises TypeError for network failures and DOMException for an
    // abort or timeout. Anything that is not an Error is a bug, so let it go.
    if (!(err instanceof Error)) throw err;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, reason: `timed out after ${timeoutMs} ms` };
    }
    return { ok: false, reason: `network error: ${err.message}` };
  }
}

/**
 * Open-Meteo can answer HTTP 200 with `{"error":true,"reason":"..."}`.
 * Returns the reason text when the body is one of those, otherwise undefined.
 */
export function openMeteoError(body: unknown): string | undefined {
  if (!isRecord(body) || body["error"] !== true) return undefined;
  const reason = body["reason"];
  return typeof reason === "string" && reason !== ""
    ? reason
    : "Open-Meteo reported an error without a reason";
}

/** Read an array of local time stamps. Returns undefined if any is malformed. */
export function readStamps(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !LOCAL_STAMP.test(item)) return undefined;
    out.push(item);
  }
  return out;
}

/**
 * Read an array of numbers. A value that is not a finite number becomes null,
 * because Open-Meteo uses null for hours its model does not cover.
 */
export function readNumbers(value: unknown): Array<number | null> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) =>
    typeof item === "number" && Number.isFinite(item) ? item : null,
  );
}
