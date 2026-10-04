# Map client files

Everything the interactive `/map` page needs in the browser, served from the site's own origin. Nothing here is in `package.json`. `scripts/map/build-vendor.sh` fetches and rebuilds all of it, with every version and URL pinned at the top of the script. `tests/mapVendor.test.ts` checks the result.

## Files

| File | Source | Version | License | Bytes | Brotli |
| --- | --- | --- | --- | ---: | ---: |
| `assets/vendor/maplibre-gl/maplibre-gl.mjs` | npm `maplibre-gl`, `dist/` | 6.12.0 | BSD-3-Clause | 597,295 | 127,951 |
| `assets/vendor/maplibre-gl/maplibre-gl-shared.mjs` | same | 6.12.0 | BSD-3-Clause | 516,951 | 121,341 |
| `assets/vendor/maplibre-gl/maplibre-gl-worker.mjs` | same | 6.12.0 | BSD-3-Clause | 19,130 | 5,486 |
| `assets/vendor/maplibre-gl/maplibre-gl.css` | same | 6.12.0 | BSD-3-Clause | 83,305 | 8,644 |
| `assets/vendor/maplibre-gl/LICENSE.txt` | same, package root | 6.12.0 | | 5,984 | |
| `assets/vendor/pmtiles/pmtiles.js` | npm `pmtiles`, `dist/pmtiles.js` (IIFE, global `pmtiles`) | 4.5.0 | BSD-3-Clause, bundles fflate (MIT) | 20,229 | 7,142 |
| `assets/vendor/pmtiles/LICENSE` | github.com/protomaps/PMTiles at `5897a82`; the npm package has none | | BSD-3-Clause | 1,713 | |
| `assets/vendor/pmtiles/LICENSE-fflate` | npm `fflate` 0.8.2 | | MIT | 1,069 | |
| `assets/map/basemap.pmtiles` | Protomaps daily build `20261003` (basemap v4.15.2), `pmtiles extract` | | ODbL (OpenStreetMap) | 5,384,543 | (gzip per tile) |
| `assets/map/glyphs/Noto Sans Regular/{0-255,256-511,8192-8447}.pbf` | github.com/protomaps/basemaps-assets at `028c18f`, `fonts/` | | SIL OFL 1.1 | 76,044 / 127,726 / 64,220 | 35,612 / 46,454 / 36,778 |
| `assets/map/glyphs/Noto Sans Medium/{0-255,256-511,8192-8447}.pbf` | same | | SIL OFL 1.1 | 77,628 / 129,635 / 65,101 | 36,047 / 47,834 / 37,403 |
| `assets/map/glyphs/OFL.txt` | same | | | 4,374 | |
| `assets/map/style-light.json` | `scripts/map/build-styles.mjs` over `@protomaps/basemaps` 5.7.2 | | | 221,054 | 3,134 |
| `assets/map/style-dark.json` | same | | | 221,131 | 3,141 |

SHA-256:

```
8e0545d1042293cb8c1e09949f36ba83237f69b4fbc080958cf38829615bcf69  assets/vendor/maplibre-gl/maplibre-gl.mjs
df3d0b4ba965ebafd2deae3c568500308be2982d87dadd771ba82dc5a49a4631  assets/vendor/maplibre-gl/maplibre-gl-shared.mjs
1ecca7178f0a496b7980dc7a3c6a8c3575eda673cf3e9fa3324dcce7ef3890c2  assets/vendor/maplibre-gl/maplibre-gl-worker.mjs
8456072adc2cbf04f7b845bc83b90cec571b293bd37816970e6566f34946ab8b  assets/vendor/maplibre-gl/maplibre-gl.css
ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2  assets/vendor/maplibre-gl/LICENSE.txt
caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c  assets/vendor/pmtiles/pmtiles.js
0371c38f338835f7fc13ed71176f3d92144e22c8b736a31cced57adbbeb647b3  assets/vendor/pmtiles/LICENSE
805f6cb28bb8b6d3a0badd83c93bccd9671fa01a3b4b92b7042b0743325ac243  assets/vendor/pmtiles/LICENSE-fflate
b187fe9c30b7f115fef4afeb8897f2ad82b97424f3a7009595e70d858a01b072  assets/map/basemap.pmtiles
62c6d49b15fa836eb6aa45e259c7ca6762f44b011b09e47776efbe4a6db1b397  assets/map/glyphs/Noto Sans Regular/0-255.pbf
2eca7561f9f566bcacfda5dd04fb5880baec1328ec0f5484678289a13994de8a  assets/map/glyphs/Noto Sans Regular/256-511.pbf
8ea977a587352fe31b4159ffdbc9a40be79056f2472017c742ea1e4a931864b9  assets/map/glyphs/Noto Sans Regular/8192-8447.pbf
ba2f0118dd024e3041b158e5f9eb49bc0a658019f53f458e9f5c0b8efcd79b91  assets/map/glyphs/Noto Sans Medium/0-255.pbf
d5e801a1a5b1d409d3298c3a1e1ca76328e2314a751078833a618620e8e66e4d  assets/map/glyphs/Noto Sans Medium/256-511.pbf
cc38e4956207f0edba1aaf749b61e8f6f1678ef1ad443d32ee285b21d0eb67aa  assets/map/glyphs/Noto Sans Medium/8192-8447.pbf
dbbe75e64f6283c4117541637e6bad3a6d047031e9c5dbebee2e181c5750051d  assets/map/style-light.json
2d76be6d2c4be32ddf372fdb33b195583b5cf3be7ced8e127793d68ead14bc95  assets/map/style-dark.json
```

The JavaScript, CSS and license files are byte-for-byte copies of the npm tarballs; `assets/vendor/SHA256SUMS` holds their sums and the test checks them.

## MapLibre 6 and the CSP

MapLibre 6 no longer ships the `maplibre-gl-csp.js` build. The 6.x package is ESM only: `maplibre-gl.mjs` and `maplibre-gl-worker.mjs` both import `./maplibre-gl-shared.mjs`. It is CSP-safe without a separate build:

- The worker is a module worker started with `new Worker(url, {type: "module"})`. A `blob:` worker is made only when the worker URL is on another origin, which never happens here.
- No file contains `new Function`. The main bundle, the shared chunk and `pmtiles.js` contain no `eval(`. The worker has one `globalThis.eval(n)`, inside the handler for `importScriptInWorkers()` with a classic script. The page never calls that, and without `'unsafe-eval'` the browser would block it anyway.
- The only `blob:` use left is a fallback image decoder for raster images (`img.src = URL.createObjectURL(...)`). The basemap is vector, so it is unlikely to run, but `img-src blob:` keeps it working if a raster layer is added.

## How the page wires it up

```html
<link rel="stylesheet" href="/assets/.../maplibre-gl.css">
<script src="/assets/.../pmtiles.js"></script>
<script type="module" src="/assets/.../map.js"></script>
```

```js
import * as maplibregl from "<maplibre-gl.mjs URL>";
maplibregl.setWorkerUrl("<maplibre-gl-worker.mjs URL>");
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
```

Constraints for the server:

