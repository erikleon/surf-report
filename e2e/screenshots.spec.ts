import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { settle } from "./helpers";
import { urlFor } from "./scenarios";

// Full-page captures for a person to look at. They are written to SHOTS_DIR
// and nothing compares against them.
const shotsDir = process.env.SHOTS_DIR ?? "e2e/screenshots";

const pages = [
  ["home", "/"],
  ["week", "/week"],
  ["about", "/about"],
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`screenshots, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const [name, path] of pages) {
      test(`${name}`, async ({ page }, info) => {
        test.skip(info.project.name === "phone-320", "phone-390 and desktop are the reference sizes");
        mkdirSync(shotsDir, { recursive: true });
        await page.goto(path);
        await settle(page);
        const file = join(shotsDir, `${name}-${info.project.name}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        expect(await page.evaluate(() => document.fonts.check("16px Geist"))).toBe(true);
      });
    }
  });
}

test("home with missing forecast hours", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-390", "one size is enough");
  mkdirSync(shotsDir, { recursive: true });
  await page.goto(`${urlFor("nulls")}/`);
  await settle(page);
  await page.screenshot({ path: join(shotsDir, "home-nulls-phone-390-light.png"), fullPage: true });
});
