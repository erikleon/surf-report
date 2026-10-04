/*
 * The interactive map on /map.
 *
 * The page already shows a static map. This script loads MapLibre, draws the
 * basemap with our depth contours, land outline and shore features on top,
 * and adds the wind layer. Only when the map has rendered does it add
 * `map-ready`, which hides the static map. If anything needed is missing it
 * says why in `.map-status` and leaves the static map in place.
 *
 * Wind state (fresh, stale or missing) and the current hour come from the
 * server. The hour slider only selects among the hours the server sent.
 */

import { createWindLayer } from "./wind.js";

// DESIGN.md tokens. Depth runs from a light sea tint (shallow) to the
// darkest sea blue (deep); no amber and no good or poor colours on the map.
const COLORS = {
  light: {
    paper: "#F2EEE4",
    ink: "#0F2230",
    sea: "#1F5F7A",
    shallow: "#8FB5C4",
    deep: "#0E3A4C",
  },
  dark: {
    paper: "#0B1820",
    ink: "#E8E4D8",
    sea: "#5FA8C4",
    shallow: "#5F9DB4",
    deep: "#2C6A82",
  },
};

const FONT = ["Noto Sans Regular"];
const NEEDED = ["styleLight", "styleDark", "maplibre", "bathymetry", "land", "shore", "wind", "bounds"];

const section = document.querySelector(".map");
const container = section && section.querySelector(".map-canvas");

/** Writes a short reason into `.map-status`, creating it after the canvas if needed. */
function status(text) {
  if (!section) return;
  let el = section.querySelector(".map-status");
  if (!el) {
    el = document.createElement("p");
    el.className = "map-status";
    el.setAttribute("role", "status");
    (container || section).after(el);
  }
  el.textContent = text;
}

/** Resolves a same-origin path against the page, so the worker gets a full URL. */
const abs = (path) => new URL(path, location.href).href;

/** "2026-10-04T15:00" as "Oct 4, 3 PM", read from the string. The stamp is already New York time. */
function hourLabel(stamp) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(stamp.slice(5, 7)) - 1];
  const day = Number(stamp.slice(8, 10));
  const h = Number(stamp.slice(11, 13));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return month + " " + day + ", " + h12 + " " + (h < 12 ? "AM" : "PM");
}

/** Lowest and highest speed in one hour, in whole mph, for the text summary. */
function speedRange(field, hourIndex) {
  const all = (field.speed[hourIndex] || []).flat();
  if (!all.length) return null;
  return { min: Math.round(Math.min(...all)), max: Math.round(Math.max(...all)) };
}

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Waits for the deferred pmtiles script if this module somehow ran first. */
async function pmtilesGlobal() {
  if (!globalThis.pmtiles && document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  if (!globalThis.pmtiles) throw new Error("the pmtiles reader did not load");
  return globalThis.pmtiles;
}

/** Our overlays, added again after each style change because setStyle drops them. */
function addOverlays(map, c) {
  const data = container.dataset;
  // Lines go under the basemap's labels; our own labels go on top.
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol");
  const below = firstSymbol && firstSymbol.id;
  map.addSource("bathymetry", { type: "geojson", data: abs(data.bathymetry) });
  map.addSource("land", { type: "geojson", data: abs(data.land) });
  map.addSource("shore", { type: "geojson", data: abs(data.shore) });
  const kind = (k) => ["==", ["get", "kind"], k];

  map.addLayer(
    {
      id: "depth-lines",
      type: "line",
      source: "bathymetry",
      paint: {
        "line-color": ["interpolate", ["linear"], ["get", "depthFt"], 2, c.shallow, 60, c.deep],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1.4],
        "line-opacity": 0.8,
      },
    },
    below,
  );
  map.addLayer(
    {
      id: "land-outline",
      type: "line",
      source: "land",
      paint: { "line-color": c.ink, "line-opacity": 0.5, "line-width": 0.5 },
    },
    below,
  );
  map.addLayer(
    {
      id: "boardwalk",
      type: "line",
      source: "shore",
      filter: kind("boardwalk"),
      paint: { "line-color": c.ink, "line-width": 1.5, "line-dasharray": [2, 1.5], "line-opacity": 0.7 },
    },
    below,
  );
  map.addLayer(
    {
      id: "jetties",
      type: "line",
      source: "shore",
      filter: ["in", ["get", "kind"], ["literal", ["jetty", "pier"]]],
      layout: { "line-cap": "round" },
      paint: { "line-color": c.ink, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 5] },
    },
    below,
  );
  map.addLayer({
    id: "depth-labels",
    type: "symbol",
    source: "bathymetry",
    minzoom: 14,
    filter: ["in", ["get", "depthFt"], ["literal", [10, 20, 30, 40, 60]]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 400,
      "text-field": ["concat", ["to-string", ["get", "depthFt"]], " ft"],
      "text-font": FONT,
      "text-size": 11,
    },
    paint: { "text-color": c.ink, "text-halo-color": c.paper, "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "street-ends",
    type: "circle",
    source: "shore",
    filter: kind("street-end"),
    minzoom: 13,
    paint: {
      "circle-radius": 2.5,
      "circle-color": c.ink,
      "circle-stroke-color": c.paper,
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "street-end-labels",
    type: "symbol",
    source: "shore",
    filter: ["all", kind("street-end"), ["has", "name"]],
    minzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT,
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.6],
      "text-optional": true,
    },
    paint: { "text-color": c.ink, "text-halo-color": c.paper, "text-halo-width": 1.5 },
  });
}

