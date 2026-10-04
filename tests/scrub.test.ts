import { describe, expect, it } from "vitest";
import { renderScrub, type ScrubFrame } from "../src/scrub.js";

describe("renderScrub", () => {
  const frames: ScrubFrame[] = [
    { when: "Now", time: "13:00", cells: [{ k: "Surf", v: "3.4 ft" }], note: "dark" },
    {
      when: "Thu",
      time: "14:00",
      cells: [{ k: "Surf", v: "3.9 ft", cls: "good" }],
      verdict: { label: "Worth it", cls: "good" },
      note: "offshore 5 mph",
    },
  ];

  // With JS off the page is the first frame, which is the hour the server
  // would have shown anyway. Nothing about the page depends on the script.
  it("shows the first frame and hides the rest", () => {
    const html = renderScrub(frames, "<svg></svg>");
    const opens = html.match(/<div class="ro-frame"[^>]*>/g) ?? [];
    expect(opens).toHaveLength(2);
    expect(opens[0]).not.toContain("hidden");
    expect(opens[1]).toContain("hidden");
  });

  // .frame is the camera tile's image box and carries aspect-ratio: 4/3, so a
  // readout wearing that class inherits the height of a photo.
  it("keeps its rows off the camera tile's class", () => {
    expect(renderScrub(frames, "")).not.toContain('class="frame"');
  });

  it("wraps the readout, the chart and the slider in one block", () => {
    const html = renderScrub(frames, "<svg id=chart></svg>");
    expect(html).toContain('<div class="timeline">');
    expect(html).toContain('<div class="readout">');
    expect(html).toContain('<div class="chartwrap"><svg id=chart></svg></div>');
    expect(html).toContain('class="scrubber"');
  });

  // Scrubbing the plot area gives no keyboard or screen reader path on its
  // own, so the range input is the only one. It is not decoration.
  it("ships a labelled range input covering every hour", () => {
    const html = renderScrub(frames, "");
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Forecast hour"');
    expect(html).toContain('min="0" max="1"');
  });

  it("puts the first frame's full readout text in aria-valuetext", () => {
    expect(renderScrub(frames, "")).toContain('aria-valuetext="Now, 13:00, Surf 3.4 ft, dark"');
  });

  it("includes cells, verdict and note in aria-valuetext", () => {
    const html = renderScrub([frames[1] as ScrubFrame], "");
    expect(html).toContain(
      'aria-valuetext="Thu, 14:00, Surf 3.9 ft, The call Worth it, offshore 5 mph"',
    );
  });

  it("puts a way back on every frame but the first", () => {
    const html = renderScrub(frames, "");
    expect(html.match(/class="nowbtn"/g)).toHaveLength(1);
  });

  // It belongs on the top row at the right hand end, not down on the reasoning
  // line, so it sits with the values rather than under them.
  it("keeps the way back on the top row, after the verdict", () => {
    const html = renderScrub(frames, "");
    expect(html).toMatch(/class="ro-verdict".*class="nowbtn".*class="ro-why"/s);
    expect(html).not.toMatch(/<div class="ro-why">[^<]*<button/);
  });

  it("renders the verdict and its reasoning together", () => {
    const html = renderScrub(frames, "");
    expect(html).toContain("Worth it");
    expect(html).toContain("offshore 5 mph");
  });

  it("escapes everything it is handed", () => {
    const html = renderScrub(
      [{ when: "<script>", time: "1", cells: [{ k: "a&b", v: '"x"' }], note: "<img>" }],
      "",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a script tag in a cell value, in the markup and in aria-valuetext", () => {
    const html = renderScrub(
      [{ when: "Now", time: "1", cells: [{ k: "Surf", v: "<script>alert(1)</script>" }] }],
      "",
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/aria-valuetext="[^"]*&lt;script&gt;/);
  });

  it("emits no inline script, style or event handler", () => {
    const html = renderScrub(frames, "<svg></svg>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("renders one frame with a range of 0 to 0", () => {
    const html = renderScrub([frames[0] as ScrubFrame], "");
    expect(html).toContain('min="0" max="0"');
    expect(html.match(/class="ro-frame"/g)).toHaveLength(1);
    expect(html).not.toContain("nowbtn");
  });

  it("renders a valid block with no frames", () => {
    const html = renderScrub([], "<svg></svg>");
    expect(html).toContain('<div class="readout"></div>');
    expect(html).toContain('min="0" max="0"');
    expect(html).not.toContain('max="-1"');
    expect(html).not.toContain("aria-valuetext");
    expect(html).toContain('aria-label="Forecast hour"');
  });
});
