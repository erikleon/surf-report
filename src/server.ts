// The HTTP server: routing, response headers and compression. Pages come from
// the renderers; this file decides status codes and what the edge may cache.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { promisify } from "node:util";
import { WIND_URL, type Asset, type Assets } from "./assets.js";
import type { Cache } from "./cache.js";
import { buildModel, type SiteModel } from "./model.js";
import { toWindJson, windView } from "./windField.js";
import * as defaultPages from "./pages/index.js";
import type { PageContext } from "./pages/index.js";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** The page renderers the server calls. Tests can swap them. */
export interface Pages {
  renderHome(model: SiteModel, ctx: PageContext): string;
  renderWeek(model: SiteModel, ctx: PageContext): string;
  renderAbout(model: SiteModel, ctx: PageContext): string;
  renderMap(model: SiteModel, ctx: PageContext): string;
  /** Undefined when the forecast has no hours on that date. */
  renderDay(model: SiteModel, ctx: PageContext, date: string): string | undefined;
  renderNotFound(ctx: PageContext): string;
  renderUnavailable(ctx: PageContext): string;
}

export interface AppDeps {
  cache: Pick<Cache, "snapshot">;
  assets: Assets;
  siteUrl: string;
  /** Epoch milliseconds. */
  now: () => number;
  isReady: () => boolean;
  pages?: Pages;
  /** Where server errors go. Defaults to stderr. */
  log?: (line: string) => void;
}

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// The map page only. MapLibre starts a same-origin module worker, and its
// raster image decoder falls back to blob: image URLs.
const MAP_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; " +
  "connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Every response carries no-transform. Cloudflare reads it as "do not rewrite
// this": without it, the edge injects its Web Analytics beacon (a third-party
// script the CSP then blocks) and may apply other HTML rewrites, and none of
// that should depend on which dashboard switches happen to be on.
const CACHE_PAGE = "public, max-age=0, s-maxage=120, no-transform";
const CACHE_ASSET = "public, max-age=31536000, immutable, no-transform";
const NO_STORE = "no-store, no-transform";

/** Bodies this size or smaller are sent as they are. */
const COMPRESS_OVER_BYTES = 1024;

const HTML_TYPE = "text/html; charset=utf-8";

type Headers = Record<string, string>;

interface Reply {
  status: number;
  type: string;
  cache: string;
  body: Buffer | string;
  extra?: Headers;
  /** Precompressed bodies, for assets. */
  encodings?: Record<string, Buffer>;
  /** Compress `body` on the fly when the client accepts it. */
  compress?: boolean;
  /** Replaces the site-wide Content-Security-Policy. */
  csp?: string;
}

/** Content codings the client accepts, from Accept-Encoding, with q=0 meaning "not accepted". */
function acceptedCodings(header: string | undefined): Set<string> {
  const accepted = new Set<string>();
  if (header === undefined) return accepted;
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    if (q !== undefined && !(Number(q.slice(2)) > 0)) continue;
    accepted.add(name);
  }
  return accepted;
}

function pickCoding(header: string | undefined, available: readonly string[]): string | undefined {
  const accepted = acceptedCodings(header);
  return available.find((name) => accepted.has(name) || (name === "gzip" && accepted.has("x-gzip")));
}

