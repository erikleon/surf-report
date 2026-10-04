import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadAssets, type Assets } from "../src/assets.js";
import { createCache, type CacheSnapshot } from "../src/cache.js";
import { startServer } from "../src/index.js";
import { tideDateRange } from "../src/time.js";
import { buildForecastUrl } from "../src/upstream/forecast.js";
import { buildMarineUrl } from "../src/upstream/marine.js";
import { buildTidesUrl } from "../src/upstream/tides.js";
import { createApp, type Pages } from "../src/server.js";
import { fakeFetch } from "./upstream/fakeFetch.js";

const NOW = Date.UTC(2026, 9, 3, 14, 0);
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const goodRoutes = {
  [buildMarineUrl()]: { file: "marine.json" },
  [buildForecastUrl()]: { file: "forecast.json" },
  [buildTidesUrl(tideDateRange(NOW, 6))]: { file: "tides.json" },
};

async function freshSnapshot(): Promise<CacheSnapshot> {
  const cache = createCache({ fetchImpl: fakeFetch(goodRoutes), now: () => NOW, log: () => undefined });
  for (const name of ["marine", "forecast", "tides"] as const) await cache.refresh(name);
  return cache.snapshot();
}

const emptySnapshot = (): CacheSnapshot => ({ marine: {}, forecast: {}, tides: {} });

