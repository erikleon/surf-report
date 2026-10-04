// Which way the beach faces, and what the wind does to it.

/** Rockaway faces about 190 degrees: a little west of due south. */
export const BEACH_FACING_DEG = 190;

/** Degrees to the sixteen point compass, for a label that has to read at a glance. */
export function compass(deg: number): string {
  const points = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] as string;
}

/**
 * Offshore, onshore or cross shore, for a beach that faces `facingDeg`.
 *
 * The wind that grooms Rockaway comes from roughly 10 degrees: off the land,
 * out to sea. Anything within 60 degrees of that is offshore, anything within
 * 60 degrees of the opposite is onshore, and the rest is cross shore. This
 * separates a clean two feet from a mess of the same size.
 */
export function windRelativeToBeach(
  fromDeg: number,
  facingDeg: number = BEACH_FACING_DEG,
): "offshore" | "onshore" | "cross shore" {
  const offshoreDeg = (facingDeg + 180) % 360;
  const delta = Math.abs(((fromDeg - offshoreDeg + 540) % 360) - 180);
  if (delta <= 60) return "offshore";
  if (delta >= 120) return "onshore";
  return "cross shore";
}
