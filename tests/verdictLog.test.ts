import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CacheSnapshot, RefreshCallback } from "../src/cache.js";
import { parseForecast } from "../src/upstream/forecast.js";
import { parseMarine } from "../src/upstream/marine.js";
import { attachVerdictLog, createVerdictLog } from "../src/verdictLog.js";
import { fixture } from "./upstream/fakeFetch.js";

function load<T>(parse: (b: unknown) => { ok: boolean; value?: T }, file: string): T {
  const r = parse(JSON.parse(fixture(file)));
  if (!r.ok || r.value === undefined) throw new Error(`bad fixture ${file}`);
  return r.value;
}
const marine = load(parseMarine, "marine.json");
const forecast = load(parseForecast, "forecast.json");

function snapshotAt(at: number): CacheSnapshot {
  return { marine: { value: marine, fetchedAt: at }, forecast: { value: forecast, fetchedAt: at }, tides: {} };
}

const NOON = Date.UTC(2026, 9, 3, 16, 0); // 12:00 in New York
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "verdict-log-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lines(file: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(dir, file), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("verdict log", () => {
  it("writes one line per recorded verdict with the expected fields", async () => {
    const log = createVerdictLog({ dir, now: () => NOON });
    await log.record(snapshotAt(NOON));
    await log.record(snapshotAt(NOON));
    const rows = await lines("verdicts-2026-10.jsonl");
    expect(rows).toHaveLength(2);
    const row = rows[0] as Record<string, unknown>;
    expect(row["at"]).toBe("2026-10-03T16:00:00.000Z");
    expect(row["nyStamp"]).toBe("2026-10-03T12:00");
    expect(row["callState"]).toBe("ok");
    expect(typeof row["word"]).toBe("string");
    expect(typeof row["stars"]).toBe("number");
    expect(typeof row["why"]).toBe("string");
    expect(typeof row["bestHour"]).toBe("string");
    const inputs = row["inputs"] as Record<string, unknown>;
    expect(Object.keys(inputs).sort()).toEqual(["waveHeight", "wavePeriod", "windDirection", "windSpeed"]);
  });

  it("creates the directory when it is missing", async () => {
    const nested = join(dir, "a", "b");
    const log = createVerdictLog({ dir: nested, now: () => NOON });
    await log.record(snapshotAt(NOON));
    expect(await readdir(nested)).toEqual(["verdicts-2026-10.jsonl"]);
  });

  it("rotates at the New York month boundary", async () => {
    // 2026-10-31 23:59 EDT is 03:59Z on Nov 1; 2026-11-01 00:01 EDT is 04:01Z.
    const before = Date.UTC(2026, 10, 1, 3, 59);
    const after = Date.UTC(2026, 10, 1, 4, 1);
    await createVerdictLog({ dir, now: () => before }).record(snapshotAt(before));
    await createVerdictLog({ dir, now: () => after }).record(snapshotAt(after));
    expect((await readdir(dir)).sort()).toEqual(["verdicts-2026-10.jsonl", "verdicts-2026-11.jsonl"]);
    expect((await lines("verdicts-2026-10.jsonl"))[0]?.["nyStamp"]).toBe("2026-10-31T23:59");
    expect((await lines("verdicts-2026-11.jsonl"))[0]?.["nyStamp"]).toBe("2026-11-01T00:01");
  });

  it("writes nothing without a verdict", async () => {
    const log = createVerdictLog({ dir, now: () => NOON });
    await log.record({ marine: {}, forecast: {}, tides: {} });
    await log.record(snapshotAt(NOON - 3 * 3_600_000));
    expect(await readdir(dir)).toEqual([]);
  });

  it("logs one error line and does not throw when the path is unwritable", async () => {
    const blocker = join(dir, "file");
    await writeFile(blocker, "x");
    const logged: string[] = [];
    const log = createVerdictLog({ dir: join(blocker, "sub"), now: () => NOON, log: (l) => logged.push(l) });
    await expect(log.record(snapshotAt(NOON))).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(join(blocker, "sub", "verdicts-2026-10.jsonl"));
  });

  it("logs one line when the append itself fails", async () => {
    const logged: string[] = [];
    const log = createVerdictLog({
      dir,
      now: () => NOON,
      appendFile: async () => {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      },
      log: (l) => logged.push(l),
    });
    await log.record(snapshotAt(NOON));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("no space left on device");
  });

  it("rethrows an error that is not a filesystem error", async () => {
    const log = createVerdictLog({
      dir,
      now: () => NOON,
      appendFile: async () => {
        throw new TypeError("bug");
      },
      log: () => undefined,
    });
    await expect(log.record(snapshotAt(NOON))).rejects.toThrow("bug");
  });
});

describe("attachVerdictLog", () => {
  function fakeCache() {
    let hook: RefreshCallback | undefined;
    const snap = snapshotAt(NOON);
    return {
      snapshot: () => snap,
      setOnRefresh: (cb: RefreshCallback | undefined) => {
        hook = cb;
      },
      fire: (name: "marine" | "forecast" | "tides", ok: boolean) =>
        hook?.(name, ok ? { ok: true, value: {} } : { ok: false, reason: "down" }),
    };
  }

  it("records on a successful marine refresh only", () => {
    const recorded: CacheSnapshot[] = [];
    const cache = fakeCache();
    attachVerdictLog(cache, { record: async (s) => void recorded.push(s) });
    cache.fire("forecast", true);
    cache.fire("tides", true);
    cache.fire("marine", false);
    expect(recorded).toHaveLength(0);
    cache.fire("marine", true);
    expect(recorded).toEqual([cache.snapshot()]);
  });
});
