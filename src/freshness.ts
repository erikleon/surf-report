// How old is too old. All times are epoch milliseconds.

/** How often each upstream is refetched. */
export const REFRESH_MS = { marine: 900_000, forecast: 900_000, tides: 3_600_000 } as const;

/** How long the edge cache may keep a page. A page can be this much older than the data behind it. */
export const EDGE_TTL_MS = 120_000;

/**
 * Age at which the call is hidden: two missed marine or forecast refreshes
 * plus the edge TTL, so one failed refresh does not hide it.
 */
export const CALL_STALE_AFTER_MS = 2 * REFRESH_MS.marine + EDGE_TTL_MS;

/** Age at which raw numbers go amber: one refresh plus the edge TTL. */
export const RAW_STALE_AFTER_MS = REFRESH_MS.marine + EDGE_TTL_MS;

/** Tides change slowly and the predictions run days ahead, so they get a long window. */
export const TIDE_STALE_AFTER_MS = 6 * 3_600_000;

export type AgeState = "fresh" | "stale" | "missing";

/** "missing" when never fetched, "stale" at or past `staleAfterMs`, else "fresh". */
export function ageState(fetchedAt: number | undefined, nowMs: number, staleAfterMs: number): AgeState {
  if (fetchedAt === undefined) return "missing";
  return nowMs - fetchedAt >= staleAfterMs ? "stale" : "fresh";
}
