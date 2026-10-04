import { expect, test } from "@playwright/test";

test.describe("JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the verdict, the now strip and the first readout frame are on the page", async ({ page }) => {
    await page.goto("/");

    const word = (await page.locator(".call-word").innerText()).trim();
    expect(["Worth it", "Marginal", "Not today"]).toContain(word);
    await expect(page.locator("dl.now")).toBeVisible();
    await expect(page.locator(".ro-frame").first()).toBeVisible();
    await expect(page.locator(".ro-frame").first()).toContainText("Now");

    // Every later frame stays hidden, so none of its text shows.
    const visible = await page.locator(".ro-frame").evaluateAll(
      (frames) => frames.filter((f) => (f as HTMLElement).offsetParent !== null).length,
    );
    expect(visible).toBe(1);
    expect(await page.locator(".nowbtn").first().isVisible()).toBe(false);
  });
});
