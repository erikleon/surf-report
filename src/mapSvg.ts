// The static nearshore map: one SVG drawn from the committed GeoJSON in
// data/map/. It is the /map page's content without JavaScript and the
// fallback for the interactive map. The output depends only on the input, so
// scripts/map/render-svg.mjs can rebuild the committed file byte for byte.

// ---- Input types ----

type Pos = number[];

export type Geometry =
  | { type: "Point"; coordinates: Pos }
  | { type: "LineString"; coordinates: Pos[] }
  | { type: "MultiLineString"; coordinates: Pos[][] }
  | { type: "Polygon"; coordinates: Pos[][] }
  | { type: "MultiPolygon"; coordinates: Pos[][][] };

export interface Feature {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: Geometry | null;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

/** One entry of data/map/SOURCES.json or SOURCES-osm.json. */
export interface MapSource {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string;
  retrieved: string;
  version: string;
  surveyDates: string | null;
  verticalDatum: string | null;
  notes: string;
}

/**
 * What the drawing shows: a rectangle on the ground, turned so that the beach
 * runs straight across. Distances are metres from the origin, measured along
 * the turned axes: right is along the beach to the east, up is inland.
 */
export interface Frame {
  lon: number;
  lat: number;
  /** Clockwise turn of the map, in degrees. 0 keeps north up. */
  rotateDeg: number;
  leftM: number;
  rightM: number;
  upM: number;
  downM: number;
}

/** A lon/lat box: west, south, east, north. */
export type Bounds = [number, number, number, number];

export interface NearshoreInput {
  land: FeatureCollection;
  bathymetry: FeatureCollection;
  shore: FeatureCollection;
  sources: MapSource[];
  /** Defaults to the Rockaway ocean side. */
  frame?: Frame;
}

// ---- Layout constants ----

/**
 * The ocean side of the peninsula from the tip of Breezy Point, where the last
 * jetty sits about 8.1 km west of the origin along the beach, to about Beach
 * 35th Street. The
 * shore runs about 17 degrees north of east, so the map is turned 17 degrees
 * clockwise to lay the beach flat with the ocean below it. The origin sits on
 * the beach line near Beach 133rd Street.
 */
export const NEARSHORE_FRAME: Frame = {
  lon: -73.85,
  lat: 40.572,
  rotateDeg: 17,
  leftM: 8500,
  rightM: 7200,
  upM: 1000,
  downM: 2000,
};

/** Width of the drawing in viewBox units. The height follows from the frame. */
export const MAP_WIDTH = 1000;

/** Space under the map for the legend and the caption. */
const FOOT_HEIGHT = 92;

/** Street labels keep at least this much space between their boxes, in viewBox units. */
export const LABEL_MIN_GAP = 6;

/** The stretch the site names in its header. Its two ends are always tried first. */
export const STRETCH_ENDS = [67, 116] as const;

/** A street end counts as on the beach when it is this close to the boardwalk. */
const ON_BEACH_M = 100;

/** Named places west of the streets, where there are no street ends to label. */
const PLACES = [
  { name: "Breezy Point", lon: -73.925, lat: 40.5585 },
  { name: "Fort Tilden", lon: -73.8895, lat: 40.5655 },
  { name: "Jacob Riis Park", lon: -73.8735, lat: 40.5695 },
] as const;

/** Depth contours that carry a label. */
export const LABELLED_DEPTHS_FT = [2, 6, 10, 20, 40] as const;

const FONT_SIZE = 11;
const SANS = "Geist, 'Geist Fallback', Arial, Helvetica, sans-serif";
const SERIF = "'Instrument Serif', 'Instrument Serif Fallback', 'Times New Roman', Times, serif";

// DESIGN.md light tokens. The file is shown in an <img>, which never follows
// the page's dark mode, so it only uses light colours.
const PAPER = "#f2eee4";
const INK = "#0f2230";
const FOAM = "#dce6e4";
/** Shallowest and deepest ends of the sea-blue depth ramp. */
const RAMP_LIGHT = [143, 184, 199] as const;
const RAMP_DARK = [16, 58, 79] as const;

// ---- Projection ----

export interface Projector {
  width: number;
  height: number;
  /** viewBox units per metre, the same in every direction. */
  unitsPerMetre: number;
  /** viewBox x and y for a lon/lat. */
  xy(lon: number, lat: number): [number, number];
  /** lon/lat for a viewBox x and y. */
  lonLat(x: number, y: number): [number, number];
}

const M_PER_DEG_LAT = 111_320;

/**
 * Equirectangular, with longitude scaled by the cosine of the origin's
 * latitude so that a metre is the same length both ways, then turned by the
 * frame's rotation. Over a few kilometres the error is well under a metre.
 */
export function projector(frame: Frame, width = MAP_WIDTH): Projector {
  const k = Math.cos((frame.lat * Math.PI) / 180);
  const t = (frame.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const s = width / (frame.leftM + frame.rightM);
  return {
    width,
    height: round1((frame.upM + frame.downM) * s),
    unitsPerMetre: s,
    xy: (lon, lat) => {
      const e = (lon - frame.lon) * k * M_PER_DEG_LAT;
      const n = (lat - frame.lat) * M_PER_DEG_LAT;
      const along = e * cos + n * sin;
      const up = -e * sin + n * cos;
      return [(along + frame.leftM) * s, (frame.upM - up) * s];
    },
    lonLat: (x, y) => {
      const along = x / s - frame.leftM;
      const up = frame.upM - y / s;
      const e = along * cos - up * sin;
      const n = along * sin + up * cos;
      return [frame.lon + e / (k * M_PER_DEG_LAT), frame.lat + n / M_PER_DEG_LAT];
    },
  };
}

/** The lon/lat box around the drawing's four corners, for the interactive map. */
export function frameBounds(frame: Frame): Bounds {
  const p = projector(frame);
  const corners = [p.lonLat(0, 0), p.lonLat(p.width, 0), p.lonLat(0, p.height), p.lonLat(p.width, p.height)];
  const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
  return [
    r4(Math.min(...corners.map((c) => c[0]))),
    r4(Math.min(...corners.map((c) => c[1]))),
    r4(Math.max(...corners.map((c) => c[0]))),
    r4(Math.max(...corners.map((c) => c[1]))),
  ];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A coordinate in tenths of a unit, so that rounding and differences are exact. */
type Tenths = [number, number];

function tenths(p: Projector, pos: Pos): Tenths {
  const [x, y] = p.xy(pos[0] ?? 0, pos[1] ?? 0);
  return [Math.round(x * 10), Math.round(y * 10)];
}

function fmt(t: number): string {
  return String(t / 10);
}

// ---- Path building ----

/** Drops points within 0.5 units of the last kept point, keeping both ends. */
export function simplify(points: Tenths[]): Tenths[] {
  const first = points[0];
  if (first === undefined) return [];
  const out: Tenths[] = [first];
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Tenths;
    const last = out[out.length - 1] as Tenths;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 5) out.push(p);
    else if (i === points.length - 1 && out.length > 1) out[out.length - 1] = p;
  }
  return out;
}

/** "M x y l dx dy dx dy ...", relative after the first point to keep the file small. */
function pathData(points: Tenths[], close: boolean): string {
  const first = points[0];
  if (first === undefined || points.length < 2) return "";
  let d = `M${fmt(first[0])} ${fmt(first[1])}l`;
  let prev = first;
  let sep = "";
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Tenths;
    const dx = fmt(p[0] - prev[0]);
    const dy = fmt(p[1] - prev[1]);
    d += (dx.startsWith("-") ? "" : sep) + dx + (dy.startsWith("-") ? "" : " ") + dy;
    sep = " ";
    prev = p;
  }
  return close ? `${d}z` : d;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

/**
 * Splits a projected line into the runs that touch the drawing, keeping one
 * point past each edge so the clip path, not a gap, ends the line.
 */
function clipRuns(points: Tenths[], view: Box): Tenths[][] {
  const runs: Tenths[][] = [];
  let run: Tenths[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Tenths;
    const b = points[i + 1] as Tenths;
    const seg: Box = {
      x0: Math.min(a[0], b[0]),
      y0: Math.min(a[1], b[1]),
      x1: Math.max(a[0], b[0]),
      y1: Math.max(a[1], b[1]),
    };
    if (overlaps(seg, view)) {
      if (run.length === 0) run.push(a);
      run.push(b);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function lines(g: Geometry | null): Pos[][] {
  if (g === null) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

function polygons(g: Geometry | null): Pos[][][] {
  if (g === null) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

function linePath(p: Projector, view: Box, parts: Pos[][]): string {
  const out: string[] = [];
  for (const part of parts) {
    const projected = part.map((pos) => tenths(p, pos));
    for (const run of clipRuns(projected, view)) {
      const d = pathData(simplify(run), false);
      if (d !== "") out.push(d);
    }
  }
  return out.join("");
}

function polygonPath(p: Projector, view: Box, polys: Pos[][][]): string {
  const out: string[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map((pos) => tenths(p, pos));
      const box = boundsOf(pts);
      if (box === undefined || !overlaps(box, view)) continue;
      const simple = simplify(pts);
      // Without its closing point a ring that came back to the start is drawn by "z".
      const last = simple[simple.length - 1];
      const first = simple[0];
      if (simple.length > 2 && last !== undefined && first !== undefined && last[0] === first[0] && last[1] === first[1]) {
        simple.pop();
      }
      if (simple.length < 3) continue;
      out.push(pathData(simple, true));
    }
  }
  return out.join("");
}

function boundsOf(pts: Tenths[]): Box | undefined {
  if (pts.length === 0) return undefined;
  let b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) b = { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) };
  return b;
}

// ---- Colour ----

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The sea-blue ramp: 0 is the shallowest contour, 1 the deepest. */
export function rampColour(t: number): string {
  const c = Math.min(1, Math.max(0, t));
  return hex(RAMP_LIGHT.map((l, i) => l + ((RAMP_DARK[i] as number) - l) * c));
}

// ---- Text ----

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * A width estimate for a label, used only to keep labels apart. Geist and its
 * Arial fallback both average a little over half an em per character.
 */
export function textWidth(text: string, size = FONT_SIZE): number {
  return text.length * size * 0.58;
}

// ---- Street ends ----

export interface StreetLabel {
  number: number;
  text: string;
  /** Anchor, the street end itself. */
  x: number;
  y: number;
  box: Box;
}

/** "Beach 90th St" to 90. */
function streetNumber(name: unknown): number | undefined {
  if (typeof name !== "string") return undefined;
  const m = /^Beach (\d+)/.exec(name);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

function segmentDistance(px: number, py: number, a: Pos, b: Pos): number {
  const ax = a[0] ?? 0;
  const ay = a[1] ?? 0;
  const dx = (b[0] ?? 0) - ax;
  const dy = (b[1] ?? 0) - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Picks a sparse, readable set of street labels. Candidates are the two ends
 * of the stretch, then every tenth street (Beach 30th, 40th and so on) from
 * east to west. A candidate is kept only when its label box stays inside the
 * drawing and at least LABEL_MIN_GAP units from every label already kept.
 */
export function placeStreetLabels(
  ends: Array<{ number: number; x: number; y: number }>,
  width: number,
  height: number,
): StreetLabel[] {
  const ordered = [
    ...STRETCH_ENDS.flatMap((n) => ends.filter((e) => e.number === n)),
    ...ends.filter((e) => e.number % 10 === 0).sort((a, b) => a.number - b.number),
  ];
  const kept: StreetLabel[] = [];
  for (const e of ordered) {
    if (kept.some((k) => k.number === e.number)) continue;
    const text = `B${e.number}`;
    const w = textWidth(text);
    const box: Box = { x0: e.x - w / 2, y0: e.y - 9 - FONT_SIZE, x1: e.x + w / 2, y1: e.y - 6 };
    if (box.x0 < 2 || box.y0 < 2 || box.x1 > width - 2 || box.y1 > height - 2) continue;
    if (kept.some((k) => overlaps(k.box, box, LABEL_MIN_GAP))) continue;
    kept.push({ number: e.number, text, x: e.x, y: e.y, box });
  }
  return kept.sort((a, b) => a.x - b.x);
}

function streetEnds(input: NearshoreInput, p: Projector): Array<{ number: number; x: number; y: number }> {
  const walks = input.shore.features.filter((f) => f.properties?.["kind"] === "boardwalk").flatMap((f) => lines(f.geometry));
  const out: Array<{ number: number; x: number; y: number }> = [];
  for (const f of input.shore.features) {
    if (f.properties?.["kind"] !== "street-end" || f.geometry?.type !== "Point") continue;
    const n = streetNumber(f.properties["name"]);
    const [lon, lat] = f.geometry.coordinates;
    if (n === undefined || lon === undefined || lat === undefined) continue;
    // Some streets stop north of the beach; their point is inland.
    const k = Math.cos((lat * Math.PI) / 180);
    let best = Infinity;
    for (const w of walks) {
      for (let i = 0; i < w.length - 1; i++) {
        const a = w[i] as Pos;
        const b = w[i + 1] as Pos;
        const d = segmentDistance(lon * k, lat, [(a[0] ?? 0) * k, a[1] ?? 0], [(b[0] ?? 0) * k, b[1] ?? 0]);
        best = Math.min(best, d * M_PER_DEG_LAT);
      }
    }
    if (best > ON_BEACH_M) continue;
    const [x, y] = p.xy(lon, lat);
    out.push({ number: n, x: round1(x), y: round1(y) });
  }
  return out.sort((a, b) => a.number - b.number);
}

// ---- Depth labels ----

interface DepthLabel {
  depth: number;
  text: string;
  x: number;
  y: number;
  box: Box;
}

/**
 * One label per labelled depth, on its contour near a preferred spot along
 * the beach, never over another label.
 */
function placeDepthLabels(
  contours: Map<number, Tenths[][]>,
  taken: Box[],
  width: number,
  height: number,
): DepthLabel[] {
  const out: DepthLabel[] = [];
  // Preferred x for each label, as a share of the width. Off the middle of the
  // stretch the shallow contours are farthest apart.
  const prefer = [0.66, 0.6, 0.66, 0.6, 0.66];
  LABELLED_DEPTHS_FT.forEach((depth, i) => {
    const runs = contours.get(depth);
    if (runs === undefined) return;
    const target = (prefer[i] ?? 0.6) * width * 10;
    const candidates = runs
      .filter((r) => {
        // Long runs only: a label on a small loop would not say which line it names.
        const b = boundsOf(r);
        return b !== undefined && b.x1 - b.x0 >= 600;
      })
      .flatMap((r) => r)
      .filter(([x, y]) => x > 300 && x < width * 10 - 300 && y > 200 && y < height * 10 - 200)
      .sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target) || a[1] - b[1] || a[0] - b[0]);
    const text = `${depth} ft`;
    const w = textWidth(text, FONT_SIZE - 1) + 4;
    for (const [tx, ty] of candidates) {
      const x = tx / 10;
      const y = ty / 10;
      const box: Box = { x0: x - w / 2, y0: y - 6.5, x1: x + w / 2, y1: y + 6.5 };
      if ([...taken, ...out.map((o) => o.box)].some((b) => overlaps(b, box, 3))) continue;
      out.push({ depth, text, x, y, box });
      return;
    }
  });
  return out;
}

// ---- Survey dates ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A short line about when the bottom was surveyed, read from the sources'
 * `surveyDates` text: the survey with the largest share in full, then the
 * years of the others.
 */
export function surveySummary(sources: MapSource[]): string {
  const surveys: Array<{ share: number; year: number; month: number }> = [];
  for (const s of sources) {
    if (s.surveyDates === null) continue;
    for (const m of s.surveyDates.matchAll(/(\d+)% [^,;]+, (\d{4})-(\d{2})(?:-\d{2})?(?: to (\d{4})-(\d{2}))?/g)) {
      const year = Number(m[4] ?? m[2]);
      const month = Number(m[5] ?? m[3]);
      surveys.push({ share: Number(m[1]), year, month });
    }
  }
  surveys.sort((a, b) => b.share - a.share || b.year - a.year);
  const top = surveys[0];
  if (top === undefined) return "Survey dates are listed with the sources.";
  const rest = [...new Set(surveys.slice(1).map((s) => s.year))].filter((y) => y !== top.year).sort((a, b) => a - b);
  const when = `${MONTHS[top.month - 1] ?? ""} ${top.year}`.trim();
  const older =
    rest.length === 0 ? "" : `; older parts ${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`}`;
  return `Surveyed ${when} (${top.share}% of the surf zone)${older}`;
}

// ---- Facts for the page's text list ----

export interface NearshoreFacts {
  /** The SVG's size in viewBox units, for the <img> width and height. */
  width: number;
  height: number;
  jetties: number;
  /** Street numbers of the labelled street ends, west to east. */
  streetLabels: number[];
  /** Depths of the contours drawn, shallow to deep. */
  depthsFt: number[];
  survey: string;
  sources: Array<Pick<MapSource, "name" | "url" | "license" | "attribution" | "retrieved" | "surveyDates">>;
  /** The lon/lat box around the drawing, for the interactive map's first view. */
  bounds: Bounds;
}

// ---- Layout ----

interface Layout {
  p: Projector;
  view: Box;
  /** The area the source data covers. Outside it the drawing shows no data. */
  covered: string;
  land: string;
  places: Array<{ text: string; x: number; y: number; box: Box }>;
  contours: Array<{ depth: number; d: string; colour: string; labelled: boolean }>;
  jetties: string[];
  boardwalk: string;
  streets: StreetLabel[];
  depthLabels: DepthLabel[];
  depths: number[];
}

function layout(input: NearshoreInput): Layout {
  const frame = input.frame ?? NEARSHORE_FRAME;
  const p = projector(frame);
  const view: Box = { x0: 0, y0: 0, x1: p.width * 10, y1: p.height * 10 };

  const landPolys = input.land.features.flatMap((f) => polygons(f.geometry));
  const land = polygonPath(p, view, landPolys);
  const landRings = landPolys.flatMap((poly) => poly.map((ring) => ring.map((pos) => tenths(p, pos))));
  const covered = coveredPath(p, input);

  const byDepth = new Map<number, Pos[][]>();
  for (const f of input.bathymetry.features) {
    const depth = f.properties?.["depthFt"];
    if (typeof depth !== "number" || !Number.isFinite(depth)) continue;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), ...lines(f.geometry)]);
  }
  const allDepths = [...byDepth.keys()].sort((a, b) => a - b);
  const runsByDepth = new Map<number, Tenths[][]>();
  for (const depth of allDepths) {
    const runs = (byDepth.get(depth) ?? [])
      .flatMap((part) =>
        clipRuns(
          part.map((pos) => tenths(p, pos)),
          view,
        ),
      )
      .filter((run) => !behindLand(run, landRings));
    if (runs.length > 0) runsByDepth.set(depth, runs);
  }
  const depths = [...runsByDepth.keys()];
  const contours = depths.map((depth, i) => ({
    depth,
    d: (runsByDepth.get(depth) ?? []).map((r) => pathData(simplify(r), false)).join(""),
    colour: rampColour(depths.length < 2 ? 0 : i / (depths.length - 1)),
    labelled: (LABELLED_DEPTHS_FT as readonly number[]).includes(depth),
  }));

  const jetties = input.shore.features
    .filter((f) => f.properties?.["kind"] === "jetty")
    .map((f) => linePath(p, view, lines(f.geometry)))
    .filter((d) => d !== "");
  const boardwalk = linePath(
    p,
    view,
    input.shore.features.filter((f) => f.properties?.["kind"] === "boardwalk").flatMap((f) => lines(f.geometry)),
  );

  const streets = placeStreetLabels(streetEnds(input, p), p.width, p.height);
  const places = placePlaces(p, streets.map((s) => s.box));
  const depthLabels = placeDepthLabels(
    runsByDepth,
    [...streets.map((s) => s.box), ...places.map((s) => s.box), ...fixedBoxes(p)],
    p.width,
    p.height,
  );
  return { p, view, covered, land, places, contours, jetties, boardwalk, streets, depthLabels, depths };
}

/** Place names that fit inside the drawing without touching a street label. */
function placePlaces(p: Projector, taken: Box[]): Array<{ text: string; x: number; y: number; box: Box }> {
  const out: Array<{ text: string; x: number; y: number; box: Box }> = [];
  for (const place of PLACES) {
    const [px, py] = p.xy(place.lon, place.lat);
    const x = round1(px);
    const y = round1(py);
    const w = textWidth(place.name);
    const box: Box = { x0: x - w / 2, y0: y - FONT_SIZE, x1: x + w / 2, y1: y + 3 };
    if (box.x0 < 2 || box.y0 < 2 || box.x1 > p.width - 2 || box.y1 > p.height - 2) continue;
    if ([...taken, ...out.map((o) => o.box)].some((b) => overlaps(b, box, LABEL_MIN_GAP))) continue;
    out.push({ text: place.name, x, y, box });
  }
  return out;
}

/**
 * True for a contour on the bay side. Seen from the ocean, bay water has land
 * between it and the bottom of the drawing; open water does not. Two of the
 * run's start, middle and end decide.
 */
function behindLand(run: Tenths[], rings: Tenths[][]): boolean {
  const samples = [run[0], run[Math.floor(run.length / 2)], run[run.length - 1]];
  let behind = 0;
  for (const s of samples) {
    if (s !== undefined && landBelow(s, rings)) behind++;
  }
  return behind >= 2;
}

/** Whether a straight line down from the point crosses any land outline. */
function landBelow([px, py]: Tenths, rings: Tenths[][]): boolean {
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i] as Tenths;
      const [bx, by] = ring[i + 1] as Tenths;
      if (ax === bx || (ax > px) === (bx > px)) continue;
      const y = ay + ((px - ax) * (by - ay)) / (bx - ax);
      if (y > py) return true;
    }
  }
  return false;
}

/** The lon/lat box that the contours and the land outline cover, drawn as a closed path. */
function coveredPath(p: Projector, input: NearshoreInput): string {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
      return;
    }
    for (const inner of c) visit(inner);
  };
  for (const f of [...input.bathymetry.features, ...input.land.features]) visit(f.geometry?.coordinates);
  if (!Number.isFinite(w)) return "";
  const box = [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ].map((pos) => tenths(p, pos));
  return pathData(clipToView(box, { x0: 0, y0: 0, x1: Math.round(p.width * 10), y1: Math.round(p.height * 10) }), true);
}

/** Sutherland-Hodgman: the part of a convex polygon inside the view, in tenths. */
function clipToView(poly: Tenths[], view: Box): Tenths[] {
  const edges: Array<[(q: Tenths) => boolean, (a: Tenths, b: Tenths) => Tenths]> = [
    [(q) => q[0] >= view.x0, (a, b) => atX(a, b, view.x0)],
    [(q) => q[0] <= view.x1, (a, b) => atX(a, b, view.x1)],
    [(q) => q[1] >= view.y0, (a, b) => atY(a, b, view.y0)],
    [(q) => q[1] <= view.y1, (a, b) => atY(a, b, view.y1)],
  ];
  let out = poly;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i] as Tenths;
      const prev = input[(i + input.length - 1) % input.length] as Tenths;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
  }
  return out;
}

function atX(a: Tenths, b: Tenths, x: number): Tenths {
  return [x, Math.round(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]))];
}

function atY(a: Tenths, b: Tenths, y: number): Tenths {
  return [Math.round(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])), y];
}

/** The north arrow and scale bar sit in the bottom right corner of the map. */
function fixedBoxes(p: Projector): Box[] {
  return [{ x0: p.width - 200, y0: p.height - 60, x1: p.width, y1: p.height }];
}

export function nearshoreFacts(input: NearshoreInput): NearshoreFacts {
  const l = layout(input);
  return {
    width: l.p.width,
    height: round1(l.p.height + FOOT_HEIGHT),
    jetties: l.jetties.length,
    streetLabels: l.streets.map((s) => s.number),
    depthsFt: l.depths,
    survey: surveySummary(input.sources),
    sources: input.sources.map((s) => ({
      name: s.name,
      url: s.url,
      license: s.license,
      attribution: s.attribution,
      retrieved: s.retrieved,
      surveyDates: s.surveyDates,
    })),
    bounds: frameBounds(input.frame ?? NEARSHORE_FRAME),
  };
}

/** The text of src/mapFacts.ts, written by scripts/map/render-svg.mjs. */
export function factsModule(facts: NearshoreFacts): string {
  return (
    `// Generated by scripts/map/render-svg.mjs from data/map/. Do not edit by hand.\n\n` +
    `import type { NearshoreFacts } from "./mapSvg.js";\n\n` +
    `export const MAP_FACTS: NearshoreFacts = ${JSON.stringify(facts, null, 2)};\n`
  );
}

// ---- Drawing ----

/** A scale bar length in feet that fits in about 150 units. */
function scaleFeet(p: Projector): number {
  const unitsPerFoot = p.unitsPerMetre * 0.3048;
  const options = [500, 1000, 2000, 2500, 5000];
  let best = options[0] as number;
  for (const ft of options) if (ft * unitsPerFoot <= 150) best = ft;
  return best;
}

function text(x: number, y: number, s: string, attrs = ""): string {
  return `<text x="${round1(x)}" y="${round1(y)}"${attrs}>${esc(s)}</text>`;
}

export const CAPTION_DATUM = "Depths in feet below mean lower low water.";
export const CAPTION_NAV = "Not for navigation.";
export const CAPTION_SNAPSHOT = "Sandbars move with every storm; this is a snapshot, not today's bottom.";
export const ATTRIBUTION = "Depths: NOAA BlueTopo (public domain). Shore: © OpenStreetMap contributors (ODbL).";

export function renderNearshoreSvg(input: NearshoreInput): string {
  const l = layout(input);
  const { p } = l;
  const frame = input.frame ?? NEARSHORE_FRAME;
  const W = p.width;
  const H = p.height;
  const total = round1(H + FOOT_HEIGHT);
  const survey = surveySummary(input.sources);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" width="${W}" height="${total}" role="img" aria-labelledby="t d">`,
    `<title id="t">Rockaway nearshore depths</title>`,
    `<desc id="d">Map of the Rockaway Beach shore, turned so the beach runs across with the ocean below, ` +
      `with depth contours from ${l.depths[0] ?? 0} to ${l.depths[l.depths.length - 1] ?? 0} feet, ` +
      `${l.jetties.length} jetties, the boardwalk and labelled street ends. ` +
      `${CAPTION_DATUM} ${survey}. ${CAPTION_NAV} ${CAPTION_SNAPSHOT}</desc>`,
    `<defs><clipPath id="c"><rect width="${W}" height="${H}"/></clipPath></defs>`,
    `<rect width="${W}" height="${total}" fill="${PAPER}"/>`,
    `<g clip-path="url(#c)">`,
    // Ground outside the surveyed box is drawn as no data, like a no-data hour on the chart.
    `<rect width="${W}" height="${H}" fill="${INK}" fill-opacity="0.08"/>`,
    l.covered === "" ? "" : `<path d="${l.covered}" fill="${FOAM}"/>`,
  );

