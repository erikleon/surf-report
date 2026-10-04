import { expect, test } from "@playwright/test";
import { settle } from "./helpers";

for (const path of ["/", "/week", "/map", "/about"]) {
  test(`${path} has no horizontal scroll`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
}

test("hour cells match the band under the chart, hour for hour", async ({ page }) => {
  await page.goto("/");
  await settle(page);

  const cells = await page.$$eval("ol.cells li.cell", (items) =>
    items.map((li) => ["good", "marg", "poor", "nodata"].find((k) => li.classList.contains(k)) ?? "?"),
  );
  // The band has one rect per hour from now on, left to right. Today's daylight
  // cells start at the current hour, so they match the first rects.
  const band = await page.$$eval("svg.chart rect[class^='vb-']", (rects) =>
    rects.map((r) => ({ kind: r.getAttribute("class")!.slice(3), x: Number(r.getAttribute("x")) })),
  );
  band.sort((a, b) => a.x - b.x);

  expect(cells.length).toBeGreaterThan(0);
  expect(band.length).toBeGreaterThanOrEqual(cells.length);
  expect(band.slice(0, cells.length).map((b) => b.kind)).toEqual(cells);
});

test("every star icon is icon-sized, empty ones included", async ({ page }) => {
  // The "ok" fixture day has a day with no stars at all, so empty stars appear.
  for (const path of ["/", "/week"]) {
    await page.goto(path);
    await settle(page);
    const sizes = await page.$$eval("svg.star", (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), cls: el.getAttribute("class") ?? "" };
      }),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) {
      expect(s.w, `${path} ${s.cls}`).toBeLessThanOrEqual(20);
      expect(s.h, `${path} ${s.cls}`).toBeLessThanOrEqual(20);
    }
    expect(sizes.some((s) => s.cls.includes("empty"))).toBe(true);
  }
});

test.describe("week page", () => {
  test("each day has a headed table and today starts at the current block", async ({ page }) => {
    await page.goto("/week");
    await settle(page);

    const days = await page.$$eval("section.day", (sections) =>
      sections.map((s) => ({
        id: s.id,
        tables: s.querySelectorAll("table").length,
        scoped: s.querySelectorAll("table th[scope]").length,
        rowHeads: s.querySelectorAll("tbody th[scope='row']").length,
        rows: s.querySelectorAll("tbody tr").length,
        colHeads: s.querySelectorAll("thead th[scope='col']").length,
      })),
    );
    expect(days.length).toBeGreaterThan(1);
    for (const d of days) {
      expect(d.tables, d.id).toBe(1);
      expect(d.colHeads, d.id).toBeGreaterThan(0);
      expect(d.rowHeads, d.id).toBe(d.rows);
    }

    // The fake clock is 10:00, so the first block today is 9 AM.
    const firstToday = await page.locator("#day-2026-10-03 tbody tr th").first().innerText();
    expect(firstToday).toMatch(/^9(:00)? AM/);
  });

  test("every link on the page is reached by Tab, and no table hides content sideways", async ({ page }) => {
    await page.goto("/week");
    await settle(page);

    const linkCount = await page.locator("a[href]").count();
    const reached = new Set<string>();
    for (let i = 0; i < linkCount + 2; i++) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute("href") ?? "");
      if (href !== "") reached.add(href);
    }
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")!));
    for (const href of hrefs) expect(reached.has(href), href).toBe(true);

    // A table wider than its column would need a focusable scroll area. None
    // may overflow, so none needs one.
    const overflowing = await page.$$eval("table.week", (tables) =>
      tables
        .filter((t) => (t.parentElement?.scrollWidth ?? 0) > (t.parentElement?.clientWidth ?? 0))
        .map((t) => t.closest("section")?.id),
    );
    expect(overflowing).toEqual([]);
  });

  test("the day links on the home page point at sections that exist", async ({ page }) => {
    await page.goto("/");
    const targets = await page.$$eval("a.dayrow", (as) => as.map((a) => a.getAttribute("href")!));
    expect(targets.length).toBeGreaterThan(0);
    await page.goto("/week");
    for (const target of targets) {
      const id = target.split("#")[1]!;
      await expect(page.locator(`#${id}`), target).toHaveCount(1);
    }
  });
});

test("about lists three update times", async ({ page }) => {
  await page.goto("/about");
  const items = await page.locator("ul.sources li").allInnerTexts();
  expect(items).toHaveLength(3);
  for (const item of items) expect(item).toMatch(/Last good update 3 Oct 2026, 10:00 AM, New York time/);
});