- **The three `.mjs` files must stay siblings with their original names.** The main bundle and the worker import `./maplibre-gl-shared.mjs` by relative path, so renaming each file with its own hash breaks the import. Hash the directory instead, for example `/assets/vendor/maplibre-gl.<hash of all three>/maplibre-gl.mjs`. Serve them as `text/javascript`.
- **Style placeholders.** Replace `__BASEMAP__` in `"url": "pmtiles://__BASEMAP__"` with the absolute URL of the basemap (`pmtiles://https://surf.../assets/map/basemap.<hash>.pmtiles`), and `__GLYPHS__` in `"glyphs": "__GLYPHS__/{fontstack}/{range}.pbf"` with the absolute URL of the glyphs directory. The load check used absolute URLs; relative ones were not tried.
- **Glyph paths contain spaces.** MapLibre requests `/…/glyphs/Noto%20Sans%20Regular/0-255.pbf`; decode the path before looking it up. Serve `.pbf` as `application/x-protobuf`. A view of Rockaway asks for Regular `0-255` and `8192-8447` (OSM names here contain an en dash). Medium is only used for large-city labels at low zoom.
- **`.pmtiles` needs HTTP Range requests.** The reader asks for `bytes=0-16383` first, then one range per tile run. Answer `206 Partial Content` with `Content-Range` and `Accept-Ranges: bytes`. Never apply `Content-Encoding` to it: the tiles inside are already gzip-compressed, and a compressed range response breaks the offsets. A `200` with the full body would make every visit download all 5.4 MB. Give the file a content-hashed URL so its ETag cannot change during a session (the reader throws `EtagMismatch` when it does), and check that Cloudflare passes range requests through or caches the file and serves ranges from it.
- **CSP for `/map` only:**

  ```
  default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self';
  img-src 'self' data: blob:; connect-src 'self'; worker-src 'self';
  base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

  `connect-src 'self'` covers the style, glyph and PMTiles range fetches. `worker-src 'self'` covers the module worker. `img-src data:` is needed by `maplibre-gl.css`, whose control icons are `data:` SVGs. No `'unsafe-eval'`, no `'unsafe-inline'` and no `blob:` in `worker-src` or `script-src`. MapLibre sets element styles through the CSSOM, which `style-src 'self'` allows. This exact policy rendered both styles in Chromium with no CSP violation.

## Basemap

- Source: `https://build.protomaps.com/20261003.pmtiles`, basemap schema 4.15.2, OpenStreetMap data replicated to 2026-10-03 04:00 UTC.
- Box: lon -74.02 to -73.70, lat 40.52 to 40.66. Max zoom 14: zoom 15 gave a 16.5 MB file, over the 8 MB limit. MapLibre overzooms the zoom 14 tiles for closer views.
- Protomaps deletes daily builds after about a week. To refresh, pick a current date from `https://build-metadata.protomaps.dev/builds.json`, set `PROTOMAPS_BUILD` in the script, rerun it and update this file.

## Attribution

The basemap is an ODbL Produced Work of OpenStreetMap; attribution is required. Protomaps asks for a credit too. The styles carry the plain-text form on the source, because the styles must not contain URLs:

```
Protomaps © OpenStreetMap contributors
```

The linked form Protomaps documents, for the page caption (DESIGN.md wants attribution in the caption, not a map control):

```html
<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
```

The default MapLibre attribution control is light-themed and does not follow the dark style; `attributionControl: false` plus the caption avoids that.

## Styles

`scripts/map/build-styles.mjs` runs the `@protomaps/basemaps` layer generator with a custom flavor built from the DESIGN.md tokens, then trims it:

- Land, parks and other land use are paper. Water is foam. Beach and sand get ink at 5% so the beach reads. Buildings are ink at 7%.
- Roads are ink at 22% (minor), 35% (major) and 45% (highway), drawn as hairlines from 0.25 to 2.5 px by zoom. Road casings are removed.
- Every label is ink with a paper halo, in Noto Sans Regular or Noto Sans Medium. The generator's italic and Devanagari fonts are swapped to Regular, since only Regular and Medium are shipped.
- No POI layer, no landcover layer, no shields or one-way arrows, no `icon-*` properties and no `sprite`, so the style makes no sprite request.
- The style ends with the place labels. It has no data overlays; bathymetry, land, shore features and wind go on top.

## First visit

Estimated bytes over the wire for a first visit to one Rockaway view (zoom 13, centre -73.84, 40.58), with brotli on text files:

| Part | Bytes |
| --- | ---: |
| `maplibre-gl.mjs` + `maplibre-gl-shared.mjs` + worker | 254,778 |
| `maplibre-gl.css` | 8,644 |
| `pmtiles.js` | 7,142 |
| style | 3,134 |
| glyphs (Regular 0-255 and 8192-8447) | 72,390 |
| PMTiles header, directories and tiles (7 range requests, measured) | about 99,500 |
| Total | about 446,000 |

The worker fetches `maplibre-gl-shared.mjs` a second time; with the immutable cache header it comes from the browser cache.
