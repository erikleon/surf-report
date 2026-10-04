import { expect, test } from "@playwright/test";
import { contrastOf, settle, type ContrastResult } from "./helpers";

const HOME = [".call-word", ".call-why", ".call-asof", "nav a", ".site-foot p", ".site-foot a", ".label", ".now dt", ".now .num", ".now .unit", ".now .sub", ".ro-frame:not([hidden]) .ro-k", ".ro-frame:not([hidden]) .ro-v", ".days a span", "[class^='v-']"];
const WEEK = ["nav a", ".week th", ".week td .num", ".week td .sub", ".week td .why", ".week .tide-line", ".page-title", ".lede", ".day h2", ".site-foot p", ".site-foot a", "[class^='v-']"];

const lowest = (r: ContrastResult[]): string => {
  const min = r.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  return `${min.ratio.toFixed(2)} (${min.selector}: ${min.text})`;
};

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("home text meets 4.5:1", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      const results = await contrastOf(page, HOME);
      expect(results.length).toBeGreaterThan(10);
      const failing = results.filter((r) => r.ratio < 4.5);
      console.log(`home ${scheme}: ${results.length} text runs, lowest ${lowest(results)}`);
      expect(failing, JSON.stringify(failing)).toEqual([]);
    });

    test("week text meets 4.5:1", async ({ page }) => {
      await page.goto("/week");
      await settle(page);
      const results = await contrastOf(page, WEEK);
      expect(results.length).toBeGreaterThan(10);
      const failing = results.filter((r) => r.ratio < 4.5);
      console.log(`week ${scheme}: ${results.length} text runs, lowest ${lowest(results)}`);
      expect(failing, JSON.stringify(failing)).toEqual([]);
    });
  });
}
