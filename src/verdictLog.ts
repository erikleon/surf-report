// An append-only record of each verdict, one JSON line per marine refresh.
// It is the data for tuning the rules later. A failed write never reaches the page.

import { appendFile as fsAppendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Cache, CacheSnapshot } from "./cache.js";
import { buildModel } from "./model.js";
import { nyDate, nyMinuteStamp } from "./time.js";

export interface VerdictLogOptions {
  dir: string;
  /** Epoch ms. */
  now: () => number;
  appendFile?: (path: string, data: string) => Promise<void>;
  log?: (line: string) => void;
}

export interface VerdictLog {
  record(snapshot: CacheSnapshot): Promise<void>;
}

export function createVerdictLog(opts: VerdictLogOptions): VerdictLog {
  const appendFile = opts.appendFile ?? ((path, data) => fsAppendFile(path, data, "utf8"));
  const log = opts.log ?? ((line: string) => void process.stderr.write(`${line}\n`));

  async function record(snapshot: CacheSnapshot): Promise<void> {
    const nowMs = opts.now();
    const model = buildModel(snapshot, nowMs);
    const verdict = model.verdict;
    if (verdict === undefined) return;

    const best = model.hours.find((h) => h.time === verdict.bestHour);
    const line = {
      at: new Date(nowMs).toISOString(),
      nyStamp: nyMinuteStamp(nowMs),
      callState: model.callState,
      word: verdict.word,
      stars: verdict.stars,
      why: verdict.why,
      bestHour: verdict.bestHour,
      inputs:
        best?.kind === "data"
          ? {
              waveHeight: best.waveHeight,
              wavePeriod: best.wavePeriod,
              windSpeed: best.windSpeed,
              windDirection: best.windDirection,
            }
          : undefined,
    };

    // The month is the New York month, so the file changes at New York midnight.
    const path = join(opts.dir, `verdicts-${nyDate(nowMs).slice(0, 7)}.jsonl`);
    try {
      await mkdir(opts.dir, { recursive: true });
      await appendFile(path, `${JSON.stringify(line)}\n`);
    } catch (err) {
      // Only filesystem errors are expected here. Anything else is a bug.
      if (!(err instanceof Error) || typeof (err as NodeJS.ErrnoException).code !== "string") throw err;
      log(`[verdict-log] could not write ${path}: ${err.message}`);
    }
  }

  return { record };
}

/** Record a verdict after every successful marine refresh. */
export function attachVerdictLog(cache: Pick<Cache, "snapshot" | "setOnRefresh">, log: VerdictLog): void {
  cache.setOnRefresh((name, result) => {
    if (name === "marine" && result.ok) void log.record(cache.snapshot());
  });
}
