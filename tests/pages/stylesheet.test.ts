import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../../assets/site.css", import.meta.url)), "utf8");

describe("assets/site.css", () => {
  it("has both font placeholders for the server to replace", () => {
    expect(css).toContain("url(__FONT_GEIST__) format(\"woff2\")");
    expect(css).toContain("url(__FONT_SERIF__) format(\"woff2\")");
  });

  it("swaps fonts without a blank period", () => {
    expect(count(/font-display:\s*swap/g)).toBe(2);
  });

  it("sizes fallback faces to the web fonts", () => {
    expect(css).toContain('font-family: "Geist Fallback"');
    expect(css).toContain('font-family: "Instrument Serif Fallback"');
    for (const prop of ["size-adjust", "ascent-override", "descent-override", "line-gap-override"]) {
      expect(count(new RegExp(`^\\s+${prop}:`, "gm"))).toBe(2);
    }
  });

  it("uses none of the banned decorations", () => {
    expect(css).not.toContain("box-shadow");
    expect(css).not.toContain("gradient(");
    expect(css).not.toContain("border-left");
  });

  it("has a dark scheme and a reduced motion rule", () => {
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("defines the colour tokens", () => {
    for (const t of ["--paper", "--ink", "--sea", "--foam", "--good", "--poor", "--stale", "--marg"]) {
      expect(css).toContain(`${t}:`);
    }
  });

  it("never uses amber as a text colour", () => {
    for (const m of css.matchAll(/(^|[;{\s])color\s*:\s*([^;}]*)/g)) {
      expect(m[2]).not.toContain("--stale");
    }
    expect(css).not.toMatch(/(^|[;{\s])(?:fill|stroke)\s*:\s*var\(--stale\)/);
  });

  it("never removes the focus outline", () => {
    expect(css).not.toMatch(/outline\s*:\s*(none|0)\b/);
    expect(css).toContain("outline: 2px solid var(--sea)");
    expect(css).toContain("outline-offset: 2px");
  });

  it("uses only the 2px and 4px radii", () => {
    for (const m of css.matchAll(/border-radius\s*:\s*([^;]+)/g)) {
      expect(m[1]).toMatch(/^var\(--r-(sm|md)\)$/);
    }
  });

  it("styles the chart and scrub classes", () => {
    for (const c of [
      "night", "nodata", "grid", "day", "daylabel", "wavearea", "periodline", "bridge",
      "vb-good", "vb-marg", "vb-poor", "vb-nodata", "wind", "head",
      "timeline", "readout", "ro-frame", "ro-cell", "ro-k", "ro-v", "ro-why", "ro-verdict", "ro-when",
      "nowbtn", "chartwrap", "scrubber", "empty",
    ]) {
      expect(css, c).toMatch(new RegExp(`\\.${c}\\b`));
    }
  });

  it("hides a hidden readout frame despite its flex display", () => {
    expect(css).toMatch(/\.ro-frame\[hidden\]\s*{\s*display:\s*none/);
  });

  it("keeps touch-action pan-y on the chart", () => {
    expect(css).toMatch(/touch-action:\s*pan-y/);
  });

  it("scopes the chart's empty-message style to the paragraph, not the star icons", () => {
    // An empty star is an svg with class "empty". A bare .empty rule gave it
    // padding and a pale fill, which drew each one as a large blank box.
    expect(css).not.toMatch(/^\.empty\b/m);
    expect(css).toMatch(/^p\.empty\b/m);
  });

  it("caps the content width at 1040px", () => {
    expect(css).toContain("max-width: 1040px");
  });
});

function count(re: RegExp): number {
  return (css.match(re) ?? []).length;
}