  // Contours, shallow over deep so the surf zone lines stay on top.
  parts.push(`<g fill="none" stroke-linejoin="round" stroke-linecap="round">`);
  for (const c of [...l.contours].reverse()) {
    if (c.d === "") continue;
    parts.push(`<path d="${c.d}" stroke="${c.colour}" stroke-width="${c.labelled ? 1.4 : 0.8}"/>`);
  }
  parts.push(`</g>`);

  if (l.land !== "") {
    parts.push(`<path d="${l.land}" fill="${PAPER}" fill-rule="evenodd" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.6"/>`);
  }
  if (l.boardwalk !== "") {
    parts.push(`<path d="${l.boardwalk}" fill="none" stroke="${INK}" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="4 3"/>`);
  }
  if (l.jetties.length > 0) {
    parts.push(`<path d="${l.jetties.join("")}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`);
  }

  // Labels: paper halo on land, foam halo on water.
  parts.push(`<g font-family="${SANS}" font-size="${FONT_SIZE}" fill="${INK}" text-anchor="middle">`);
  for (const s of l.streets) {
    parts.push(`<circle cx="${s.x}" cy="${s.y}" r="1.6"/>`);
    parts.push(text(s.x, s.box.y1 - 1, s.text, ` stroke="${PAPER}" stroke-width="3" paint-order="stroke"`));
  }
  for (const pl of l.places) {
    parts.push(text(pl.x, pl.y, pl.text, ` fill-opacity="0.8" stroke="${PAPER}" stroke-width="3" paint-order="stroke"`));
  }
  for (const d of l.depthLabels) {
    parts.push(text(d.x, d.y + 3.5, d.text, ` font-size="${FONT_SIZE - 1}" stroke="${FOAM}" stroke-width="3.5" paint-order="stroke"`));
  }
  parts.push(`</g>`);
  parts.push(text(W * 0.3, H * 0.7, "Atlantic Ocean", ` font-family="${SERIF}" font-size="20" fill="${INK}" fill-opacity="0.75" text-anchor="middle"`));

