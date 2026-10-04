// Nightly check that the four live upstreams still answer in the shape our
// parsers expect. It makes real network requests, so it runs from its own
// workflow and never from the normal test run.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchFn } from "./types.js";
import { fetchForecast } from "./upstream/forecast.js";
import { fetchMarine } from "./upstream/marine.js";
import { fetchTides } from "./upstream/tides.js";
import { fetchWindGrid } from "./upstream/windGrid.js";
import { nyStamp, tideDateRange } from "./time.js";

const MIN_HOURS = 100;
const MIN_DAYS = 5;
/** The wind grid asks for two days; one full day is the floor for the map. */
const MIN_WIND_HOURS = 24;
const WIND_POINTS = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface ContractFact {
  label: string;
  ok: boolean;
}

export interface ContractLine {
  upstream: "marine" | "forecast" | "tides" | "wind";
  /** True when the fetch and parse worked and every fact holds. */
  ok: boolean;
  /** Why the fetch or parse failed. Absent when it worked. */
  reason?: string;
  facts: ContractFact[];
}

export interface ContractReport {
  ok: boolean;
  lines: ContractLine[];
}

function failed(upstream: ContractLine["upstream"], reason: string): ContractLine {
  return { upstream, ok: false, reason, facts: [] };
}

function withFacts(upstream: ContractLine["upstream"], facts: ContractFact[]): ContractLine {
  return { upstream, ok: facts.every((f) => f.ok), facts };
}

/**
 * Fetch each upstream once and check it. A failed fetch becomes a failed line
 * with the fetcher's reason, so the report always has one line per upstream.
 */
export async function runContractCheck(
  fetchImpl: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<ContractReport> {
  // Today plus six days, to match the seven-day forecast windows.
  const range = tideDateRange(nowMs, 6);
  const [marine, forecast, tides, wind] = await Promise.all([
    fetchMarine(fetchImpl),
    fetchForecast(fetchImpl),
    fetchTides(range, fetchImpl),
    fetchWindGrid(fetchImpl),
  ]);

  // Stamps are New York wall time and compare as strings, so "within one day
  // of now" is a string range built from the instants a day either side.
  const earliest = nyStamp(nowMs - ONE_DAY_MS);
  const latest = nyStamp(nowMs + ONE_DAY_MS);

  const lines: ContractLine[] = [];

  if (!marine.ok) {
    lines.push(failed("marine", marine.reason));
  } else {
    const count = marine.value.time.length;
    const first = marine.value.time[0] ?? "";
    lines.push(
      withFacts("marine", [
        { label: `${count} hours (need ${MIN_HOURS}+)`, ok: count >= MIN_HOURS },
        { label: `first hour ${first} is within one day of now`, ok: first >= earliest && first <= latest },
      ]),
    );
  }

  if (!forecast.ok) {
    lines.push(failed("forecast", forecast.reason));
  } else {
    const count = forecast.value.time.length;
    const pairs = Math.min(forecast.value.sunrise.length, forecast.value.sunset.length);
    lines.push(
      withFacts("forecast", [
        { label: `${count} hours (need ${MIN_HOURS}+)`, ok: count >= MIN_HOURS },
        { label: `${pairs} sunrise and sunset pairs (need ${MIN_DAYS}+)`, ok: pairs >= MIN_DAYS },
      ]),
    );
  }

  if (!tides.ok) {
    lines.push(failed("tides", tides.reason));
  } else {
    const count = tides.value.time.length;
    lines.push(withFacts("tides", [{ label: `${count} hourly rows (need ${MIN_HOURS}+)`, ok: count >= MIN_HOURS }]));
  }

  if (!wind.ok) {
    lines.push(failed("wind", wind.reason));
  } else {
    // Hours with a missing value anywhere are already dropped, so this counts complete hours.
    const count = wind.value.times.length;
    const first = wind.value.speed[0] ?? [];
    const points = first.reduce((sum, row) => sum + row.length, 0);
    lines.push(
      withFacts("wind", [
        { label: `${count} complete hours (need ${MIN_WIND_HOURS}+)`, ok: count >= MIN_WIND_HOURS },
        { label: `${points} grid points (need ${WIND_POINTS})`, ok: points === WIND_POINTS },
      ]),
    );
  }

  return { ok: lines.every((l) => l.ok), lines };
}

/** The report as plain text: one line per upstream, then one per fact. */
export function formatReport(report: ContractReport): string[] {
  const out: string[] = [];
  for (const line of report.lines) {
    if (line.reason !== undefined) {
      out.push(`${line.upstream}: FAIL ${line.reason}`);
      continue;
    }
    out.push(`${line.upstream}: ${line.ok ? "ok" : "FAIL"}`);
    for (const fact of line.facts) {
      out.push(`  ${fact.ok ? "ok  " : "FAIL"} ${fact.label}`);
    }
  }
  out.push(report.ok ? "contract check passed" : "contract check failed");
  return out;
}

/** Run the check, print the report, and return the process exit code. */
export async function main(): Promise<number> {
  const report = await runContractCheck();
  console.log(formatReport(report).join("\n"));
  return report.ok ? 0 : 1;
}

// Run only when started as a script, not when a test imports the module.
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