/** Builds the hour slider and label after the canvas and mounts the wind layer. */
async function addWind(map, mode, reducedMotion) {
  const res = await fetch(container.dataset.wind);
  if (!res.ok) throw new Error("wind field returned " + res.status);
  const wind = await res.json();
  if (wind.state === "missing" || !Array.isArray(wind.times) || !wind.times.length) {
    status("Wind field not available right now.");
    return null;
  }
  const stale = wind.state === "stale";
  const first = Number.isInteger(wind.hourIndex) ? wind.hourIndex : 0;

  const controls = document.createElement("div");
  controls.className = "wind-controls";
  const id = "wind-hour";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = "Wind forecast hour";
  const range = document.createElement("input");
  range.type = "range";
  range.className = "wind-hour";
  range.id = id;
  range.min = String(first);
  range.max = String(wind.times.length - 1);
  range.step = "1";
  range.value = String(first);
  const out = document.createElement("p");
  out.className = "wind-label";
  out.setAttribute("aria-live", "polite");
  controls.append(label, range, out);
  if (stale) {
    const note = document.createElement("p");
    note.className = "wind-stale";
    note.textContent = "Wind data from " + asOfFormat.format(wind.asOf);
    controls.append(note);
  }
  container.after(controls);

  const layer = createWindLayer(map, wind, { hour: first, stale, reducedMotion, colors: COLORS[mode()] });

  function show(i) {
    const r = speedRange(wind, i);
    const text = hourLabel(wind.times[i]) + (r ? ", wind " + r.min + " to " + r.max + " mph" : "");
    out.textContent = text;
    range.setAttribute("aria-valuetext", text);
    layer.setHour(i);
  }
  range.addEventListener("input", () => show(Number(range.value)));
  show(first);
  return layer;
}

async function start() {
  if (!section || !container) return;
  const data = container.dataset;
  const missing = NEEDED.filter((k) => !data[k]);
  if (missing.length) {
    status("Interactive map unavailable: page is missing " + missing.join(", ") + ".");
    return;
  }
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Interactive map of Rockaway Beach, depth contours and wind");

  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mode = () => (darkQuery.matches ? "dark" : "light");
  const styleUrl = () => abs(mode() === "dark" ? data.styleDark : data.styleLight);

  let map;
  try {
    const moduleUrl = abs(data.maplibre);
    const mod = await import(moduleUrl);
    const maplibregl = mod.Map ? mod : mod.default;
    // MapLibre 6 starts this as a module worker; it must sit next to the main bundle.
    maplibregl.setWorkerUrl(new URL("maplibre-gl-worker.mjs", moduleUrl).href);
    const reader = await pmtilesGlobal();
    maplibregl.addProtocol("pmtiles", new reader.Protocol().tile);

    const [w, s, e, n] = data.bounds.split(",").map(Number);
    const padX = (e - w) * 0.25;
    const padY = (n - s) * 0.25;
    map = new maplibregl.Map({
      container,
      style: styleUrl(),
      bounds: [w, s, e, n],
      maxBounds: [w - padX, s - padY, e + padX, n + padY],
      minZoom: 11,
      maxZoom: 17,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: reducedMotion ? 0 : 300,
      attributionControl: { compact: true },
      // Style, glyph and data URLs may be same-origin paths; the worker needs them absolute.
      transformRequest: (url) => (url.startsWith("/") ? { url: location.origin + url } : { url }),
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  } catch (err) {
    console.error("map: could not start MapLibre", err);
    const noGL = /webgl/i.test(String(err && err.message));
    status("Interactive map unavailable: " + (noGL ? "this browser cannot use WebGL2." : "the map code did not load."));
    return;
  }

  map.on("error", (ev) => console.error("map:", ev && ev.error));
  map.on("style.load", () => addOverlays(map, COLORS[mode()]));
  map.once("idle", () => section.classList.add("map-ready"));

  let wind = null;
  darkQuery.addEventListener("change", () => {
    map.setStyle(styleUrl(), { diff: false });
    if (wind) wind.setColors(COLORS[mode()]);
  });

  map.once("load", () => {
    addWind(map, mode, reducedMotion)
      .then((layer) => {
        wind = layer;
      })
      .catch((err) => {
        console.error("map: wind layer failed", err);
        status("Wind field not available right now.");
      });
  });
}

start().catch((err) => {
  console.error("map: setup failed", err);
  status("Interactive map unavailable.");
});
