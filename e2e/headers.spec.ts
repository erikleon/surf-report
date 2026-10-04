import { spawn } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { urlFor, type Scenario } from "./scenarios";

// These tests talk to the servers directly, so one project is enough.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "no browser needed");
});

const PAGE_CACHE = "public, max-age=0, s-maxage=120, no-transform";

async function get(request: APIRequestContext, scenario: Scenario, path: string) {
  return request.get(`${urlFor(scenario)}${path}`, { maxRedirects: 0 });
}

test("ok: pages are cacheable at the edge for two minutes", async ({ request }) => {
  for (const path of ["/", "/week", "/about"]) {
    const res = await get(request, "ok", path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"], path).toBe(PAGE_CACHE);
  }
});

test("partial: a page built from incomplete data is not cacheable", async ({ request }) => {
  const res = await get(request, "partial", "/");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store, no-transform");
});

test("down: the unavailable page answers 503 and is not cached", async ({ request }) => {
  const res = await get(request, "down", "/");
  expect(res.status()).toBe(503);
  expect(res.headers()["cache-control"]).toBe("no-store, no-transform");
  expect(await res.text()).toContain("Forecast unavailable");
});

test("hang: the first page is not cacheable", async ({ request }) => {
  const res = await get(request, "hang", "/");
  expect(res.headers()["cache-control"]).toBe("no-store, no-transform");
});

// The start waits at most 10 seconds for the first upstream data, so a server
// whose upstreams hang is ready a little after 10 seconds: 10.2 s measured on
// an idle machine. The limit is 15 s because this runs beside browsers drawing
// WebGL in software, which slows a spawn by a few seconds. It still catches a
// start that blocks well past the data wait.
test("hang: a fresh server is ready within 15 seconds", async ({ request }) => {
  const started = Date.now();
  const child = spawn("node", ["e2e/serve.mjs"], {
    env: { ...process.env, SCENARIO: "hang", PORT: "4155", CONTROL_PORT: "4255" },
    stdio: "ignore",
  });
  try {
    let ready = false;
    while (Date.now() - started < 20_000 && !ready) {
      try {
        ready = (await request.get("http://127.0.0.1:4155/healthz", { timeout: 1000 })).ok();
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const took = Date.now() - started;
    console.log(`hang scenario ready after ${took} ms`);
    expect(ready).toBe(true);
    expect(took).toBeLessThan(15_000);
    const res = await request.get("http://127.0.0.1:4155/", { maxRedirects: 0 });
    expect(res.headers()["cache-control"]).toBe("no-store, no-transform");
  } finally {
    child.kill("SIGTERM");
  }
});

test("no response from any scenario sets a cookie", async ({ request }) => {
  const scenarios: Scenario[] = ["ok", "nulls", "partial", "down", "hang"];
  for (const scenario of scenarios) {
    const home = await get(request, scenario, "/");
    const css = home.ok() || home.status() === 503 ? await home.text() : "";
    const asset = /href="(\/assets\/site\.[0-9a-f]+\.css)"/.exec(css)?.[1];
    const paths = ["/", "/week", "/about", "/nope", "/week/", "/healthz", ...(asset ? [asset] : [])];
    for (const path of paths) {
      const res = await get(request, scenario, path);
      expect(res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie"), `${scenario} ${path}`).toEqual([]);
    }
  }
});

test.describe("unknown paths", () => {
  test("a missing page is 404 and not cached", async ({ request }) => {
    const res = await get(request, "ok", "/nope");
    expect(res.status()).toBe(404);
    expect(res.headers()["cache-control"]).toBe("no-store, no-transform");
  });

  test("a trailing slash or a query string redirects to the plain path", async ({ request }) => {
    const slash = await get(request, "ok", "/week/");
    expect(slash.status()).toBe(301);
    expect(slash.headers()["location"]).toBe("/week");
    const query = await get(request, "ok", "/?x=1");
    expect(query.status()).toBe(301);
    expect(query.headers()["location"]).toBe("/");
  });
});
