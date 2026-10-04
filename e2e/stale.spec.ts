import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { settle } from "./helpers";
import { controlFor, urlFor } from "./scenarios";

const shotsDir = process.env.SHOTS_DIR ?? "e2e/screenshots";

// The clock is shared by everyone who uses this server, so one test owns it.
test("data 40 minutes old hides the call and keeps the raw numbers", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one test owns the stale server's clock");
  const control = controlFor("stale");
  try {
    await fetch(`${control}/advance?minutes=40`, { method: "POST" });
    await page.goto(`${urlFor("stale")}/`);
    await settle(page);

    await expect(page.locator(".call-word")).toHaveText("No current call.");
    for (const word of ["Worth it", "Marginal", "Not today"]) {
      await expect(page.locator(".call-word")).not.toHaveText(word);
    }
    await expect(page.locator(".call-why")).toContainText("Forecast data is from 10:00 AM.");
    await expect(page.locator(".call-asof")).toHaveCount(0);
    await expect(page.locator("ol.cells")).toHaveCount(0);

    const now = page.locator("dl.now");
    for (const label of ["Wave", "Period", "Wind"]) {
      await expect(now.locator("dt", { hasText: label })).toBeVisible();
    }
    expect(await now.locator(".num").count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator(".stale-sq").count()).toBeGreaterThan(0);
    await expect(page.locator(".now-col.stale").first()).toContainText("as of 10:00 AM");

    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: join(shotsDir, "home-stale-desktop-light.png"), fullPage: true });

    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${urlFor("stale")}/`);
    await settle(phonePage);
    await phonePage.screenshot({ path: join(shotsDir, "home-stale-phone-390-light.png"), fullPage: true });
    await phone.close();
  } finally {
    await fetch(`${control}/reset`, { method: "POST" });
  }
});
