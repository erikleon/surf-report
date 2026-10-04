// The static files, read once at startup and served under content-hashed URLs.
// A file that changes gets a new URL, so the browser can keep each one for a year.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { PageAssets } from "./pages/index.js";

export interface Asset {
  body: Buffer;
  type: string;
  /** Precompressed bodies by Content-Encoding name. Empty for files that are already compressed. */
  encodings: Record<string, Buffer>;
}

export interface Assets {
  urls: PageAssets;
  /** The asset for an exact URL path, or undefined. Nothing else on disk is reachable. */
  lookup(pathname: string): Asset | undefined;
}

const GEIST_TOKEN = "__FONT_GEIST__";
const SERIF_TOKEN = "__FONT_SERIF__";

function readSource(dir: string, name: string): Buffer {
  const path = join(dir, name);
  try {
    return readFileSync(path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read asset ${path}: ${reason}`);
  }
}

/** First 8 hex characters of the SHA-256 of the bytes. */
function hashOf(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 8);
}

export function loadAssets(dir: string): Assets {
  const table = new Map<string, Asset>();

  const add = (url: string, body: Buffer, type: string, compress: boolean): void => {
    const encodings: Record<string, Buffer> = compress
      ? { br: brotliCompressSync(body), gzip: gzipSync(body, { level: 9 }) }
      : {};
    table.set(url, { body, type, encodings });
  };

  // Fonts first: the stylesheet names their final URLs, so its hash depends on theirs.
  const geist = readSource(dir, "fonts/geist-latin-wght.woff2");
  const serif = readSource(dir, "fonts/instrument-serif-latin-400.woff2");
  const geistUrl = `/assets/fonts/geist-latin-wght.${hashOf(geist)}.woff2`;
  const serifUrl = `/assets/fonts/instrument-serif-latin-400.${hashOf(serif)}.woff2`;
  add(geistUrl, geist, "font/woff2", false);
  add(serifUrl, serif, "font/woff2", false);

  const cssText = readSource(dir, "site.css")
    .toString("utf8")
    .replaceAll(GEIST_TOKEN, geistUrl)
    .replaceAll(SERIF_TOKEN, serifUrl);
  const css = Buffer.from(cssText, "utf8");
  const cssUrl = `/assets/site.${hashOf(css)}.css`;
  add(cssUrl, css, "text/css; charset=utf-8", true);

  const js = readSource(dir, "scrub.js");
  const jsUrl = `/assets/scrub.${hashOf(js)}.js`;
  add(jsUrl, js, "text/javascript; charset=utf-8", true);

  return {
    urls: { css: cssUrl, js: jsUrl, geist: geistUrl, serif: serifUrl },
    lookup: (pathname) => table.get(pathname),
  };
}
