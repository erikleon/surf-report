// Entry point: read the settings, load the static files, fill the cache, then listen.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssets } from "./assets.js";
import { createCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import type { FetchFn } from "./types.js";
import { attachVerdictLog, createVerdictLog } from "./verdictLog.js";

export interface StartOptions {
  env: Record<string, string | undefined>;
  /** Folder holding site.css, scrub.js and fonts/. */
  assetsDir: string;
  /** Folder holding the map GeoJSON files. Defaults to `../data/map` beside `assetsDir`. */
  mapDataDir?: string;
  /** Epoch milliseconds. */
  now?: () => number;
  fetchImpl?: FetchFn;
  log?: (line: string) => void;
}

export interface Running {
  server: Server;
  port: number;
  /** Stops the cache timers, then closes the server. */
  stop(): Promise<void>;
}

/** The assets folder sits next to dist/, found from this file and not from the working directory. */
export function defaultAssetsDir(): string {
  return fileURLToPath(new URL("../assets/", import.meta.url));
}

export async function startServer(opts: StartOptions): Promise<Running> {
  const log = opts.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const now = opts.now ?? Date.now;
  const config = loadConfig(opts.env);

  const cache = createCache({ now, log, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
  attachVerdictLog(cache, createVerdictLog({ dir: config.verdictLogDir, now, log }), log);

  // The first fetches start before the assets are read and compressed, so
  // that CPU work overlaps the network wait instead of adding to it. With the
  // map files it takes most of a second, and the health check allows about 12.
  const started = cache.start();

  // A missing map file turns the map off with one log line; a missing core file stops the start.
  let assets: ReturnType<typeof loadAssets>;
  try {
    assets = loadAssets(opts.assetsDir, { log, ...(opts.mapDataDir ? { mapDataDir: opts.mapDataDir } : {}) });
  } catch (err) {
    cache.stop();
    throw err;
  }

  // The server does not listen until the first fetches finish or time out,
  // so the first visitor does not get a loading page. Once this resolves,
  // the app is ready.
  await started;

  const server = createApp({ cache, assets, siteUrl: config.siteUrl, now, isReady: () => true, log });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log(`surf-report listening on ${config.host}:${port}`);


  return {
    server,
    port,
    stop: async () => {
      cache.stop();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      });
    },
  };
}

async function main(): Promise<void> {
  const running = await startServer({ env: process.env, assetsDir: defaultAssetsDir() });

  const shutdown = (signal: string): void => {
    process.stderr.write(`${signal} received, shutting down\n`);
    // A stuck connection must not keep the process alive past this.
    setTimeout(() => process.exit(1), 5000).unref();
    running.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        process.stderr.write(`shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Run only when started as the program, so tests can import startServer.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
