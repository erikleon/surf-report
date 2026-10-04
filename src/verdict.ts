// The first-screen answer: one word, stars, a reason, and a cell per hour.

import { hourCall } from "./call.js";
import { isDaylight } from "./daylight.js";
import type { CallKind, DayVerdict, Daylight, Hour, HourCall } from "./types.js";

const WORD = {
  good: "Worth it",
  marginal: "Marginal",
  poor: "Not today",
} as const;

const RANK: Record<CallKind, number> = { nodata: 0, poor: 1, marginal: 2, good: 3 };

/** The calendar day after a "YYYY-MM-DD" date. Date.UTC keeps the host zone out of it. */
function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Judge the part of the day still worth planning around.
 *
 * Looks at today's daylight hours from now on. Once none are left it moves to
 * tomorrow's daylight hours and says so. Gap hours show in the cells but never
 * decide the word. Among data hours the best kind wins, then the most stars,
 * then the earliest.
 */
export function dayVerdict(hours: Hour[], daylight: Daylight | undefined, nowStamp: string): DayVerdict {
  const today = nowStamp.slice(0, 10);
  const lit = (h: Hour): boolean => daylight === undefined || isDaylight(h.time, daylight) !== false;

  let day: "today" | "tomorrow" = "today";
  let set = hours.filter((h) => h.time.slice(0, 10) === today && h.time >= nowStamp && lit(h));
  if (set.length === 0) {
    day = "tomorrow";
    const tomorrow = nextDate(today);
    set = hours.filter((h) => h.time.slice(0, 10) === tomorrow && lit(h));
  }

  const calls: HourCall[] = set.map((h) => hourCall(h, daylight));
  const cells = set.map((h, i) => ({ time: h.time, kind: (calls[i] as HourCall).kind }));

  let bestTime: string | undefined;
  let bestCall: HourCall | undefined;
  set.forEach((h, i) => {
    const call = calls[i] as HourCall;
    if (call.kind === "nodata") return;
    if (
      bestCall === undefined ||
      RANK[call.kind] > RANK[bestCall.kind] ||
      (call.kind === bestCall.kind && call.stars > bestCall.stars)
    ) {
      bestTime = h.time;
      bestCall = call;
    }
  });

  if (bestCall === undefined || bestTime === undefined) {
    return {
      word: "No forecast",
      kind: "none",
      stars: 0,
      why: "No forecast for the remaining daylight hours",
      day,
      cells,
    };
  }
  const call: HourCall = bestCall;
  return {
    word: WORD[call.kind as "good" | "marginal" | "poor"],
    kind: call.kind,
    stars: call.stars,
    why: call.why,
    bestHour: bestTime,
    day,
    cells,
  };
}