async function send(req: IncomingMessage, res: ServerResponse, reply: Reply): Promise<void> {
  let body = typeof reply.body === "string" ? Buffer.from(reply.body, "utf8") : reply.body;
  const headers: Headers = {
    "Content-Type": reply.type,
    "Cache-Control": reply.cache,
    "Content-Security-Policy": reply.csp ?? CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...reply.extra,
  };

  const acceptEncoding = req.headers["accept-encoding"];
  if (reply.encodings !== undefined && Object.keys(reply.encodings).length > 0) {
    headers["Vary"] = "Accept-Encoding";
    const coding = pickCoding(acceptEncoding, ["br", "gzip"]);
    const variant = coding === undefined ? undefined : reply.encodings[coding];
    if (coding !== undefined && variant !== undefined) {
      body = variant;
      headers["Content-Encoding"] = coding;
    }
  } else if (reply.compress === true) {
    headers["Vary"] = "Accept-Encoding";
    const coding = body.length > COMPRESS_OVER_BYTES ? pickCoding(acceptEncoding, ["br", "gzip"]) : undefined;
    if (coding === "br") {
      body = await brotliAsync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
      headers["Content-Encoding"] = "br";
    } else if (coding === "gzip") {
      body = await gzipAsync(body);
      headers["Content-Encoding"] = "gzip";
    }
  }

  headers["Content-Length"] = String(body.length);
  res.writeHead(reply.status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | undefined;

/**
 * The one byte range a Range header asks for, inclusive at both ends.
 * Undefined means "send the whole file": no header, another unit, a header
 * that does not parse, or more than one range. Answering a multi-range
 * request with the whole file is allowed and saves building a multipart body.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return undefined;
  const match = /^bytes=[ \t]*(\d*)-(\d*)[ \t]*$/i.exec(header.trim());
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    // A suffix range: the last n bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && Number(last) < start) return undefined;
  if (start >= size) return "unsatisfiable";
  return { start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

function assetReply(req: IncomingMessage, asset: Asset): Reply {
  if (asset.ranges !== true) {
    return { status: 200, type: asset.type, cache: CACHE_ASSET, body: asset.body, encodings: asset.encodings };
  }
  // Never compressed: the reader's byte offsets point into the file as it is on disk.
  const size = asset.body.length;
  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    return {
      status: 416,
      type: "text/plain; charset=utf-8",
      cache: NO_STORE,
      body: "",
      extra: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
    };
  }
  if (range === undefined) {
    return { status: 200, type: asset.type, cache: CACHE_ASSET, body: asset.body, extra: { "Accept-Ranges": "bytes" } };
  }
  return {
    status: 206,
    type: asset.type,
    cache: CACHE_ASSET,
    body: asset.body.subarray(range.start, range.end + 1),
    extra: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${range.start}-${range.end}/${size}` },
  };
}

function redirect(to: string): Reply {
  return { status: 301, type: "text/plain; charset=utf-8", cache: NO_STORE, body: "", extra: { Location: to } };
}

export function createApp(deps: AppDeps): Server {
  const pages = deps.pages ?? defaultPages;
  const log = deps.log ?? ((line: string) => void process.stderr.write(`${line}\n`));

  const pageRoutes: Record<string, (model: SiteModel, ctx: PageContext) => string | undefined> = {
    "/": (m, c) => pages.renderHome(m, c),
    "/week": (m, c) => pages.renderWeek(m, c),
    "/about": (m, c) => pages.renderAbout(m, c),
    "/map": (m, c) => pages.renderMap(m, c),
  };

  function context(): PageContext {
    return { nowMs: deps.now(), siteUrl: deps.siteUrl, assets: deps.assets.urls };
  }

  function route(req: IncomingMessage): Reply {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return {
        status: 405,
        type: "text/plain; charset=utf-8",
        cache: NO_STORE,
        body: "Method not allowed\n",
        extra: { Allow: "GET, HEAD" },
      };
    }

    // Split by hand: new URL() would resolve a path like "//host" as a host name.
    const target = req.url ?? "/";
    const queryAt = target.indexOf("?");
    const hasQuery = queryAt !== -1;
    const pathname = hasQuery ? target.slice(0, queryAt) : target;

    if (pathname === "/healthz") {
      const ready = deps.isReady();
      return {
        status: ready ? 200 : 503,
        type: "application/json; charset=utf-8",
        cache: NO_STORE,
        body: JSON.stringify({ ok: true, ready }),
      };
    }

    if (pathname.startsWith("/assets/")) {
      const asset = deps.assets.lookup(pathname);
      if (asset === undefined) return notFound();
      return assetReply(req, asset);
    }

    if (pathname === WIND_URL) {
      // A query string would let a client skip the edge cache.
      if (hasQuery) return redirect(WIND_URL);
      const view = windView(deps.cache.snapshot().wind, deps.now());
      return {
        status: 200,
        type: "application/json; charset=utf-8",
        cache: view.state === "fresh" ? CACHE_PAGE : NO_STORE,
        body: toWindJson(view),
        compress: true,
      };
    }

    // A page URL with a trailing slash or a query string is sent to the plain
    // path, so cache-busting URLs cannot get around the edge cache.
    const plain = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    const dayDate = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(plain)?.[1];
    const render =
      dayDate !== undefined
        ? (m: SiteModel, c: PageContext) => pages.renderDay(m, c, dayDate)
        : Object.hasOwn(pageRoutes, plain)
          ? pageRoutes[plain]
          : undefined;
    if (render === undefined) return notFound();
    if (plain !== pathname || hasQuery) return redirect(plain);

    const ctx = context();
    // The forecast pages never depend on the map files; only /map does.
    if (plain === "/map" && ctx.assets.map === undefined) return unavailable(ctx);
    const model = buildModel(deps.cache.snapshot(), ctx.nowMs);
    if (model.marineState === "missing" && model.forecastState === "missing" && model.tideState === "missing") {
      return unavailable(ctx);
    }
    const body = render(model, ctx);
    if (body === undefined) return notFound();
    return {
      status: 200,
      type: HTML_TYPE,
      cache: model.cacheable ? CACHE_PAGE : NO_STORE,
      body,
      compress: true,
      // The day page carries the map when the map files exist.
      ...(plain === "/map" || (dayDate !== undefined && ctx.assets.map !== undefined) ? { csp: MAP_CSP } : {}),
    };
  }

  function unavailable(ctx: PageContext): Reply {
    return {
      status: 503,
      type: HTML_TYPE,
      cache: NO_STORE,
      body: pages.renderUnavailable(ctx),
      extra: { "Retry-After": "30" },
      compress: true,
    };
  }

  function notFound(): Reply {
    return { status: 404, type: HTML_TYPE, cache: NO_STORE, body: pages.renderNotFound(context()), compress: true };
  }

  return createServer((req, res) => {
    void (async () => {
      try {
        await send(req, res, route(req));
      } catch (err) {
        // The client gets a plain page; the detail stays in the log.
        const message = err instanceof Error ? err.message : String(err);
        log(`[server] ${req.method ?? "?"} ${req.url ?? "?"} failed: ${message}`);
        if (res.headersSent) {
          res.destroy();
          return;
        }
        try {
          await send(req, res, {
            status: 500,
            type: "text/plain; charset=utf-8",
            cache: NO_STORE,
            body: "Something went wrong\n",
          });
        } catch (sendErr) {
          log(`[server] could not send the 500 response: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
          res.destroy();
        }
      }
    })();
  });
}
