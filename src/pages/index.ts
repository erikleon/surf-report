// Page renderers. The bodies here are placeholders that satisfy the contract
// the server is written against; the real pages replace them.

import type { SiteModel } from "../model.js";

/** Hashed URLs of the static files, as the server serves them. */
export interface PageAssets {
  css: string;
  js: string;
  geist: string;
  serif: string;
}

export interface PageContext {
  /** Epoch milliseconds. */
  nowMs: number;
  /** Canonical origin, for example https://surf.midwoodrathaus.fyi (no trailing slash). */
  siteUrl: string;
  assets: PageAssets;
}

const shell = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

export function renderHome(_model: SiteModel, _ctx: PageContext): string {
  return shell("Rockaway surf report", "<main><h1>Rockaway</h1></main>");
}

export function renderWeek(_model: SiteModel, _ctx: PageContext): string {
  return shell("Week - Rockaway surf report", "<main><h1>Week</h1></main>");
}

export function renderAbout(_model: SiteModel, _ctx: PageContext): string {
  return shell("About - Rockaway surf report", "<main><h1>About</h1></main>");
}

export function renderNotFound(_ctx: PageContext): string {
  return shell("Not found - Rockaway surf report", "<main><h1>Not found</h1></main>");
}

/** Sent with a 503 when no upstream has ever loaded. */
export function renderUnavailable(_ctx: PageContext): string {
  return shell("Forecast unavailable - Rockaway surf report", "<main><h1>Forecast unavailable</h1></main>");
}
