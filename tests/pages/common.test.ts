// Checks that hold for every page.

import { describe, expect, it } from "vitest";
import {
  renderAbout,
  renderHome,
  renderNotFound,
  renderUnavailable,
  renderWeek,
  type PageContext,
} from "../../src/pages/index.js";
import type { DayVerdict } from "../../src/types.js";
import { allPages, count, ctx, freshModel } from "./helpers.js";

const render = {
  home: renderHome,
  week: renderWeek,
  about: renderAbout,
  notFound: renderNotFound,
  unavailable: renderUnavailable,
};

const CURRENT: Record<string, string | undefined> = {
  home: "/",
  week: "/week",
  about: "/about",
  notFound: undefined,
  unavailable: undefined,
};

const PATH: Record<string, string> = { home: "/", week: "/week", about: "/about", notFound: "/", unavailable: "/" };

const pages = allPages(render);

describe.each(Object.entries(pages))("%s page", (name, html) => {
  it("is a full document with the head essentials", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}">/);
    expect(html).toContain('<link rel="stylesheet" href="/assets/site.abc123.css">');
  });

  it("preloads both fonts", () => {
    for (const f of ["/assets/geist.111.woff2", "/assets/serif.222.woff2"]) {
      expect(html).toContain(`<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`);
    }
  });

  it("has the canonical link", () => {
    expect(html).toContain(`<link rel="canonical" href="https://surf.example.test${PATH[name]}">`);
  });

  it("has no inline script, style, style attribute or event handler", () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/<[^>]*\sstyle\s*=/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  });

  it("makes no request to another origin", () => {
    for (const tag of html.match(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/g) ?? []) {
      if (/rel="canonical"/.test(tag)) continue;
      const url = /\s(?:src|href)="([^"]*)"/.exec(tag)?.[1];
      if (url !== undefined) expect(url, tag).toMatch(/^\/(?!\/)/);
    }
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
    expect(html).not.toMatch(/@import/);
  });

  it("has the landmarks, the skip link and one h1", () => {
    expect(html).toContain('<a class="skip" href="#main">');
    expect(html).toContain("<header");
    expect(html).toContain('<nav aria-label="Primary">');
    expect(html).toContain('<main id="main"');
    expect(html).toContain("<footer");
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toContain('<p class="site"><a href="/">Rockaway</a></p>');
  });

  it("has the three nav links and marks only the current one", () => {
    const nav = html.split("<nav")[1]?.split("</nav>")[0] ?? "";
    expect(count(nav, /<a /g)).toBe(3);
    for (const [href, text] of [["/", "Today"], ["/week", "Week"], ["/about", "About"]]) {
      expect(nav).toContain(`href="${href}"`);
      expect(nav).toContain(`>${text}</a>`);
    }
    const marked = [...nav.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
    const want = CURRENT[name];
    expect(marked).toEqual(want === undefined ? [] : [want]);
  });

  it("credits the data sources in the footer", () => {
    const footer = html.split("<footer")[1] ?? "";
    expect(footer).toContain("Open-Meteo");
    expect(footer).toContain("NOAA");
  });

  it("has no em dash or emoji", () => {
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("script tag", () => {
  it("is only on the home page", () => {
    expect(count(pages["home"] as string, /<script\b/g)).toBe(1);
    for (const name of ["week", "about", "notFound", "unavailable"]) {
      expect(pages[name]).not.toContain("<script");
    }
  });
});

describe("error pages", () => {
  it("not found is plain and asks not to be indexed", () => {
    expect(pages["notFound"]).toContain("Page not found");
    expect(pages["notFound"]).toContain('<meta name="robots" content="noindex">');
  });

  it("unavailable says to try again in a minute", () => {
    expect(pages["unavailable"]).toContain("Forecast unavailable");
    expect(pages["unavailable"]).toContain("Try again in a minute.");
  });
});

describe("hostile strings", () => {
  const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
  const hostile: PageContext = {
    nowMs: ctx.nowMs,
    siteUrl: `https://x.test/${evil}`,
    assets: { css: `/a/${evil}.css`, js: `/a/${evil}.js`, geist: `/a/${evil}.1`, serif: `/a/${evil}.2` },
  };
  const base = freshModel();
  const model = {
    ...base,
    verdict: { ...(base.verdict as DayVerdict), why: evil },
  };

  it.each(Object.entries(allPages(render, hostile, model)))("%s escapes them", (_name, html) => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    // Quoted attribute values may hold the escaped text; outside them there is no handler.
    const stripped = html.replace(/"[^"]*"/g, '""');
    expect(stripped).not.toMatch(/<[a-z][^>]*\sonerror=/);
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`"><script>`);
  });

  it("home shows the hostile reason as text", () => {
    expect(renderHome(model, ctx)).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
