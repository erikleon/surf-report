// What the server hands to every page renderer.

/** Hashed URLs of the static files, as the server serves them. */
export interface PageAssets {
  css: string;
  js: string;
  geist: string;
  serif: string;
  /** Present when the server has the map files. Only the map page uses them. */
  map?: MapAssets;
}

/**
 * URLs of everything the map page loads. All are same-origin paths with a
 * content hash, except `wind`, which is live data.
 */
export interface MapAssets {
  /** The MapLibre module entry. Its worker and shared chunk sit beside it in the same hashed folder. */
  maplibre: string;
  maplibreCss: string;
  /** The PMTiles reader, a classic script. */
  pmtiles: string;
  /** Our map client, a module script. */
  client: string;
  /** Basemap styles with the basemap and glyph placeholders already replaced. */
  styleLight: string;
  styleDark: string;
  /** The static nearshore map, the page's content without JavaScript. */
  staticSvg: string;
  bathymetry: string;
  land: string;
  shore: string;
  /** Live wind field JSON, not hashed. */
  wind: string;
}

export interface PageContext {
  /** Epoch milliseconds. */
  nowMs: number;
  /** Canonical origin, for example https://surf.midwoodrathaus.fyi (no trailing slash). */
  siteUrl: string;
  assets: PageAssets;
}
