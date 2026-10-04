// The two error pages.

import type { PageContext } from "./context.js";
import { page } from "./layout.js";

export function renderNotFound(ctx: PageContext): string {
  return page(ctx, {
    title: "Page not found - Rockaway surf report",
    description: "That page does not exist. The Rockaway surf report is on the Today page.",
    path: "/",
    noindex: true,
    body:
      `<h1 class="page-title">Page not found</h1>` +
      `<p class="plain">There is nothing at this address. Try <a href="/">today's report</a> or the <a href="/week">week</a>.</p>`,
  });
}

/** Sent with a 503 when no upstream has ever loaded. */
export function renderUnavailable(ctx: PageContext): string {
  return page(ctx, {
    title: "Forecast unavailable - Rockaway surf report",
    description: "The Rockaway surf forecast could not be loaded. Try again in a minute.",
    path: "/",
    noindex: true,
    body:
      `<h1 class="page-title">Forecast unavailable</h1>` +
      `<p class="plain">The forecast could not be loaded. Try again in a minute.</p>`,
  });
}
