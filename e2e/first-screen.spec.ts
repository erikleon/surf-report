import { expect, test } from "@playwright/test";
import { settle } from "./helpers";

test.describe("first screen", () => {
  test("verdict, as-of time and reason fit in the first viewport", async ({ page }, info) => {
    test.skip(info.project.name !== "phone-390", "the first-screen promise is made for a 390 px phone");
    await page.goto("/");
    await settle(page);

    const height = page.viewportSize()?.height ?? 0;
    for (const selector of [".call-word", ".call-asof", ".call-why"]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y, `${selector} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${selector} ends inside the viewport`).toBeLessThanOrEqual(height);
    }

    const word = (await page.locator(".call-word").innerText()).trim();
    expect(["Worth it", "Marginal", "Not today"]).toContain(word);
    // The fake clock reads 10:00 in New York and the data was fetched at that moment.
    await expect(page.locator(".call-asof")).toHaveText(/As of 10:00 AM/);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe("cold load", () => {
  test("transfers at most 100 KB", async ({ page }, info) => {
    const sizes = new Map<string, number>();
    page.on("response", (response) => {
      const length = response.headers()["content-length"];
      sizes.set(response.url(), length === undefined ? NaN : Number(length));
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await settle(page);

    const missing = [...sizes].filter(([, n]) => Number.isNaN(n)).map(([url]) => url);
    expect(missing, "every response states its length").toEqual([]);
    const total = [...sizes.values()].reduce((a, b) => a + b, 0);
    console.log(`page weight on ${info.project.name}: ${total} bytes over ${sizes.size} responses`);
    info.annotations.push({ type: "page-weight", description: `${total} bytes` });
    expect(total).toBeLessThanOrEqual(102_400);
  });

  test("layout shift stays below 0.05", async ({ page }, info) => {
    await page.goto("/");
    await settle(page);
    await page.waitForTimeout(300);
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let sum = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shiftEntry = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shiftEntry.hadRecentInput) sum += shiftEntry.value;
            }
          });
          observer.observe({ type: "layout-shift", buffered: true });
          // Buffered entries arrive in a task after observe(); wait one beat.
          setTimeout(() => {
            observer.disconnect();
            resolve(sum);
          }, 300);
        }),
    );
    console.log(`layout shift on ${info.project.name}: ${shift}`);
    info.annotations.push({ type: "layout-shift", description: String(shift) });
    expect(shift).toBeLessThan(0.05);
  });

  test("number cells use tabular numerals", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const widths = await page.evaluate(() => {
      const sample = document.querySelector<HTMLElement>(".now .num");
      if (sample === null || sample.parentElement === null) throw new Error("no number cell on the page");
      const width = (text: string): number => {
        const span = document.createElement("span");
        span.className = sample.className;
        span.textContent = text;
        sample.parentElement!.appendChild(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      };
      return { ones: width("1111"), zeros: width("0000") };
    });
    expect(widths.ones).toBeGreaterThan(0);
    expect(widths.ones).toBeCloseTo(widths.zeros, 3);
  });
});
