import { describe, expect, it } from "vitest";
import { renderHome } from "../../src/pages/index.js";
import type { SiteModel } from "../../src/model.js";
import { buildModel } from "../../src/model.js";
import { fromNow } from "../../src/chart.js";
import type { DayVerdict } from "../../src/types.js";
import { MIN, NOW, NOW_NIGHT, count, ctx, freshModel, snap } from "./helpers.js";

describe("home with a fresh complete snapshot", () => {
  const model = freshModel();
  const html = renderHome(model, ctx);

  it("shows the verdict word as the one h1", () => {
    expect(model.verdict).toBeDefined();
    expect(html).toContain(`<h1 class="call-word">${model.verdict?.word}</h1>`);
  });

  it("prints the as-of time directly under the word", () => {
    // Fetched at 9:55 AM New York time.
    expect(html).toMatch(/<\/h1><p class="call-asof">As of 9:55 AM<\/p>/);
  });

  it("labels the stars and shows faded stars for what the wind took away", () => {
    const v = model.verdict as DayVerdict;
    const faded = v.swellStars - v.stars;
    const label = `${v.stars} of 5 stars${faded > 0 ? `, wind took away ${faded}` : ""}`;
    expect(html).toContain(`role="img" aria-label="${label}"`);
    expect(count(html.split('class="call-stars"')[1]?.split("</div>")[0] ?? "", /star solid/g)).toBe(v.stars);
  });

  it("shows faded stars when the wind costs stars", () => {
    const m = { ...freshModel(), verdict: { ...(model.verdict as DayVerdict), stars: 3, swellStars: 5 } as DayVerdict };
    const out = renderHome(m, ctx);
    expect(out).toContain('aria-label="3 of 5 stars, wind took away 2"');
    expect(count(out, /class="star faded"/g)).toBeGreaterThanOrEqual(2);
  });

  it("shows the reason line", () => {
    expect(html).toContain(`<p class="call-why">${model.verdict?.why}</p>`);
  });

  it("draws one hour cell per verdict cell", () => {
    expect(count(html, /<li class="cell /g)).toBe(model.verdict?.cells.length);
  });

  it("has the now strip with four columns", () => {
    const strip = html.split('<dl class="now">')[1]?.split("</dl>")[0] ?? "";
    expect(count(strip, /<div class="now-col/g)).toBe(4);
    for (const label of ["Wave", "Period", "Wind", "Tide"]) expect(strip).toContain(`<dt>${label}</dt>`);
    expect(strip).toMatch(/offshore|onshore|cross shore/);
  });

  it("has the chart with its readout", () => {
    expect(html).toContain('class="chart"');
    expect(html).toContain('class="scrubber"');
  });

  it("lists three next-day rows linked to the week page", () => {
    expect(count(html, /class="dayrow"/g)).toBe(3);
    expect(html).toContain('href="/week#day-2026-10-04"');
    expect(html).toContain('href="/week#day-2026-10-06"');
    expect(html).toMatch(/Sunday/);
  });

  it("loads exactly one script, with the hashed src, deferred", () => {
    expect(count(html, /<script\b/g)).toBe(1);
    expect(html).toContain('<script src="/assets/scrub.def456.js" defer></script>');
  });

  it("links to the about page for the rating", () => {
    expect(html).toContain('href="/about">How the rating works</a>');
  });
});

describe("home when the call is stale", () => {
  const model = buildModel(snap(NOW - 45 * MIN, NOW - 45 * MIN, NOW - 5 * MIN), NOW);
  const html = renderHome(model, ctx);

  it("hides the word, stars and cells", () => {
    expect(model.callState).toBe("stale");
    expect(html).toContain("No current call.");
    expect(html).not.toContain("Worth it");
    expect(html).not.toContain("Not today");
    expect(html).not.toContain('class="call-stars"');
    expect(html).not.toContain('class="cells"');
  });

  it("drops the per-hour verdicts from the chart readout too", () => {
    expect(html).not.toContain("ro-verdict");
    expect(html).not.toContain("The call ");
    expect(html).toContain('class="nocall"');
  });

  it("says when the data is from, with the amber rule and marker", () => {
    expect(html).toContain("Forecast data is from 9:15 AM.");
    expect(html).toContain('class="call stale"');
    expect(html).toContain('class="stale-sq"');
  });

  it("keeps the raw numbers, marked stale with an as-of time", () => {
    const strip = html.split('<dl class="now">')[1]?.split("</dl>")[0] ?? "";
    expect(strip).toContain("Wave");
    expect(strip).toMatch(/<span class="num">\d+\.\d<\/span>/);
    expect(strip).toContain("now-col stale");
    expect(strip).toContain("as of 9:15 AM");
    expect(html).toContain('class="chart"');
  });
});

describe("home when nothing has loaded", () => {
  it("says it is checking the water", () => {
    const html = renderHome(buildModel(snap(), NOW), ctx);
    expect(html).toContain("Checking the water...");
    expect(html).not.toContain("No current call.");
    expect(html).not.toContain('class="call-stars"');
    expect(html).toContain("Not loaded");
    expect(html).toContain("Not enough forecast data");
  });
});

describe("home when the verdict is none", () => {
  it("shows No forecast and the reason", () => {
    const base = freshModel();
    const model: SiteModel = {
      ...base,
      verdict: {
        word: "No forecast",
        kind: "none",
        stars: 0,
        swellStars: 0,
        why: "No forecast for the remaining daylight hours",
        day: "today",
        cells: [],
      },
    };
    const html = renderHome(model, ctx);
    expect(html).toContain('<h1 class="call-word">No forecast</h1>');
    expect(html).toContain("No forecast for the remaining daylight hours");
    expect(html).not.toContain('class="call-stars"');
  });
});

describe("home with a gap hour now", () => {
  it("shows No forecast in the wave, period and wind columns", () => {
    const base = freshModel();
    const [first] = fromNow(base.hours, base.nowStamp, 1);
    const hours = base.hours.map((h) => (h.time === first?.time ? { kind: "gap" as const, time: h.time } : h));
    const html = renderHome({ ...base, hours }, ctx);
    const strip = html.split('<dl class="now">')[1]?.split("</dl>")[0] ?? "";
    expect(count(strip, /No forecast/g)).toBe(3);
    expect(strip).toContain("<dt>Tide</dt>");
  });
});

describe("home after sunset", () => {
  const model = freshModel(NOW_NIGHT);
  const html = renderHome(model, ctx);

  it("says the call is for tomorrow", () => {
    expect(model.verdict?.day).toBe("tomorrow");
    expect(html).toContain('<p class="call-day">Tomorrow</p>');
    expect(html).toContain('aria-label="Daylight hours tomorrow"');
  });

  it("lists the three days after today", () => {
    expect(html).toContain('href="/week#day-2026-10-04"');
    expect(count(html, /class="dayrow"/g)).toBe(3);
  });
});

describe("home when the tide does not cover now", () => {
  it("leaves the tide column out", () => {
    const base = freshModel();
    const html = renderHome({ ...base, tide: { time: ["2026-01-01T00:00"], feet: [1] } }, ctx);
    expect(html).not.toContain("<dt>Tide</dt>");
    expect(count(html, /<div class="now-col/g)).toBe(3);
  });
});
