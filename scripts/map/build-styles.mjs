// Writes assets/map/style-light.json and assets/map/style-dark.json.
//
// The layers come from the @protomaps/basemaps layer generator, passed in as an
// unpacked package directory so it never becomes a dependency of the site:
//
//   node scripts/map/build-styles.mjs <path to unpacked @protomaps/basemaps>
//
// The generator's output is then cut down to the DESIGN.md palette: land is
// paper, water is foam, roads are ink hairlines at low opacity, every label is
// ink in Noto Sans. Icons, casings and the sprite are removed, so the style
// makes no sprite request. URLs are placeholders the server replaces.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = "protomaps";
const BASEMAP_URL = "pmtiles://__BASEMAP__";
const GLYPHS_URL = "__GLYPHS__/{fontstack}/{range}.pbf";
// Plain text, no links: the page caption carries the linked form.
const ATTRIBUTION = "Protomaps © OpenStreetMap contributors";

const REGULAR = "Noto Sans Regular";
const MEDIUM = "Noto Sans Medium";
// Fonts the generator names that we do not ship, and what replaces them.
const FONT_SWAPS = new Map([
  ["Noto Sans Italic", REGULAR],
  ["Noto Sans Devanagari Regular v1", REGULAR],
]);

// From DESIGN.md, Color.
const TOKENS = {
  light: { paper: "#F2EEE4", ink: "#0F2230", sea: "#1F5F7A", foam: "#DCE6E4" },
  dark: { paper: "#0B1820", ink: "#E8E4D8", sea: "#5FA8C4", foam: "#122630" },
};

function rgba(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function flavorFor({ paper, ink, foam }) {
  const none = "rgba(0, 0, 0, 0)";
  const minor = rgba(ink, 0.22);
  const major = rgba(ink, 0.35);
  const highway = rgba(ink, 0.45);
  const flat = {
    background: paper,
    earth: paper,
    park_a: paper,
    park_b: paper,
    hospital: paper,
    industrial: paper,
    school: paper,
    wood_a: paper,
    wood_b: paper,
    pedestrian: paper,
    scrub_a: paper,
    scrub_b: paper,
    glacier: paper,
    zoo: paper,
    military: paper,
    aerodrome: paper,
    pier: paper,
    // A faint tint so the beach itself reads against the street grid.
    sand: rgba(ink, 0.05),
    beach: rgba(ink, 0.05),
    runway: rgba(ink, 0.08),
    buildings: rgba(ink, 0.07),
    water: foam,
    railway: rgba(ink, 0.3),
    boundaries: rgba(ink, 0.3),
  };
  const roads = {};
  for (const prefix of ["", "tunnel_", "bridges_"]) {
    for (const kind of ["other", "minor_service", "minor", "link", "major", "highway"]) {
      const colour = kind === "highway" ? highway : kind === "major" ? major : minor;
      roads[`${prefix}${kind}`] = colour;
      roads[`${prefix}${kind}_casing`] = none;
    }
  }
  roads.minor_a = minor;
  roads.minor_b = minor;
  roads.major_casing_early = none;
  roads.major_casing_late = none;
  roads.highway_casing_early = none;
  roads.highway_casing_late = none;
  const labels = {
    roads_label_minor: ink,
    roads_label_minor_halo: paper,
    roads_label_major: ink,
    roads_label_major_halo: paper,
    ocean_label: ink,
    subplace_label: ink,
    subplace_label_halo: paper,
    city_label: ink,
    city_label_halo: paper,
    state_label: ink,
    state_label_halo: paper,
    country_label: ink,
    address_label: ink,
    address_label_halo: paper,
  };
  // No `pois` and no `landcover`: the generator then emits neither layer.
  return { ...flat, ...roads, ...labels, regular: REGULAR, bold: MEDIUM, italic: REGULAR };
}

// Layers that only make sense with a sprite or that add noise at beach scale.
function keepLayer(layer) {
  if (layer.id.includes("casing")) return false;
  return !["roads_oneway", "roads_shields", "address_label", "pois"].includes(layer.id);
}

const HAIRLINE_MAJOR = ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.4, 14, 1.2, 18, 2.5];
const HAIRLINE_MINOR = ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.25, 14, 0.6, 18, 1.5];

function isRoadLine(layer) {
  return layer.type === "line" && layer.id.startsWith("roads_") && layer.id !== "roads_rail";
}

function swapFonts(value) {
  if (typeof value === "string") return FONT_SWAPS.get(value) ?? value;
  if (Array.isArray(value)) return value.map(swapFonts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapFonts(v)]));
  }
  return value;
}

function restyle(layer) {
  const out = swapFonts(structuredClone(layer));
  if (out.layout) {
    for (const key of Object.keys(out.layout)) {
      if (key.startsWith("icon-")) delete out.layout[key];
    }
  }
  if (isRoadLine(out)) {
    const major = /highway|major|runway/.test(out.id);
    out.paint = { ...out.paint, "line-width": major ? HAIRLINE_MAJOR : HAIRLINE_MINOR };
    delete out.paint["line-gap-width"];
  }
  return out;
}

async function main() {
  const pkgDir = process.argv[2];
  if (!pkgDir) {
    console.error("usage: node scripts/map/build-styles.mjs <unpacked @protomaps/basemaps dir>");
    process.exit(2);
  }
  const generator = await import(pathToFileURL(join(resolve(pkgDir), "dist/esm/index.js")).href);
  const outDir = resolve(import.meta.dirname, "../../assets/map");

  for (const [mode, tokens] of Object.entries(TOKENS)) {
    const layers = generator
      .layers(SOURCE, flavorFor(tokens), { lang: "en" })
      .filter(keepLayer)
      .map(restyle);
    const style = {
      version: 8,
      name: `surf-report ${mode}`,
      sources: {
        [SOURCE]: { type: "vector", url: BASEMAP_URL, attribution: ATTRIBUTION },
      },
      glyphs: GLYPHS_URL,
      layers,
    };
    const path = join(outDir, `style-${mode}.json`);
    writeFileSync(path, `${JSON.stringify(style, null, 2)}\n`);
    console.log(`wrote ${path} (${layers.length} layers)`);
  }
}

await main();
