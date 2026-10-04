#!/usr/bin/env node
// Builds data/map/shore.geojson and data/map/SOURCES-osm.json from OpenStreetMap
// through the Overpass API: the jetties, piers, boardwalk and "Beach NN Street"
// ends along Rockaway's ocean shore. Run from the repo root:
//
//   node scripts/map/build-shore.mjs
//
// The same OSM data always gives the same shore.geojson. The script exits
// non-zero and writes nothing if the request fails or a required kind is empty.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "data", "map");
const SHORE_FILE = join(OUT_DIR, "shore.geojson");
const SOURCES_FILE = join(OUT_DIR, "SOURCES-osm.json");

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "surf-report map build (https://github.com/erikleon/surf-report)";
const TIMEOUT_MS = 180_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const ATTEMPTS = 3;

// The Rockaway box: Beach 25th Street in the east to the Breezy Point jetty in the west.
const BOX = { west: -73.96, south: 40.545, east: -73.76, north: 40.605 };

// Coney Island and Manhattan Beach, across Rockaway Inlet, also face the open
// ocean. Anything west of westOf and north of northOf is that Brooklyn shore.
const BROOKLYN = { westOf: -73.91, northOf: 40.566 };

// A pier or jetty is on the ocean shore when its seaward end has open water due
// south, or when it comes within this distance of the ocean shoreline.
const SHORE_TOUCH_M = 30;

// Every in-box vertex of a boardwalk way lies within this distance of the ocean
// shoreline. The Rockaway walk sits 70 to 160 m back, the Riis walk up to 230 m.
const BOARDWALK_M = 250;

const BBOX = `${BOX.south},${BOX.west},${BOX.north},${BOX.east}`;
const QUERY = `[out:json][timeout:150][bbox:${BBOX}];
(
  way["man_made"~"^(groyne|breakwater|pier)$"];
  way["highway"]["name"~"boardwalk|ocean promenade",i];
  way["highway"="footway"]["surface"~"^(wood|boardwalk)$"];
  way["highway"]["name"~"^Beach [0-9]+(st|nd|rd|th)? Street$"];
  way["natural"="coastline"];
);
out body geom;`;

function fail(message) {
  console.error(`build-shore: ${message}`);
  process.exit(1);
}

