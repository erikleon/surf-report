import { escapeHtml } from "./html.js";

export interface ScrubCell {
  k: string;
  v: string;
  /** "good", "poor" or "marg". Omitted for a value that carries no verdict. */
  cls?: string;
}

export interface ScrubFrame {
  /** "Now", "Today", or a weekday. */
  when: string;
  time: string;
  cells: ScrubCell[];
  verdict?: { label: string; cls: string };
  /** The rule behind the verdict, in words. */
  note?: string;
}

/** The readout of one frame as plain text, for the range input's aria-valuetext. */
function frameText(f: ScrubFrame): string {
  const parts = [f.when, f.time, ...f.cells.map((c) => `${c.k} ${c.v}`)];
  if (f.verdict) parts.push(`The call ${f.verdict.label}`);
  if (f.note) parts.push(f.note);
  return parts.join(", ");
}

/**
 * Every hour's readout, rendered on the server, all but the first hidden.
 *
 * The browser script only flips which frame is visible. It formats nothing and
 * derives nothing, so every value it moves between was decided here. With no
 * JavaScript the first frame is the page, which is the hour the server would
 * have shown anyway.
 *
 * The readout sits above the chart and never follows the pointer. On a phone a
 * finger covers the hour it is selecting, so a floating value would hide under
 * the gesture that chose it.
 *
 * The output has no inline script or style, so the page can send a strict
 * content security policy.
 */
export function renderScrub(frames: ScrubFrame[], chart: string): string {
  const cell = (c: ScrubCell): string =>
    `<div class="ro-cell"><span class="ro-k">${escapeHtml(c.k)}</span>` +
    `<span class="ro-v${c.cls ? ` v-${escapeHtml(c.cls)}` : ""}">${escapeHtml(c.v)}</span></div>`;

  const body = frames
    .map((f, i) => {
      const verdict = f.verdict
        ? `<div class="ro-verdict"><span class="ro-k">The call</span>` +
          `<span class="ro-v v-${escapeHtml(f.verdict.cls)}">${escapeHtml(f.verdict.label)}</span></div>`
        : "";
      // The way back is part of every frame but the first, so returning to now
      // needs no state on the client and survives JS being off. It sits on the
      // top row at the right hand end, beside the verdict where there is one.
      const back = i === 0 ? "" : `<button type="button" class="nowbtn">Now</button>`;
      const note = f.note ? `<div class="ro-why">${escapeHtml(f.note)}</div>` : "";
      return (
        `<div class="ro-frame"${i === 0 ? "" : " hidden"}>` +
        `<div class="ro-when"><span class="ro-k">${escapeHtml(f.when)}</span>` +
        `<span class="ro-v">${escapeHtml(f.time)}</span></div>` +
        f.cells.map(cell).join("") +
        verdict +
        back +
        note +
        `</div>`
      );
    })
    .join("");

  // A range input is the only keyboard and screen reader path to the timeline.
  // Scrubbing the plot area gives neither on its own. The value text starts as
  // the first frame; the script keeps it in step with the visible frame.
  // With no frames the range is 0 to 0 so it stays valid.
  const max = Math.max(0, frames.length - 1);
  const first = frames[0] ? ` aria-valuetext="${escapeHtml(frameText(frames[0]))}"` : "";
  const slider =
    `<input type="range" class="scrubber" min="0" max="${max}" value="0" step="1" ` +
    `aria-label="Forecast hour"${first} />`;

  // One block, so the readout, the chart and the slider cannot drift apart:
  // the scrub script finds all three by walking up from the chart it is on.
  return (
    `<div class="timeline"><div class="readout">${body}</div>` +
    `<div class="chartwrap">${chart}</div>${slider}</div>`
  );
}
