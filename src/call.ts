// Is an hour worth surfing?
//
// Every hour is scored here and nowhere else, so the chart band, the scrub
// readout, the week table and the first-screen verdict cannot disagree.
//
// The call always carries the rule that produced it. A colour nobody can check
// is worse than no colour: when the band says an hour is poor, scrubbing to it
// has to say "dark" or "onshore 15 mph" rather than leaving you to guess which
// of the four inputs decided it.

import { windRelativeToBeach } from "./beach.js";
import { isDaylight } from "./daylight.js";
import type { CallKind, DataHour, Daylight, Hour, HourCall, WindClass } from "./types.js";

/**
 * The tuning knobs, in one place because they are the thing that gets changed.
 *
 * These are taste, not fact. They are a starting point for Rockaway, a small
 * wind-sensitive beach break, set loose on purpose so clean small mornings
 * still score. DESIGN.md records the reasoning; move the numbers here after
 * watching the band against real sessions.
 */
export const CALL = {
  /** At or above this, with the period and wind to match, an hour is good. */
  minWaveFt: 1.5,
  minPeriodS: 6,
  /** Wind this light is as good as offshore, whichever way it points. */
  calmWindMph: 6,
  /** Below this there is nothing to ride whatever the wind does. */
  tooSmallFt: 1.0,
  /** Onshore above this ends the session. */
  blownOutMph: 12,
  /** A good hour at or above this height and period earns the fifth star. */
  topStarWaveFt: 2.5,
  topStarPeriodS: 8,
} as const;

export const CALL_LABEL: Record<CallKind, string> = {
  good: "Worth it",
  marginal: "Marginal",
  poor: "Not today",
  nodata: "No forecast",
};

/**
 * Colour class per call.
 *
 * Amber is missing on purpose. It is spent on staleness across the whole site,
 * and a marginal hour tinted the same as an unconfirmed reading would break the
 * one rule that cannot bend: stale must never look current.
 */
export const CALL_CLASS: Record<CallKind, string> = {
  good: "good",
  marginal: "marg",
  poor: "poor",
  nodata: "nodata",
};

const WIND_CLASS: Record<ReturnType<typeof windRelativeToBeach>, WindClass> = {
  offshore: "off",
  onshore: "on",
  "cross shore": "cross",
};

/** The score for one lit or dark data hour, before the swell-only stars are added. */
function scoreHour(h: DataHour, lit: boolean): Omit<HourCall, "swellStars"> {
  const rel = windRelativeToBeach(h.windDirection);
  const wind = WIND_CLASS[rel];
  const windText = `${Math.round(h.windSpeed)} mph ${rel}`;
  const size = `${h.waveHeight.toFixed(1)} ft`;
  const period = `${Math.round(h.wavePeriod)}s`;
  const tooSmall = h.waveHeight < CALL.tooSmallFt;

  // Ordered so the first disqualifying reason is the one reported. Dark comes
  // first because it is the only one no swell can argue with.
  if (!lit) return { kind: "poor", stars: 0, why: "dark", wind };
  if (rel === "onshore" && h.windSpeed > CALL.blownOutMph) {
    // The reason names the wind, but an hour with nothing to ride still scores 0.
    return { kind: "poor", stars: tooSmall ? 0 : 1, why: windText, wind };
  }
  if (tooSmall) return { kind: "poor", stars: 0, why: `too small, ${size}`, wind };

  const cleanWind = rel === "offshore" || h.windSpeed < CALL.calmWindMph;
  const bigEnough = h.waveHeight >= CALL.minWaveFt && h.wavePeriod >= CALL.minPeriodS;
  if (cleanWind && bigEnough) {
    const top = h.waveHeight >= CALL.topStarWaveFt && h.wavePeriod >= CALL.topStarPeriodS;
    return { kind: "good", stars: top ? 5 : 4, why: `${windText}, ${size}, ${period}, daylight`, wind };
  }
  return { kind: "marginal", stars: bigEnough ? 3 : 2, why: `${windText}, ${size}, ${period}`, wind };
}

/**
 * The hour's score plus what the swell alone would earn: the same hour scored
 * again with the wind dropped to calm. Calm wind can only help, so the swell
 * stars are never below the real ones.
 */
function dataCall(h: DataHour, lit: boolean): HourCall {
  const call = scoreHour(h, lit);
  const swellStars = scoreHour({ ...h, windSpeed: 0 }, lit).stars;
  return { ...call, swellStars };
}

/**
 * Score one hour. Daylight that cannot be determined (no sun times for that
 * day, or none passed) counts as lit, so a missing day never turns every hour
 * into "dark".
 */
export function hourCall(hour: Hour, daylight: Daylight | undefined): HourCall {
  if (hour.kind === "gap") return { kind: "nodata", stars: 0, swellStars: 0, why: "No forecast for this hour" };
  const lit = daylight === undefined ? true : isDaylight(hour.time, daylight) !== false;
  return dataCall(hour, lit);
}
