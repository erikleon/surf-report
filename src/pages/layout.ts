// The document shell shared by every page: head, header, nav, footer.

import { escapeHtml } from "../html.js";
import type { PageContext } from "./context.js";

export type NavItem = "today" | "week" | "map" | "about";

export interface PageSpec {
  title: string;
  description: string;
  /** Path of this page, starting with "/". Used for the canonical link. */
  path: string;
  /** Which nav item is the current page. Error pages have none. */
  current?: NavItem;
  /** Only the home page carries the scrub script. */
  script?: boolean;
  /** Extra stylesheet and script tags, placed before the site stylesheet so it can override them. */
  head?: string;
  /** Error pages ask search engines to skip them. */
  noindex?: boolean;
  body: string;
}

const NAV: Array<{ id: NavItem; href: string; text: string }> = [
  { id: "today", href: "/", text: "Today" },
  { id: "week", href: "/week", text: "Week" },
  { id: "map", href: "/map", text: "Map" },
  { id: "about", href: "/about", text: "About" },
];

function nav(current: NavItem | undefined): string {
  const items = NAV.map(
    (n) =>
      `<li><a href="${n.href}"${n.id === current ? ` aria-current="page"` : ""}>${n.text}</a></li>`,
  ).join("");
  return `<nav aria-label="Primary"><ul class="nav">${items}</ul></nav>`;
}

const FOOTER =
  `<footer class="wrap site-foot">` +
  `<p>Wave and wind data by <a href="https://open-meteo.com/">Open-Meteo.com</a> ` +
  `(<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>). ` +
  `Tide predictions from <a href="https://tidesandcurrents.noaa.gov/">NOAA CO-OPS</a>.</p>` +
  `<p>Model forecasts for one point off Rockaway. The lifeguards' flags rule on the beach. ` +
  `<a href="/about">How the rating works</a>.</p>` +
  `</footer>`;

export function page(ctx: PageContext, spec: PageSpec): string {
  const a = ctx.assets;
  const canonical = `${ctx.siteUrl}${spec.path}`;
  return (
    `<!doctype html>\n<html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
    `<title>${escapeHtml(spec.title)}</title>` +
    `<meta name="description" content="${escapeHtml(spec.description)}">` +
    (spec.noindex ? `<meta name="robots" content="noindex">` : "") +
    `<link rel="canonical" href="${escapeHtml(canonical)}">` +
    `<link rel="preload" href="${escapeHtml(a.geist)}" as="font" type="font/woff2" crossorigin>` +
    `<link rel="preload" href="${escapeHtml(a.serif)}" as="font" type="font/woff2" crossorigin>` +
    (spec.head ?? "") +
    `<link rel="stylesheet" href="${escapeHtml(a.css)}">` +
    (spec.script ? `<script src="${escapeHtml(a.js)}" defer></script>` : "") +
    `</head><body>` +
    `<a class="skip" href="#main">Skip to content</a>` +
    `<header class="wrap site-head">` +
    `<p class="site"><a href="/">Rockaway</a></p>` +
    `<p class="place">Beach 67th to Beach 116th, A&nbsp;train</p>` +
    nav(spec.current) +
    `</header>` +
    `<main id="main" class="wrap">${spec.body}</main>` +
    FOOTER +
    `</body></html>`
  );
}
