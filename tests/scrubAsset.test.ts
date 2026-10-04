import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../assets/scrub.js", import.meta.url), "utf8");

// The browser behaviour is covered by the browser tests. These checks guard the
// rules the file has to keep: it parses, and it never reaches the network or
// builds code from strings.
describe("assets/scrub.js", () => {
  it("parses as a classic script", () => {
    expect(() => new vm.Script(source, { filename: "scrub.js" })).not.toThrow();
  });

  it.each(["fetch(", "XMLHttpRequest", "eval(", "new Function", "document.write"])(
    "does not use %s",
    (banned) => {
      expect(source).not.toContain(banned);
    },
  );

  it("handles a cancelled pointer", () => {
    expect(source).toContain("pointercancel");
  });

  it("has no inline event handler strings", () => {
    expect(source).not.toMatch(/setAttribute\(\s*["']on/i);
  });
});
