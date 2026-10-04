import { expect, test } from "@playwright/test";
import { settle } from "./helpers";

// The interactive map in a real browser, under the page's real CSP.
//
// Headless Chromium draws WebGL in software, which is slow, so these run one
// after another within each project and allow 45 seconds for the first render.
test.describe.configure({ mode: "serial" });
const READY = { timeout: 45_000 };

test.describe("map page", () => {
  test("renders the interactive map with no CSP violations or page errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(msg.text());
    });
    page.on("pageerror", (err) => problems.push(err.message));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        console.error(`csp violation: ${e.violatedDirective} ${e.blockedURI}`);
      });
    });

    const res = await page.goto("/map");
    expect(res?.status()).toBe(200);
    await page.locator(".map.map-ready").waitFor(READY);
    await settle(page);
    // The static fallback is hidden once the interactive map has rendered.
    await expect(page.locator(".map-fallback")).toBeHidden();
    await expect(page.locator(".map-canvas canvas").first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("draws the wind layer and offers the forecast hours", async ({ page }) => {
    await page.goto("/map");
    await page.locator(".map.map-ready").waitFor(READY);
    const slider = page.locator(".wind-controls .wind-hour");
    await expect(slider).toBeVisible();
    const label = page.locator(".wind-label");
    const first = await label.textContent();
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(label).not.toHaveText(first ?? "");
  });

  test("shows the static map and the wind text with JavaScript off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/map");
    const img = page.locator(".map-fallback img");
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Wind" })).toBeVisible();
    await context.close();
  });

  test("sends the map's own CSP and keeps it off other pages", async ({ request }) => {
    const map = await request.get("/map");
    const home = await request.get("/");
    expect(map.headers()["content-security-policy"]).toContain("worker-src 'self'");
    expect(home.headers()["content-security-policy"]).not.toContain("worker-src");
  });

  test("answers basemap range requests with 206", async ({ page, request }) => {
    await page.goto("/map");
    const style = await page.locator(".map-canvas").getAttribute("data-style-light");
    const styleJson = await (await request.get(style ?? "")).json();
    const url = String(styleJson.sources?.protomaps?.url ?? Object.values(styleJson.sources ?? {})[0]?.url ?? "");
    const path = url.replace(/^pmtiles:\/\//, "");
    expect(path).toMatch(/^\/assets\/map\/basemap\.[0-9a-f]{8}\.pmtiles$/);
    const res = await request.get(path, { headers: { Range: "bytes=0-126" } });
    expect(res.status()).toBe(206);
    expect((await res.body()).length).toBe(127);
  });
});
