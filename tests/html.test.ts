import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/html.js";

describe("escapeHtml", () => {
  it("escapes the five characters that matter in HTML", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("3.4 ft at 9 s")).toBe("3.4 ft at 9 s");
  });

  it("escapes an ampersand that is already part of an entity", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("returns an empty string for an empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
