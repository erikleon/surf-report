// Test server for the browser suite. Runs the real app from dist/ with the
// real assets folder, a fake upstream that serves the saved fixtures, and a
// clock the tests can move forward through a second small listener.
//
// Env: PORT, CONTROL_PORT, SCENARIO (ok, nulls, partial, down, hang).

import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../dist/index.js";

const fixtureDir = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
const fixture = (name) => readFileSync(`${fixtureDir}${name}`, "utf8");

const scenario = process.env.SCENARIO ?? "ok";
const port = Number(process.env.PORT ?? 0);
const controlPort = Number(process.env.CONTROL_PORT ?? 0);

// 14:00 UTC is 10:00 in New York on 2026-10-03. The nulls fixture only has
// missing hours early on 3 October, so that scenario starts at 01:00 New York
// time to put them inside the 48 hour window.
const BASE_MS = Date.parse(scenario === "nulls" ? "2026-10-03T05:00:00Z" : "2026-10-03T14:00:00Z");
let offsetMs = 0;
const now = () => BASE_MS + offsetMs;

/** Which upstream a URL belongs to. */
function upstreamOf(url) {
  const host = new URL(url).hostname;
  if (host === "marine-api.open-meteo.com") return "marine";
  if (host === "api.open-meteo.com") return "forecast";
  if (host === "api.tidesandcurrents.noaa.gov") return "tides";
  throw new Error(`no fixture for ${url}`);
}

function respond(name, status = 200) {
  return new Response(name === undefined ? "" : fixture(name), { status });
}

const fetchImpl = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const which = upstreamOf(url);
  if (scenario === "hang") {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }
  if (scenario === "down") return Promise.resolve(respond(undefined, 500));
  if (scenario === "partial" && which === "tides") return Promise.resolve(respond(undefined, 500));
  const files = {
    marine: scenario === "nulls" ? "marine-nulls.json" : "marine.json",
    forecast: "forecast.json",
    tides: "tides.json",
  };
  return Promise.resolve(respond(files[which]));
};

// The control listener goes up first: it also keeps the process alive while a
// hanging upstream leaves nothing else holding the event loop.
const control = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://control");
  if (req.method === "POST" && url.pathname === "/advance") {
    offsetMs += Number(url.searchParams.get("minutes") ?? 0) * 60_000;
  } else if (req.method === "POST" && url.pathname === "/reset") {
    offsetMs = 0;
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ offsetMs }));
});
await new Promise((resolve) => control.listen(controlPort, "127.0.0.1", resolve));

const running = await startServer({
  env: {
    PORT: String(port),
    HOST: "127.0.0.1",
    SITE_URL: `http://127.0.0.1:${port}`,
    // Keep the verdict log out of the working tree.
    VERDICT_LOG_DIR: mkdtempSync(join(tmpdir(), "surf-e2e-")),
  },
  assetsDir,
  now,
  fetchImpl,
  log: (line) => process.stderr.write(`${line}\n`),
});

process.stdout.write(`e2e server ${scenario} listening on ${running.port}, control ${controlPort}\n`);

const shutdown = () => {
  control.close();
  running.stop().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