  // North arrow and scale bar, bottom right.
  const ft = scaleFeet(p);
  const len = round1(ft * 0.3048 * p.unitsPerMetre);
  const sx = W - 30 - len;
  const sy = H - 18;
  parts.push(
    `<g font-family="${SANS}" font-size="${FONT_SIZE}" fill="${INK}" stroke="${FOAM}" stroke-width="3" paint-order="stroke">`,
    `<path d="M${round1(sx)} ${sy - 4}v4h${len}v-4" fill="none" stroke="${INK}" stroke-width="1"/>`,
    text(sx, sy - 8, "0", ` text-anchor="middle"`),
    text(sx + len, sy - 8, `${ft.toLocaleString("en-US")} ft`, ` text-anchor="middle"`),
    `<g transform="rotate(${frame.rotateDeg} ${round1(sx - 34)} ${sy - 9})">`,
    `<path d="M${round1(sx - 40)} ${sy}l6-18 6 18-6-5z" fill="${INK}"/>`,
    text(sx - 34, sy - 22, "N", ` text-anchor="middle" font-weight="500"`),
    `</g>`,
    `</g>`,
  );
  parts.push(`</g>`);
  parts.push(`<rect width="${W}" height="${H}" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1"/>`);

  // Legend: one swatch per contour depth.
  const lx = 12;
  const ly = H + 14;
  const sw = 26;
  parts.push(`<g font-family="${SANS}" font-size="${FONT_SIZE}" fill="${INK}">`);
  parts.push(text(lx, ly + 9, "Depth, ft", ""));
  l.contours.forEach((c, i) => {
    const x = lx + 62 + i * sw;
    parts.push(`<rect x="${x}" y="${ly}" width="${sw}" height="10" fill="${c.colour}"/>`);
    if (c.labelled || i === l.contours.length - 1) parts.push(text(x + sw / 2, ly + 23, String(c.depth), ` text-anchor="middle"`));
  });
  const keyX = lx + 62 + l.contours.length * sw + 24;
  parts.push(
    `<path d="M${keyX} ${ly + 5}h22" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    text(keyX + 28, ly + 9, "Jetty", ` text-anchor="start"`),
    `<path d="M${keyX + 80} ${ly + 5}h22" stroke="${INK}" stroke-opacity="0.7" stroke-dasharray="4 3"/>`,
    text(keyX + 108, ly + 9, "Boardwalk", ` text-anchor="start"`),
    `<circle cx="${keyX + 190}" cy="${ly + 5}" r="1.6"/>`,
    text(keyX + 196, ly + 9, "B90: Beach 90th Street", ` text-anchor="start"`),
  );
  parts.push(text(lx, ly + 44, `${CAPTION_DATUM} ${survey}. ${CAPTION_NAV}`, ""));
  parts.push(text(lx, ly + 58, CAPTION_SNAPSHOT, ""));
  parts.push(text(lx, ly + 72, ATTRIBUTION, ` fill-opacity="0.8"`));
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n") + "\n";
}
