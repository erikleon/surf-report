import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig defaults", () => {
  it("uses the documented defaults for an empty environment", () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      host: "127.0.0.1",
      siteUrl: "https://surf.midwoodrathaus.fyi",
      verdictLogDir: "./data",
    });
  });

  it("treats empty strings as unset", () => {
    expect(loadConfig({ PORT: "", HOST: "", SITE_URL: "", VERDICT_LOG_DIR: "" }).port).toBe(8080);
  });
});

describe("PORT", () => {
  it.each([["1", 1], ["8080", 8080], ["65535", 65535]])("accepts %s", (value, expected) => {
    expect(loadConfig({ PORT: value }).port).toBe(expected);
  });

  it.each(["0", "65536", "-1", "80.5", "abc", "8080x", " 80", "1e3"])("rejects %s and names it", (value) => {
    expect(() => loadConfig({ PORT: value })).toThrow(new RegExp(`PORT.*${value.trim()}`));
  });
});

describe("HOST and VERDICT_LOG_DIR", () => {
  it("passes them through", () => {
    const config = loadConfig({ HOST: "0.0.0.0", VERDICT_LOG_DIR: "/data" });
    expect(config.host).toBe("0.0.0.0");
    expect(config.verdictLogDir).toBe("/data");
  });
});

describe("SITE_URL", () => {
  it("strips a trailing slash", () => {
    expect(loadConfig({ SITE_URL: "https://example.com/" }).siteUrl).toBe("https://example.com");
  });

  it("accepts http and a port", () => {
    expect(loadConfig({ SITE_URL: "http://localhost:3000" }).siteUrl).toBe("http://localhost:3000");
  });

  it.each([
    "not a url",
    "ftp://example.com",
    "javascript:alert(1)",
    "https://example.com/surf",
    "https://example.com/?a=1",
    "https://example.com/#top",
    "https://user:pw@example.com",
  ])("rejects %s and names the variable and value", (value) => {
    expect(() => loadConfig({ SITE_URL: value })).toThrow(/SITE_URL/);
    expect(() => loadConfig({ SITE_URL: value })).toThrow(JSON.stringify(value).slice(1, -1));
  });
});
