import type { CDPSession, Page, TestInfo } from "@playwright/test";

/** Wait until the web fonts have loaded and the layout has settled. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(150);
}

export const isPhone = (info: TestInfo): boolean => info.project.name.startsWith("phone");

/** Index of the readout frame that is showing. */
export function visibleFrame(page: Page): Promise<number> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ro-frame")].findIndex((f) => !f.hidden));
}

/** Text of the readout frame that is showing. */
export function visibleFrameText(page: Page): Promise<string> {
  return page.evaluate(
    () => [...document.querySelectorAll<HTMLElement>(".ro-frame")].find((f) => !f.hidden)?.innerText.trim() ?? "",
  );
}

/** Left edge of the playhead line in CSS pixels. */
export async function playheadX(page: Page): Promise<number> {
  const box = await page.locator(".chart .head line").first().boundingBox();
  if (box === null) throw new Error("the playhead has no box");
  return box.x;
}

export interface Point {
  x: number;
  y: number;
}

/** Drag one finger through the points with raw touch events from the browser protocol. */
export async function touchPath(cdp: CDPSession, points: Point[]): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) return;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const p of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** `n` evenly spaced points from a to b. */
export function line(a: Point, b: Point, n: number): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));
}

export interface ContrastResult {
  selector: string;
  text: string;
  ratio: number;
}

/**
 * WCAG contrast of the text of every visible element that matches a selector,
 * against the first opaque background found by walking up the parents.
 * Colours go through a canvas so any CSS colour syntax comes back as RGBA.
 */
export function contrastOf(page: Page, selectors: string[]): Promise<ContrastResult[]> {
  return page.evaluate((sels) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no canvas");
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      // Computed colours are almost always rgb() or rgba(); read those exactly,
      // because a canvas round trip loses precision at low alpha.
      const m = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\)$/.exec(css);
      if (m !== null) {
        const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return [Number(m[1]), Number(m[2]), Number(m[3]), a];
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: 0 | 1 | 2): number => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const lum = (c: Rgba): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const backdrop = (el: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e !== null; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] === 1) break;
      }
      // Anything left over sits on the browser's canvas colour.
      const scheme = getComputedStyle(document.documentElement).colorScheme;
      let acc: Rgba = matchMedia("(prefers-color-scheme: dark)").matches && scheme.includes("dark") ? [0, 0, 0, 1] : [255, 255, 255, 1];
      for (const layer of layers.reverse()) acc = over(layer, acc);
      return acc;
    };

    const out: Array<{ selector: string; text: string; ratio: number }> = [];
    for (const selector of sels) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        const rect = el.getBoundingClientRect();
        if (own === "" || rect.width <= 2 || rect.height <= 2) continue;
        const bg = backdrop(el);
        const fg = over(parse(getComputedStyle(el).color), bg);
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a) as [number, number];
        out.push({ selector, text: own.slice(0, 40), ratio: (hi + 0.05) / (lo + 0.05) });
      }
    }
    return out;
  }, selectors);
}
