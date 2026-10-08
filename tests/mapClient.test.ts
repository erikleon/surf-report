import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The browser behaviour is checked in a real browser. These checks guard the
// rules the map client files have to keep under the page's CSP: they parse as
// ES modules, never build code from strings, never write markup from data and
// never name another host.
const files = ["map.js", "wind.js"].map((name) => {
  const url = new URL(`../assets/${name}`, import.meta.url);
  return { name, path: fileURLToPath(url), source: readFileSync(url, "utf8") };
});

describe.each(files)("assets/$name", ({ name, path, source }) => {
  it("parses as an ES module", () => {
    // package.json sets "type": "module", so node checks the file as a module.
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.each(["eval(", "new Function", "document.write", "XMLHttpRequest", "importScripts"])(
    "does not use %s",
    (banned) => {
      expect(source).not.toContain(banned);
    },
  );

  it("does not write markup with innerHTML or insertAdjacentHTML", () => {
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it("has no absolute http or https URL", () => {
    expect(source).not.toMatch(/https?:\/\//i);
  });

  it("does not fetch from another host", () => {
    expect(source).not.toMatch(/fetch\(\s*["'`]\s*(https?:)?\/\//i);
  });

  it("sets no inline handlers or style attributes", () => {
    expect(source).not.toMatch(/setAttribute\(\s*["'](on|style)/i);
  });

  it("stays inside its size budget", () => {
    const budget = name === "map.js" ? 14 * 1024 : 8 * 1024;
    expect(statSync(path).size).toBeLessThan(budget);
  });
});

describe("assets/map.js", () => {
  const source = files[0]?.source ?? "";

  it("loads MapLibre from the URL the page gives it", () => {
    expect(source).toContain("import(");
    expect(source).toMatch(/\b(dataset|data)\.maplibre\b/);
  });

  it("uses only the client classes the page styles", () => {
    const classes = [...source.matchAll(/className = "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(classes)).toEqual(new Set(["map-status", "wind-controls", "wind-hour", "wind-label", "wind-stale"]));
  });
});