// ---- temp assets ----

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeAssetDir(css = "a{src:url(__FONT_GEIST__)}"): string {
  const dir = mkdtempSync(join(tmpdir(), "surf-server-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "fonts"));
  writeFileSync(join(dir, "site.css"), css);
  writeFileSync(join(dir, "scrub.js"), "console.log(1);");
  writeFileSync(join(dir, "fonts/geist-latin-wght.woff2"), "geist");
  writeFileSync(join(dir, "fonts/instrument-serif-latin-400.woff2"), "serif");
  return dir;
}

// ---- running servers ----

const open: Server[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

let assets: Assets;
beforeAll(() => {
  assets = loadAssets(makeAssetDir("@font-face{src:url(__FONT_GEIST__)}body{color:#000}".repeat(80)));
});

interface Options {
  snapshot?: CacheSnapshot;
  now?: number;
  ready?: () => boolean;
  pages?: Pages;
  log?: (line: string) => void;
}

async function serve(opts: Options = {}): Promise<string> {
  const snapshot = opts.snapshot ?? (await freshSnapshot());
  const server = createApp({
    cache: { snapshot: () => snapshot },
    assets,
    siteUrl: "https://surf.example",
    now: () => opts.now ?? NOW,
    isReady: opts.ready ?? (() => true),
    log: opts.log ?? (() => undefined),
    ...(opts.pages ? { pages: opts.pages } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  open.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

interface Raw {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A request that leaves the body compressed, so the tests can see the real bytes. */
function raw(base: string, path: string, init: { method?: string; encoding?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    // Pass the path as written: a URL string would collapse "/assets/../x" before sending.
    const { port } = new URL(base);
    const req = request(
      { host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: init.encoding === undefined ? {} : { "Accept-Encoding": init.encoding } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const get = (base: string, path: string) => fetch(base + path, { redirect: "manual" });

const bigPages = (size: number): Pages => {
  const html = `<!doctype html><p>${"surf ".repeat(size)}</p>`;
  return {
    renderHome: () => html,
    renderWeek: () => html,
    renderAbout: () => html,
    renderNotFound: () => html,
    renderUnavailable: () => html,
  };
};

// ---- routes ----

describe("routes", () => {
  it.each([
    ["/", "Rockaway"],
    ["/week", "Week"],
    ["/about", "About"],
  ])("serves %s with its page", async (path, heading) => {
    const base = await serve();
    const res = await get(base, path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain(heading);
  });

  it("passes the model, the site URL and the hashed asset URLs to the renderer", async () => {
    const seen: unknown[] = [];
    const pages: Pages = {
      ...bigPages(1),
      renderHome: (model, ctx) => {
        seen.push(model.callState, ctx);
        return "<p>home</p>";
      },
    };
    const base = await serve({ pages });
    await get(base, "/");
    expect(seen[0]).toBe("ok");
    expect(seen[1]).toEqual({ nowMs: NOW, siteUrl: "https://surf.example", assets: assets.urls });
  });

  it("answers an unknown path with the 404 page", async () => {
    const base = await serve();
    const res = await get(base, "/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not treat inherited object keys as pages", async () => {
    const base = await serve();
    for (const path of ["/constructor", "/__proto__", "/toString"]) {
      expect((await get(base, path)).status).toBe(404);
    }
  });

  it("serves a double-slash path as a plain 404, not as a host", async () => {
    const base = await serve();
    expect((await get(base, "//evil.example/week")).status).toBe(404);
  });

  it("answers an unknown asset URL with 404", async () => {
    const base = await serve();
    expect((await get(base, "/assets/site.00000000.css")).status).toBe(404);
  });
});

describe("healthz", () => {
  it("is 503 then 200 as readiness flips", async () => {
    let ready = false;
    const base = await serve({ ready: () => ready });
    const before = await get(base, "/healthz");
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({ ok: true, ready: false });
    ready = true;
    const after = await get(base, "/healthz");
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ ok: true, ready: true });
    expect(after.headers.get("cache-control")).toBe("no-store");
  });
});

describe("methods", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("rejects %s with 405 and Allow", async (method) => {
    const base = await serve();
    const res = await fetch(`${base}/`, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const base = await serve();
    const getRes = await raw(base, "/week");
    const head = await raw(base, "/week", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers["content-length"]).toBe(String(getRes.body.length));
    expect(head.headers["cache-control"]).toBe(getRes.headers["cache-control"]);
    expect(head.headers["content-security-policy"]).toBe(CSP);
  });

  it("answers HEAD for an asset with its length and no body", async () => {
    const base = await serve();
    const head = await raw(base, assets.urls.js, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);
  });
});

describe("redirects", () => {
  it.each([
    ["/week/", "/week"],
    ["/about/", "/about"],
    ["/?x=1", "/"],
    ["/week?cb=123", "/week"],
    ["/about/?a=1&b=2", "/about"],
  ])("sends %s to %s with a 301", async (from, to) => {
    const base = await serve();
    const res = await get(base, from);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(to);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not redirect other paths, which are plain 404s", async () => {
    const base = await serve();
    expect((await get(base, "/nope/")).status).toBe(404);
    expect((await get(base, "/nope?x=1")).status).toBe(404);
    expect((await get(base, "/healthz?x=1")).status).toBe(200);
  });

  it("ignores the query on assets", async () => {
    const base = await serve();
    expect((await get(base, `${assets.urls.css}?v=2`)).status).toBe(200);
  });
});

describe("unavailable", () => {
  it("answers 503 with Retry-After when no upstream has ever loaded", async () => {
    const base = await serve({ snapshot: emptySnapshot() });
    for (const path of ["/", "/week", "/about"]) {
      const res = await get(base, path);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toContain("Forecast unavailable");
    }
  });

  it("still serves a page when only one upstream has loaded", async () => {
    const snapshot = await freshSnapshot();
    const base = await serve({ snapshot: { ...emptySnapshot(), tides: snapshot.tides } });
    const res = await get(base, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ---- headers ----

describe("headers", () => {
  const paths = ["/", "/week", "/about", "/nope", "/healthz", "/week/", "/?x=1"];

  it.each(paths)("sends the security headers and no cookie on %s", async (path) => {
    const base = await serve();
    const res = await get(base, path);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.has("set-cookie")).toBe(false);
  });

  it("sends the same headers on assets, the 405, the 503 and the 500", async () => {
    const throwing: Pages = {
      ...bigPages(1),
      renderHome: () => {
        throw new Error("boom");
      },
    };
    const okBase = await serve();
    const emptyBase = await serve({ snapshot: emptySnapshot() });
    const errBase = await serve({ pages: throwing });
    const responses = [
      await get(okBase, assets.urls.css),
      await get(okBase, assets.urls.geist),
      await fetch(`${okBase}/`, { method: "POST" }),
      await get(emptyBase, "/"),
      await get(errBase, "/"),
    ];
    for (const res of responses) {
      expect(res.headers.get("content-security-policy")).toBe(CSP);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.has("set-cookie")).toBe(false);
    }
  });
});

describe("Cache-Control", () => {
  it.each(["/", "/week", "/about"])("lets the edge keep a complete fresh %s", async (path) => {
    const base = await serve();
    const res = await get(base, path);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=120");
  });

  it("sends no-store when tides are missing", async () => {
    const snapshot = await freshSnapshot();
    const base = await serve({ snapshot: { ...snapshot, tides: {} } });
    for (const path of ["/", "/week", "/about"]) {
      const res = await get(base, path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("sends no-store when the call is stale", async () => {
    const base = await serve({ now: NOW + 3 * 3_600_000 });
    const res = await get(base, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends no-store for the 404 and healthz", async () => {
    const base = await serve();
    expect((await get(base, "/nope")).headers.get("cache-control")).toBe("no-store");
    expect((await get(base, "/healthz")).headers.get("cache-control")).toBe("no-store");
  });

  it("gives assets a one-year immutable policy", async () => {
    const base = await serve();
    for (const url of Object.values(assets.urls)) {
      const res = await get(base, url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    }
  });
});

// ---- assets ----

describe("assets", () => {
  it("serves each asset with its type", async () => {
    const base = await serve();
    expect((await get(base, assets.urls.css)).headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect((await get(base, assets.urls.js)).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect((await get(base, assets.urls.geist)).headers.get("content-type")).toBe("font/woff2");
    expect(await (await get(base, assets.urls.serif)).text()).toBe("serif");
  });

  it("sends the precompressed variant the client prefers", async () => {
    const base = await serve();
    const source = assets.lookup(assets.urls.css)!.body;

    const br = await raw(base, assets.urls.css, { encoding: "gzip, br" });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["vary"]).toBe("Accept-Encoding");
    expect(brotliDecompressSync(br.body)).toEqual(source);
    expect(br.headers["content-length"]).toBe(String(br.body.length));

    const gz = await raw(base, assets.urls.css, { encoding: "gzip" });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.body)).toEqual(source);

    const plain = await raw(base, assets.urls.css, { encoding: "identity" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body).toEqual(source);

    const none = await raw(base, assets.urls.css);
    expect(none.headers["content-encoding"]).toBeUndefined();
  });

  it("does not compress fonts", async () => {
    const base = await serve();
    const res = await raw(base, assets.urls.geist, { encoding: "br, gzip" });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString()).toBe("geist");
  });

  it.each([
    "/assets/../package.json",
    "/assets/%2e%2e/package.json",
    "/assets/..%2fpackage.json",
    "/assets/fonts/../../package.json",
    "/assets//etc/passwd",
    "/assets/",
    "/assets",
  ])("does not serve %s", async (path) => {
    const base = await serve();
    const res = await raw(base, path);
    expect(res.status).toBe(404);
    expect(res.body.toString()).not.toContain("surf-report");
  });
});

// ---- page compression ----

describe("page compression", () => {
  it("compresses a large page with brotli when accepted", async () => {
    const base = await serve({ pages: bigPages(2000) });
    const res = await raw(base, "/", { encoding: "gzip, br" });
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["vary"]).toBe("Accept-Encoding");
    expect(res.headers["content-length"]).toBe(String(res.body.length));
    expect(brotliDecompressSync(res.body).toString()).toContain("surf surf");
  });

  it("falls back to gzip", async () => {
    const base = await serve({ pages: bigPages(2000) });
    const res = await raw(base, "/", { encoding: "gzip" });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.body).toString()).toContain("surf surf");
  });

  it("skips a coding the client refuses with q=0", async () => {
    const base = await serve({ pages: bigPages(2000) });
    const res = await raw(base, "/", { encoding: "br;q=0, gzip" });
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("sends the page plain when the client accepts no coding", async () => {
    const base = await serve({ pages: bigPages(2000) });
    const res = await raw(base, "/");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["vary"]).toBe("Accept-Encoding");
    expect(res.body.toString()).toContain("surf surf");
  });

  it("sends a page of 1 KB or less plain", async () => {
    const base = await serve({ pages: bigPages(10) });
    const res = await raw(base, "/", { encoding: "br, gzip" });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("sets Content-Length on a HEAD of a compressed page to the compressed size", async () => {
    const base = await serve({ pages: bigPages(2000) });
    const getRes = await raw(base, "/", { encoding: "br" });
    const head = await raw(base, "/", { encoding: "br", method: "HEAD" });
    expect(head.headers["content-encoding"]).toBe("br");
    expect(head.headers["content-length"]).toBe(String(getRes.body.length));
    expect(head.body.length).toBe(0);
  });
});

// ---- render errors ----

describe("render errors", () => {
  it("answers 500 with a plain page, no stack, and logs the path and message", async () => {
    const lines: string[] = [];
    const pages: Pages = {
      ...bigPages(1),
      renderWeek: () => {
        throw new Error("template exploded");
      },
    };
    const base = await serve({ pages, log: (l) => lines.push(l) });
    const res = await get(base, "/week");
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(body).not.toMatch(/template exploded|\bat .*\.(ts|js)|Error/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/week");
    expect(lines[0]).toContain("template exploded");
  });

  it("keeps serving after an error", async () => {
    let calls = 0;
    const pages: Pages = {
      ...bigPages(1),
      renderHome: () => {
        if (++calls === 1) throw new Error("once");
        return "<p>ok</p>";
      },
    };
    const base = await serve({ pages });
    expect((await get(base, "/")).status).toBe(500);
    expect((await get(base, "/")).status).toBe(200);
  });

  it("answers 500 when the 404 renderer throws", async () => {
    const pages: Pages = {
      ...bigPages(1),
      renderNotFound: () => {
        throw new Error("no 404 page");
      },
    };
    const base = await serve({ pages });
    expect((await get(base, "/nope")).status).toBe(500);
  });
});

// ---- real startup path ----

describe("startServer", () => {
  async function freePort(): Promise<number> {
    const probe = await serve();
    const port = Number(new URL(probe).port);
    const server = open.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it("loads assets, fills the cache, listens and serves pages", async () => {
    const lines: string[] = [];
    const port = await freePort();
    const running = await startServer({
      env: { PORT: String(port), VERDICT_LOG_DIR: join(makeAssetDir(), "log") },
      assetsDir: makeAssetDir(),
      now: () => NOW,
      fetchImpl: fakeFetch(goodRoutes),
      log: (l) => lines.push(l),
    });
    open.push(running.server);
    expect(running.port).toBe(port);
    expect(lines.some((l) => l.includes(`127.0.0.1:${port}`))).toBe(true);

    const base = `http://127.0.0.1:${port}`;
    const res = await get(base, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=120");
    expect((await get(base, "/healthz")).status).toBe(200);

    await running.stop();
    open.pop();
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });

  it("refuses to start with a bad setting", async () => {
    await expect(
      startServer({ env: { PORT: "70000" }, assetsDir: makeAssetDir(), fetchImpl: fakeFetch(goodRoutes), log: () => undefined }),
    ).rejects.toThrow(/PORT.*70000/);
  });

  it("refuses to start when an asset file is missing", async () => {
    const dir = makeAssetDir();
    rmSync(join(dir, "site.css"));
    await expect(
      startServer({ env: {}, assetsDir: dir, fetchImpl: fakeFetch(goodRoutes), log: () => undefined }),
    ).rejects.toThrow(join(dir, "site.css"));
  });
});
