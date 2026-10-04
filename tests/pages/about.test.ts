import { describe, expect, it } from "vitest";
import { CALL } from "../../src/call.js";
import { buildModel } from "../../src/model.js";
import { renderAbout } from "../../src/pages/index.js";
import { NOW, ctx, freshModel, snap } from "./helpers.js";

describe("about page", () => {
  it("lists each source with its last good update in New York time", () => {
    const html = renderAbout(freshModel(), ctx);
    expect(html.match(/Last good update 3 Oct 2026, 9:55 AM, New York time/g)).toHaveLength(3);
    expect(html).toContain("station 8517137");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain("Public domain");
  });

  it("says not loaded yet for a source that never loaded", () => {
    const html = renderAbout(buildModel(snap(NOW - 60_000, undefined, undefined), NOW), ctx);
    expect(html).toContain("Last good update 3 Oct 2026, 9:59 AM, New York time");
    expect(html.match(/Last good update not loaded yet/g)).toHaveLength(2);
  });

  it("reads the rating numbers from the call rules", () => {
    const html = renderAbout(freshModel(), ctx);
    expect(html).toContain(`onshore above ${CALL.blownOutMph} mph`);
    expect(html).toContain(`under ${CALL.tooSmallFt.toFixed(1)} ft`);
    expect(html).toContain(`${CALL.minWaveFt.toFixed(1)} ft or more`);
    expect(html).toContain(`${CALL.minPeriodS} seconds or more`);
    expect(html).toContain(`under ${CALL.calmWindMph} mph`);
    expect(html).toContain(`${CALL.topStarWaveFt.toFixed(1)} ft and ${CALL.topStarPeriodS} seconds`);
  });

  it("explains the wave height, the flags, the untuned thresholds and the point", () => {
    const html = renderAbout(freshModel(), ctx);
    expect(html).toContain("open-water wave height in feet");
    expect(html).toContain("not face height");
    expect(html).toContain("lifeguards' flags rule on the beach");
    expect(html).toContain("untuned");
    expect(html).toContain("one forecast point for all of Rockaway");
    expect(html).toContain("Faded stars are what the wind took away");
  });

  it("credits the fonts and links the repository", () => {
    const html = renderAbout(freshModel(), ctx);
    expect(html).toContain("Geist");
    expect(html).toContain("Instrument Serif");
    expect(html).toContain("SIL Open Font License");
    expect(html).toContain('href="https://github.com/erikleon/surf-report"');
  });
});
