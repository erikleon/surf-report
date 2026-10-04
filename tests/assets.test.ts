import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { loadAssets } from "../src/assets.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Sources {
  css?: string;
  js?: string;
  geist?: string;
  serif?: string;
}

function makeDir(sources: Sources = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "surf-assets-"));
  dirs.push(dir);
  mkdirSync(join(dir, "fonts"));
  writeFileSync(
    join(dir, "site.css"),
    sources.css ?? "@font-face{src:url(__FONT_GEIST__)}@font-face{src:url(__FONT_SERIF__)}body{margin:0}",
  );
  writeFileSync(join(dir, "scrub.js"), sources.js ?? "console.log('scrub');");
  writeFileSync(join(dir, "fonts/geist-latin-wght.woff2"), sources.geist ?? "geist-bytes");
  writeFileSync(join(dir, "fonts/instrument-serif-latin-400.woff2"), sources.serif ?? "serif-bytes");
  return dir;
}

const hash8 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex").slice(0, 8);

describe("loadAssets urls", () => {
  it("names each file with the first 8 hex characters of its sha256", () => {
    const { urls } = loadAssets(makeDir());
    expect(urls.geist).toBe(`/assets/fonts/geist-latin-wght.${hash8("geist-bytes")}.woff2`);
    expect(urls.serif).toBe(`/assets/fonts/instrument-serif-latin-400.${hash8("serif-bytes")}.woff2`);
    expect(urls.js).toBe(`/assets/scrub.${hash8("console.log('scrub');")}.js`);
    expect(urls.css).toMatch(/^\/assets\/site\.[0-9a-f]{8}\.css$/);
  });

  it("changes a file's URL when its bytes change", () => {
    const a = loadAssets(makeDir({ js: "a" })).urls;
    const b = loadAssets(makeDir({ js: "b" })).urls;
    expect(a.js).not.toBe(b.js);
    expect(a.css).toBe(b.css);
  });

  it("replaces the font tokens in the stylesheet with the hashed font URLs", () => {
    const assets = loadAssets(makeDir());
    const css = assets.lookup(assets.urls.css)?.body.toString("utf8");
    expect(css).toContain(`url(${assets.urls.geist})`);
    expect(css).toContain(`url(${assets.urls.serif})`);
    expect(css).not.toContain("__FONT_");
  });

  it("hashes the stylesheet after the replacement", () => {
    const assets = loadAssets(makeDir());
    const css = assets.lookup(assets.urls.css)?.body;
    expect(css).toBeDefined();
    expect(assets.urls.css).toBe(`/assets/site.${hash8(css as Buffer)}.css`);
  });

  it("changes the stylesheet URL when only a font changes", () => {
    const a = loadAssets(makeDir({ geist: "one" })).urls;
    const b = loadAssets(makeDir({ geist: "two" })).urls;
    expect(a.css).not.toBe(b.css);
  });
});

describe("loadAssets lookup", () => {
  it("returns the type and body of each asset", () => {
    const assets = loadAssets(makeDir());
    expect(assets.lookup(assets.urls.css)?.type).toBe("text/css; charset=utf-8");
    expect(assets.lookup(assets.urls.js)?.type).toBe("text/javascript; charset=utf-8");
    expect(assets.lookup(assets.urls.geist)?.type).toBe("font/woff2");
    expect(assets.lookup(assets.urls.serif)?.body.toString()).toBe("serif-bytes");
  });

  it("precompresses css and js with brotli and gzip", () => {
    const assets = loadAssets(makeDir());
    for (const url of [assets.urls.css, assets.urls.js]) {
      const asset = assets.lookup(url);
      expect(asset).toBeDefined();
      expect(brotliDecompressSync(asset!.encodings["br"]!)).toEqual(asset!.body);
      expect(gunzipSync(asset!.encodings["gzip"]!)).toEqual(asset!.body);
    }
  });

  it("does not recompress fonts", () => {
    const assets = loadAssets(makeDir());
    expect(assets.lookup(assets.urls.geist)?.encodings).toEqual({});
    expect(assets.lookup(assets.urls.serif)?.encodings).toEqual({});
  });

  it("resolves only the four known URLs", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "secret.txt"), "nope");
    const assets = loadAssets(dir);
    const known = Object.values(assets.urls);
    expect(known).toHaveLength(4);
    expect(assets.lookup("/assets/secret.txt")).toBeUndefined();
    expect(assets.lookup("/assets/site.css")).toBeUndefined();
    expect(assets.lookup("/assets/site.00000000.css")).toBeUndefined();
    expect(assets.lookup(`${assets.urls.css}/`)).toBeUndefined();
  });

  it.each([
    "/assets/../secret.txt",
    "/assets/fonts/../../secret.txt",
    "/assets/%2e%2e/secret.txt",
    "/assets/..%2fsecret.txt",
    "/assets//etc/passwd",
    "/../etc/passwd",
    "/assets/__proto__",
    "/assets/constructor",
    "",
  ])("returns undefined for %s", (path) => {
    expect(loadAssets(makeDir()).lookup(path)).toBeUndefined();
  });
});

describe("loadAssets failures", () => {
  it.each(["site.css", "scrub.js", "fonts/geist-latin-wght.woff2", "fonts/instrument-serif-latin-400.woff2"])(
    "throws an error naming a missing %s",
    (name) => {
      const dir = makeDir();
      rmSync(join(dir, name));
      expect(() => loadAssets(dir)).toThrow(join(dir, name));
    },
  );
});
