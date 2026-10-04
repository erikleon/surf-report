// The map page. This body is a placeholder that satisfies the contract the
// server is written against; the real page replaces it.

import type { SiteModel } from "../model.js";
import type { PageContext } from "./context.js";

export function renderMap(_model: SiteModel, _ctx: PageContext): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Map - Rockaway surf report</title></head><body><main id="main"><h1>Map</h1></main></body></html>`;
}
