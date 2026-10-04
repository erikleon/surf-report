import { expect, test } from "@playwright/test";
import { line, isPhone, playheadX, settle, touchPath, visibleFrame, visibleFrameText } from "./helpers";
import { urlFor } from "./scenarios";

test.describe("touch scrub", () => {
  test.beforeEach(({}, info) => {
    test.skip(!isPhone(info), "touch only");
  });

  test("a horizontal drag across the chart moves the readout and the playhead", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await page.locator("svg.chart").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await page.locator("svg.chart").boundingBox())!;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);

    const frameBefore = await visibleFrame(page);
    const headBefore = await playheadX(page);
    await touchPath(cdp, line({ x: box.x + box.width * 0.2, y }, { x: box.x + box.width * 0.8, y }, 12));

    expect(await visibleFrame(page)).toBeGreaterThan(frameBefore);
    expect(await playheadX(page)).toBeGreaterThan(headBefore + 20);
  });

  test("a vertical swipe that starts on the chart scrolls the page and leaves the readout alone", async ({
    page,
  }) => {
    await page.goto("/");
    await settle(page);
    // Put the chart's middle three quarters of the way down the screen, so
    // there is page left below it to scroll into.
    await page.locator("svg.chart").evaluate((el) => {
      const middle = el.getBoundingClientRect().top + window.scrollY + el.getBoundingClientRect().height / 2;
      window.scrollTo(0, Math.max(0, middle - window.innerHeight * 0.75));
    });
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY);
    expect(room, "the page must have room to scroll down").toBeGreaterThan(150);
    const box = (await page.locator("svg.chart").boundingBox())!;
    const x = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    const frameBefore = await visibleFrame(page);
    const textBefore = await visibleFrameText(page);
    await touchPath(cdp, line({ x, y: startY }, { x: x + 4, y: startY - 260 }, 16));
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
    expect(await visibleFrame(page)).toBe(frameBefore);
    expect(await visibleFrameText(page)).toBe(textBefore);
  });
});

test.describe("mouse scrub", () => {
  test("hovering the chart moves the readout without a press", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse only");
    await page.goto("/");
    await settle(page);
    await page.locator("svg.chart").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await page.locator("svg.chart").boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.2, y);
    const first = await visibleFrame(page);
    const headFirst = await playheadX(page);
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 });

    expect(await visibleFrame(page)).toBeGreaterThan(first);
    expect(await playheadX(page)).toBeGreaterThan(headFirst + 20);
  });
});

test.describe("keyboard", () => {
  test("Tab reaches the range input, arrows move the readout, Now returns", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.classList.contains("scrubber") ?? false)) break;
    }
    const range = page.getByRole("slider", { name: "Forecast hour" });
    await expect(range).toBeFocused();

    // The input is invisible by design, so the focus ring is drawn on it or on the chart it controls.
    const ring = await page.evaluate(() => {
      const width = (el: Element | null): number => {
        if (el === null) return 0;
        const s = getComputedStyle(el);
        return s.outlineStyle === "none" ? 0 : parseFloat(s.outlineWidth);
      };
      return {
        input: width(document.querySelector(".scrubber")),
        chart: width(document.querySelector(".chartwrap")),
      };
    });
    expect(Math.max(ring.input, ring.chart)).toBeGreaterThan(0);

    const valueBefore = await range.getAttribute("aria-valuetext");
    const textBefore = await visibleFrameText(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");

    expect(await visibleFrame(page)).toBe(3);
    expect(await visibleFrameText(page)).not.toBe(textBefore);
    const valueAfter = (await range.getAttribute("aria-valuetext")) ?? "";
    expect(valueAfter).not.toBe(valueBefore);
    expect(valueAfter).toMatch(/Wave \d/);
    // A label must never run into its value, as in "Wave2.1 ft".
    expect(valueAfter).not.toMatch(/[A-Za-z]\d/);

    await page.locator(".ro-frame:not([hidden]) .nowbtn").click();
    expect(await visibleFrame(page)).toBe(0);
  });
});

test.describe("hours with no forecast", () => {
  test.use({ baseURL: urlFor("nulls") });

  test("the chart shades and bridges the gap, and the readout shows no numbers", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    expect(await page.locator("svg.chart rect.nodata").count()).toBeGreaterThan(0);
    const bridge = page.locator("svg.chart path.bridge").first();
    await expect(bridge).toHaveCount(1);
    expect(await bridge.evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe("none");

    await page.getByRole("slider", { name: "Forecast hour" }).focus();
    let frame = "";
    for (let i = 0; i < 48; i++) {
      await page.keyboard.press("ArrowRight");
      frame = await visibleFrameText(page);
      if (frame.includes("No forecast for this hour")) break;
    }
    expect(frame).toContain("No forecast for this hour");
    expect(await page.locator(".ro-frame:not([hidden]) .ro-cell").count()).toBe(0);
    expect(frame).not.toMatch(/\b(ft|mph)\b|\d+s\b/);
  });
});