async function fetchOverpass() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        fail(`Overpass did not answer within ${TIMEOUT_MS / 1000} s`);
      }
      fail(`request to ${ENDPOINT} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok) {
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        fail(`Overpass returned a body that is not JSON: ${text.slice(0, 200)}`);
      }
      // Overpass reports a query that ran out of time or memory as HTTP 200 with a remark.
      if (body.remark) fail(`Overpass reported an error: ${body.remark}`);
      if (!Array.isArray(body.elements)) fail("Overpass response has no elements array");
      if (!body.osm3s?.timestamp_osm_base) fail("Overpass response has no osm3s.timestamp_osm_base");
      return body;
    }
    const detail = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    if (!RETRY_STATUSES.has(res.status) || attempt === ATTEMPTS) {
      fail(`Overpass answered HTTP ${res.status} after ${attempt} attempt(s): ${detail}`);
    }
    const waitS = 15 * attempt;
    console.error(`build-shore: Overpass answered HTTP ${res.status}, retrying in ${waitS} s`);
    await new Promise((r) => setTimeout(r, waitS * 1000));
  }
  throw new Error("unreachable");
}

// ---- geometry helpers ----

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((40.575 * Math.PI) / 180);

function distToSegmentM(p, a, b) {
  const px = p.lon * M_PER_DEG_LON, py = p.lat * M_PER_DEG_LAT;
  const ax = a.lon * M_PER_DEG_LON, ay = a.lat * M_PER_DEG_LAT;
  const bx = b.lon * M_PER_DEG_LON, by = b.lat * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToSegmentsM(p, segments) {
  let best = Infinity;
  for (const [a, b] of segments) best = Math.min(best, distToSegmentM(p, a, b));
  return best;
}

// Counts the segments crossed by a ray from p due south.
function crossingsSouth(p, segments, skip) {
  let n = 0;
  for (const seg of segments) {
    if (seg === skip) continue;
    const [a, b] = seg;
    if (a.lon === b.lon) continue;
    const lo = Math.min(a.lon, b.lon), hi = Math.max(a.lon, b.lon);
    if (p.lon < lo || p.lon >= hi) continue;
    const lat = a.lat + ((p.lon - a.lon) / (b.lon - a.lon)) * (b.lat - a.lat);
    if (lat < p.lat) n++;
  }
  return n;
}

function inBrooklyn(p) {
  return p.lon < BROOKLYN.westOf && p.lat > BROOKLYN.northOf;
}

function inBox(p) {
  return p.lon >= BOX.west && p.lon <= BOX.east && p.lat >= BOX.south && p.lat <= BOX.north;
}

// Clips one segment to the box (Liang-Barsky). Returns [t0, t1] or null.
function clipSegment(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const edges = [
    [-dx, a.lon - BOX.west],
    [dx, BOX.east - a.lon],
    [-dy, a.lat - BOX.south],
    [dy, BOX.north - a.lat],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

const lerp = (a, b, t) => ({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });

// Splits a polyline into the runs that lie inside the box.
function clipLine(points) {
  const runs = [];
  let run = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const c = clipSegment(a, b);
    if (!c) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    const start = c[0] === 0 ? a : lerp(a, b, c[0]);
    const end = c[1] === 1 ? b : lerp(a, b, c[1]);
    if (!run.length) run.push(start);
    run.push(end);
    if (c[1] < 1) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

function coords(points) {
  const out = [];
  for (const p of points) {
    const c = [round6(p.lon), round6(p.lat)];
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  return out;
}

// Line or polygon geometry for a way, clipped to the box. Null when nothing is left.
function wayGeometry(way) {
  const pts = way.geometry;
  const closed = way.nodes.length > 3 && way.nodes[0] === way.nodes[way.nodes.length - 1];
  if (closed && pts.every(inBox)) {
    const ring = coords(pts);
    if (ring.length >= 4) return { type: "Polygon", coordinates: [ring] };
  }
  const runs = clipLine(pts).map(coords).filter((r) => r.length >= 2);
  if (runs.length === 0) return null;
  if (runs.length === 1) return { type: "LineString", coordinates: runs[0] };
  return { type: "MultiLineString", coordinates: runs };
}

// ---- classification ----

const STREET_RE = /^Beach (\d+)(st|nd|rd|th)? Street$/;

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

function streetLabel(name) {
  const m = STREET_RE.exec(name);
  return m ? `Beach ${ordinal(Number(m[1]))} St` : null;
}

function build(body) {
  const ways = body.elements.filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.tags);
  for (const w of ways) {
    if (w.geometry.some((p) => p == null)) fail(`way/${w.id} came back with missing node positions`);
  }

  const coastSegments = [];
  for (const w of ways.filter((w) => w.tags.natural === "coastline")) {
    for (let i = 0; i + 1 < w.geometry.length; i++) coastSegments.push([w.geometry[i], w.geometry[i + 1]]);
  }
  if (coastSegments.length === 0) fail("no coastline in the box; cannot tell the ocean side");

  // The ocean shoreline is the coastline that has open water due south of it.
  const oceanShore = coastSegments.filter((seg) => {
    const mid = lerp(seg[0], seg[1], 0.5);
    return inBox(mid) && !inBrooklyn(mid) && crossingsSouth(mid, coastSegments, seg) === 0;
  });
  if (oceanShore.length === 0) fail("found no ocean-facing coastline in the box");

  const onOceanShore = (way) => {
    const pts = way.geometry;
    if (pts.some(inBrooklyn)) return false;
    const south = pts.reduce((s, p) => (p.lat < s.lat ? p : s), pts[0]);
    if (crossingsSouth(south, coastSegments) === 0) return true;
    return pts.some((p) => distToSegmentsM(p, oceanShore) <= SHORE_TOUCH_M);
  };

  const features = [];
  const add = (kind, way, name) => {
    const geometry = wayGeometry(way);
    if (!geometry) return;
    const properties = { kind };
    if (name) properties.name = name;
    properties.osmId = `way/${way.id}`;
    features.push({ type: "Feature", properties, geometry });
  };

  // Jetties and piers. A pier built of rock is a jetty in all but its tag.
  const ROCK = /^(stone|boulder|rock|rocks|riprap)$/;
  for (const w of ways) {
    const mm = w.tags.man_made;
    if (!mm || w.tags.highway) continue;
    if (!onOceanShore(w)) continue;
    const kind = mm === "pier" && !ROCK.test(w.tags.material ?? "") ? "pier" : "jetty";
    add(kind, w, w.tags.name);
  }

  // The boardwalk: named boardwalk paths and wooden footways that run along the
  // ocean shore. West of Beach 109th Street OSM names the same walk "Ocean Promenade".
  const boardwalkNodes = new Set();
  for (const w of ways) {
    if (!w.tags.highway || STREET_RE.test(w.tags.name ?? "")) continue;
    const named = /boardwalk|ocean promenade/i.test(w.tags.name ?? "");
    const wooden = w.tags.highway === "footway" && /^(wood|boardwalk)$/.test(w.tags.surface ?? "");
    if (!named && !wooden) continue;
    if (w.geometry.some(inBrooklyn)) continue;
    const inside = w.geometry.filter(inBox);
    if (!inside.length || !inside.every((p) => distToSegmentsM(p, oceanShore) <= BOARDWALK_M)) continue;
    // A short unnamed wooden footway is a beach ramp or a crossing, not the boardwalk.
    if (!named && w.geometry.length < 5) continue;
    add("boardwalk", w, w.tags.name);
    for (const n of w.nodes) boardwalkNodes.add(n);
  }

  // Street ends: one point per "Beach NN Street", where it meets the boardwalk,
  // or failing that at its vertex nearest the ocean shoreline.
  const streets = new Map();
  for (const w of ways) {
    const label = streetLabel(w.tags.name ?? "");
    if (!label || !w.tags.highway) continue;
    if (!streets.has(label)) streets.set(label, []);
    w.geometry.forEach((p, i) => {
      if (inBox(p) && !inBrooklyn(p)) streets.get(label).push({ p, node: w.nodes[i], way: w.id });
    });
  }
  for (const [label, verts] of streets) {
    if (verts.length === 0) continue;
    const onBoardwalk = verts.filter((v) => boardwalkNodes.has(v.node));
    const pool = onBoardwalk.length ? onBoardwalk : verts;
    let best = null;
    for (const v of pool) {
      const d = distToSegmentsM(v.p, oceanShore);
      if (!best || d < best.d || (d === best.d && (v.node < best.node || (v.node === best.node && v.way < best.way)))) {
        best = { ...v, d };
      }
    }
    features.push({
      type: "Feature",
      properties: { kind: "street-end", name: label, osmId: `way/${best.way}` },
      geometry: { type: "Point", coordinates: [round6(best.p.lon), round6(best.p.lat)] },
    });
  }

  const kindOrder = ["jetty", "pier", "boardwalk", "street-end"];
  const idNum = (f) => Number(f.properties.osmId.split("/")[1]);
  features.sort(
    (a, b) =>
      kindOrder.indexOf(a.properties.kind) - kindOrder.indexOf(b.properties.kind) ||
      a.properties.osmId.split("/")[0].localeCompare(b.properties.osmId.split("/")[0]) ||
      idNum(a) - idNum(b),
  );
  return features;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const body = await fetchOverpass();
const features = build(body);

const counts = Object.fromEntries(["jetty", "pier", "boardwalk", "street-end"].map((k) => [k, 0]));
for (const f of features) counts[f.properties.kind]++;
if (counts.jetty === 0) fail("no jetties found; refusing to write a partial file");
if (counts["street-end"] === 0) fail("no street ends found; refusing to write a partial file");

const geojson =
  '{"type":"FeatureCollection","features":[\n' + features.map((f) => JSON.stringify(f)).join(",\n") + "\n]}\n";

const source = [
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    license: "ODbL 1.0",
    attribution: "© OpenStreetMap contributors",
    retrieved: new Date().toISOString().slice(0, 10),
    version: body.osm3s.timestamp_osm_base,
    surveyDates: null,
    verticalDatum: null,
    notes:
      "Jetties, piers, boardwalk and Beach street ends on Rockaway's ocean shore, " +
      "queried from the Overpass API by scripts/map/build-shore.mjs. " +
      "version is the Overpass osm3s.timestamp_osm_base of the extract." +
      (counts.pier === 0 ? " No man_made=pier reaches the ocean shore in this extract." : ""),
  },
];

mkdirSync(OUT_DIR, { recursive: true });
writeAtomic(SHORE_FILE, geojson);
writeAtomic(SOURCES_FILE, JSON.stringify(source, null, 2) + "\n");

console.log(
  `build-shore: wrote ${features.length} features (${Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}), ${Buffer.byteLength(geojson)} bytes, OSM base ${body.osm3s.timestamp_osm_base}`,
);
