// The map page: the nearshore map, the wind now, what the map shows and where
// its data comes from. Without JavaScript, or until the interactive map has
// drawn, the static SVG is the map. The markup of the map section is a
// contract with assets/map.js; see "Map page and client contract" in the plan
// and docs/map-client.md.

import { fromNow } from "../chart.js";
import { escapeHtml } from "../html.js";
import { MAP_FACTS } from "../mapFacts.js";
import type { SiteModel } from "../model.js";
import type { MapAssets, PageContext } from "./context.js";
import { page } from "./layout.js";
import { compass, staleAsOf, windWord } from "./parts.js";

const facts = MAP_FACTS;

/** "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function streetsText(): string {
  return list(facts.streetLabels.slice().sort((a, b) => a - b).map((n) => `Beach ${n}`));
}

function depthRange(): string {
  const d = facts.depthsFt;
  return `${d[0] ?? 0} to ${d[d.length - 1] ?? 0} ft`;
}

const CAPTION =
  `Depths in feet below mean lower low water. ${facts.survey}. Not for navigation. ` +
  `Sandbars move with every storm; this is a snapshot, not today's bottom.`;

const ATTRIBUTION =
  `Depths: NOAA BlueTopo (public domain). ` +
  `Shore and basemap: <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a> (ODbL), ` +
  `basemap by <a href="https://protomaps.com">Protomaps</a>.`;

function altText(): string {
  return (
    `Map of the Rockaway shore, turned so the beach runs across with the ocean below. ` +
    `It shows depth lines from ${depthRange()}, ${facts.jetties} jetties, the boardwalk, ` +
    `and street ends labelled ${streetsText()}. The same facts are listed under the map.`
  );
}

function mapSection(m: MapAssets): string {
  const data: Array<[string, string]> = [
    ["style-light", m.styleLight],
    ["style-dark", m.styleDark],
    ["maplibre", m.maplibre],
    ["bathymetry", m.bathymetry],
    ["land", m.land],
    ["shore", m.shore],
    ["wind", m.wind],
    ["bounds", facts.bounds.join(",")],
  ];
  const attrs = data.map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join("");
  return (
    `<section class="map" aria-label="Rockaway nearshore map">` +
    `<div class="map-canvas" id="map-canvas"${attrs}></div>` +
    `<figure class="map-fallback">` +
    `<div class="map-scroll" tabindex="0" role="region" aria-label="Static map, scrolls sideways on a small screen">` +
    `<img src="${escapeHtml(m.staticSvg)}" alt="${escapeHtml(altText())}" width="${facts.width}" height="${facts.height}">` +
    `</div>` +
    `<figcaption>${escapeHtml(CAPTION)}</figcaption>` +
    `</figure>` +
    `<p class="map-credit">${ATTRIBUTION}</p>` +
    `</section>`
  );
}

function unavailable(): string {
  return (
    `<section class="map" aria-label="Rockaway nearshore map">` +
    `<p class="plain">The map is unavailable right now. The facts it shows are listed below.</p>` +
    `<p class="map-credit">${ATTRIBUTION}</p>` +
    `</section>`
  );
}

function windNow(model: SiteModel): string {
  const hour = fromNow(model.hours, model.nowStamp, 1)[0];
  const staleAt = model.forecastState === "stale" ? model.fetchedAt.forecast : undefined;
  let line: string;
  if (hour?.kind === "data") {
    const w = windWord(hour.windDirection);
    line =
      `Now: <span class="num">${Math.round(hour.windSpeed)}</span> mph from the ${compass(hour.windDirection)}, ` +
      `<span class="v-${w.cls}">${w.text}</span>.`;
  } else {
    line = hour === undefined ? "Now: wind not loaded yet." : "Now: no wind forecast for this hour.";
  }
  return (
    `<section aria-labelledby="h-wind"><h2 id="h-wind" class="label">Wind</h2>` +
    `<p class="wind-now${staleAt !== undefined ? " stale" : ""}">${line}` +
    (staleAt !== undefined ? staleAsOf(staleAt) : "") +
    `</p>` +
    `<p class="plain">The moving wind field on the map needs JavaScript. ` +
    `It draws the same forecast, one hour at a time.</p></section>`
  );
}

function keySection(): string {
  return (
    `<section class="prose" aria-labelledby="h-key"><h2 id="h-key" class="label">What's on the map</h2>` +
    `<ul>` +
    `<li>Depth lines at ${escapeHtml(list(facts.depthsFt.map(String)))} ft below mean lower low water, ` +
    `light blue for shallow water and dark for deep.</li>` +
    `<li>${facts.jetties} rock jetties, drawn as short thick lines.</li>` +
    `<li>The boardwalk, dashed.</li>` +
    `<li>Street ends labelled ${escapeHtml(streetsText())}. On the map, B90 is Beach 90th Street.</li>` +
    `</ul>` +
    `<p>The depth lines show where the bottom drops off. They do not show single sandbars or the troughs beside each jetty: ` +
    `the surveys are years old and sandbars move with every storm. Check the water before you paddle out.</p>` +
    `</section>`
  );
}

function sourcesSection(): string {
  const items = facts.sources
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>. ${escapeHtml(s.license)}. ` +
        `Retrieved ${escapeHtml(s.retrieved)}.` +
        (s.surveyDates !== null ? ` Survey dates: ${escapeHtml(s.surveyDates)}` : "") +
        `</li>`,
    )
    .join("");
  return (
    `<section class="prose" aria-labelledby="h-map-sources"><h2 id="h-map-sources" class="label">Map sources</h2>` +
    `<ul class="sources">${items}</ul>` +
    `<p>Wind from <a href="https://open-meteo.com/">Open-Meteo.com</a> ` +
    `(<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>).</p></section>`
  );
}

export function renderMap(model: SiteModel, ctx: PageContext): string {
  const m = ctx.assets.map;
  const head =
    m === undefined
      ? ""
      : `<link rel="stylesheet" href="${escapeHtml(m.maplibreCss)}">` +
        `<script src="${escapeHtml(m.pmtiles)}" defer></script>` +
        `<script type="module" src="${escapeHtml(m.client)}"></script>`;
  const body =
    `<h1 class="page-title">Nearshore map</h1>` +
    `<p class="lede">The bottom off Rockaway from the tip of Breezy Point to about Beach 35th Street: depth lines, jetties, the boardwalk and street ends. ` +
    `The moving wind is a forecast for a grid of points over the water off Rockaway, one hour at a time. ` +
    `The depths come from surveys, not from today's bottom.</p>` +
    (m === undefined ? unavailable() : mapSection(m)) +
    windNow(model) +
    keySection() +
    sourcesSection();
  return page(ctx, {
    title: "Map - Rockaway surf report",
    description: "Nearshore map of Rockaway Beach: depth lines, jetties, street ends and the wind now.",
    path: "/map",
    current: "map",
    head,
    body,
  });
}
