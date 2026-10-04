import { describe, expect, it } from "vitest";
import { getJson } from "../../src/upstream/http.js";
import { failingFetch, fakeFetch, hangingFetch } from "./fakeFetch.js";

const URL_A = "https://example.test/a";

describe("getJson", () => {
  it("returns the parsed body on a 200", async () => {
    const fetchImpl = fakeFetch({ [URL_A]: { file: "tides-empty.json" } });
    expect(await getJson(URL_A, fetchImpl)).toEqual({ ok: true, value: { predictions: [] } });
  });

  it.each([429, 500])("reports HTTP %i", async (status) => {
    const fetchImpl = fakeFetch({ [URL_A]: { file: "marine.json", status } });
    expect(await getJson(URL_A, fetchImpl)).toEqual({ ok: false, reason: `HTTP ${status}` });
  });

  it("reports a body that is not JSON", async () => {
    const fetchImpl = fakeFetch({ [URL_A]: { file: "not-json.html" } });
    const result = await getJson(URL_A, fetchImpl);
    expect(result).toEqual({ ok: false, reason: "response was not valid JSON" });
  });

  it("reports a network error without throwing", async () => {
    const result = await getJson(URL_A, failingFetch);
    expect(result).toEqual({ ok: false, reason: "network error: fetch failed" });
  });

  it("gives up on a fetch that never answers", async () => {
    const result = await getJson(URL_A, hangingFetch, 50);
    expect(result).toEqual({ ok: false, reason: "timed out after 50 ms" });
  });
});
