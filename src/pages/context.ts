// What the server hands to every page renderer.

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
