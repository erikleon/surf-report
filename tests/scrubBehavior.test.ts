// Runs assets/scrub.js against a small hand-built DOM, so the behaviour that a
// browser would show is checked without adding a DOM library. The real browser
// checks (touch, scroll, layout) belong to the Playwright suite.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (e: Record<string, unknown>) => void;

class FakeEl {
  children: FakeEl[] = [];
  hidden = false;
  value: string | number = 0;
  private attrs = new Map<string, string>();
  private handlers = new Map<string, Handler[]>();
  constructor(
    private classes: string[] = [],
    private text = "",
  ) {}
  get classList() {
    return { contains: (c: string) => this.classes.includes(c) };
  }
  get textContent(): string {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.text;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  fire(type: string, e: Record<string, unknown> = {}) {
    for (const fn of this.handlers.get(type) ?? []) fn(e);
  }
  getBoundingClientRect() {
    return { left: 0, width: 960 };
  }
  setPointerCapture() {}
}

const span = (cls: string, text: string) => new FakeEl([cls], text);
const wrap = (cls: string, ...kids: FakeEl[]) => {
  const el = new FakeEl([cls]);
  el.children = kids;
  return el;
};

/** A frame laid out exactly as renderScrub writes it, with no whitespace between spans. */
function frame(when: string, time: string, cells: Array<[string, string]>, call: string, note: string, withButton: boolean) {
  const kids = [
    wrap("ro-when", span("ro-k", when), span("ro-v", time)),
    ...cells.map(([k, v]) => wrap("ro-cell", span("ro-k", k), span("ro-v", v))),
    wrap("ro-verdict", span("ro-k", "The call"), span("ro-v", call)),
  ];
  if (withButton) kids.push(new FakeEl(["nowbtn"], "Now"));
  kids.push(new FakeEl(["ro-why"], note));
  const f = new FakeEl(["ro-frame"]);
  f.children = kids;
  return f;
}

function load() {
  const frames = [
    frame("Now", "1:00 PM", [["Surf", "3.4 ft"], ["Period", "8s"]], "Worth it", "light offshore", false),
    frame("Today", "2:00 PM", [["Surf", "3.1 ft"], ["Period", "8s"]], "Marginal", "12 mph cross shore", true),
    frame("Today", "3:00 PM", [["Surf", "2.0 ft"], ["Period", "7s"]], "Not today", "onshore 15 mph", true),
  ];
  // The server renders every frame after the first hidden.
  for (const f of frames.slice(1)) f.hidden = true;
  const svg = new FakeEl(["chart"]);
  svg.setAttribute("data-vbw", "960");
  svg.setAttribute("data-x0", "40");
  svg.setAttribute("data-x1", "916");
  const head = new FakeEl(["head"]);
  (svg as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector = (s) =>
    s === ".head" ? head : null;
  const range = new FakeEl(["scrubber"]);
  const tl = new FakeEl(["timeline"]) as FakeEl & {
    querySelectorAll: (s: string) => FakeEl[];
    querySelector: (s: string) => FakeEl | null;
  };
  tl.querySelectorAll = (s) => (s === ".readout .ro-frame" ? frames : []);
  tl.querySelector = (s) => (s === "svg.chart" ? svg : s === ".scrubber" ? range : null);
  const document = { querySelectorAll: (s: string) => (s === ".timeline" ? [tl] : []) };
  runInNewContext(readFileSync("assets/scrub.js", "utf8"), { document });
  return { frames, range, tl, svg, head };
}

describe("scrub.js", () => {
  it("speaks a frame with spaces between a label and its value, and commas between parts", () => {
    const { range } = load();
    range.value = 1;
    range.fire("input");
    expect(range.getAttribute("aria-valuetext")).toBe(
      "Today, 2:00 PM, Surf 3.1 ft, Period 8s, The call Marginal, 12 mph cross shore",
    );
  });

  it("leaves the Now button out of the spoken text", () => {
    const { range } = load();
    range.value = 2;
    range.fire("input");
    expect(range.getAttribute("aria-valuetext")).not.toContain("Now");
  });

  it("shows only the chosen frame and moves the playhead in proportion", () => {
    const { frames, range, head } = load();
    range.value = 2;
    range.fire("input");
    expect(frames.map((f) => f.hidden)).toEqual([true, true, false]);
    expect(head.getAttribute("transform")).toBe("translate(876.0 0)");
  });

  it("clamps an out of range value to the last hour", () => {
    const { frames, range } = load();
    range.value = 99;
    range.fire("input");
    expect(frames[2]?.hidden).toBe(false);
  });

  it("returns to the first hour from the Now button", () => {
    const { frames, range, tl } = load();
    range.value = 2;
    range.fire("input");
    tl.fire("click", { target: new FakeEl(["nowbtn"]) });
    expect(frames.map((f) => f.hidden)).toEqual([false, true, true]);
    expect(range.getAttribute("aria-valuetext")).toBe(
      "Now, 1:00 PM, Surf 3.4 ft, Period 8s, The call Worth it, light offshore",
    );
  });

  it("does nothing for a timeline with a single frame", () => {
    const document = { querySelectorAll: () => [] };
    expect(() => runInNewContext(readFileSync("assets/scrub.js", "utf8"), { document })).not.toThrow();
  });
});
