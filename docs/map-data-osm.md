# Map data: shore features from OpenStreetMap

`data/map/shore.geojson` holds the shoreline features surfers navigate by on Rockaway's ocean side. `scripts/map/build-shore.mjs` builds it from OpenStreetMap through the Overpass API, and also writes the source entry `data/map/SOURCES-osm.json`.

## What is extracted

The area is lon -73.96 to -73.76, lat 40.545 to 40.605. In OSM data that runs from Beach 25th Street in the east to the Breezy Point jetty in the west. Each feature has `kind`, an optional `name`, and `osmId` (`way/<id>`). Coordinates are WGS84 lon/lat with at most 6 decimals, clipped to the box, sorted by kind and then OSM id.

- `jetty`: `man_made=groyne` and `man_made=breakwater`, plus any `man_made=pier` built of stone, boulder or rock. Rockaway's rock jetties are tagged `groyne`.
- `pier`: other `man_made=pier` ways. The current extract has none on the ocean shore; the bay side has many docks, which are left out.
- `boardwalk`: paths named "Boardwalk", "Ocean Promenade" or "Jacob Riis Boardwalk", and wooden footways (`surface=wood` or `boardwalk`) with 5 or more nodes. Every vertex inside the box must lie within 250 m of the ocean shoreline. In OSM the Rockaway walk is `highway=path`, `surface=concrete`, named "Boardwalk" from the east edge to about Beach 109th Street and "Ocean Promenade" from there to Beach 126th Street. No way in the box carries the name "Rockaway Beach Boardwalk".
- `street-end`: one Point per "Beach NN Street" (or "Beach NNth Street"), named in "Beach 90th St" form. The point is the street's node shared with the boardwalk nearest the ocean shoreline; a street that does not meet the boardwalk gets its vertex nearest the ocean shoreline. Every street is kept. Some streets only exist north of the beach, so their point sits inland.

The ocean side is decided from `natural=coastline`. A coastline segment with no other coastline due south of it is ocean shoreline. A jetty or pier is kept when its southernmost vertex has no coastline due south of it, or when it comes within 30 m of the ocean shoreline. This drops the docks and breakwaters in Jamaica Bay and Rockaway Inlet. The Brooklyn shore across the inlet (west of -73.91 and north of 40.566: Coney Island and Manhattan Beach) also faces the ocean and is dropped by that rule.

## Overpass query

```
[out:json][timeout:150][bbox:40.545,-73.96,40.605,-73.76];
(
  way["man_made"~"^(groyne|breakwater|pier)$"];
  way["highway"]["name"~"boardwalk|ocean promenade",i];
  way["highway"="footway"]["surface"~"^(wood|boardwalk)$"];
  way["highway"]["name"~"^Beach [0-9]+(st|nd|rd|th)? Street$"];
  way["natural"="coastline"];
);
out body geom;
```

## Rebuild

```
node scripts/map/build-shore.mjs
```

Node 22 or later, no dependencies. The script POSTs the query to `https://overpass-api.de/api/interpreter` with a 180 s timeout and retries twice on HTTP 429, 502, 503 or 504. It exits non-zero without writing anything on any other HTTP error, a timeout, an Overpass error remark, or when it finds no jetties or no street ends. Output is written to a temp file and renamed into place. The same OSM data gives a byte-identical `shore.geojson`; `SOURCES-osm.json` records the retrieval date and the Overpass `osm3s.timestamp_osm_base` as `version`.

After a rebuild, run `npx vitest run tests/shoreData.test.ts` and check the diff of `shore.geojson` before committing.

## License and attribution

OpenStreetMap data is under the Open Database License 1.0 (ODbL). Any page that shows this data, or a map drawn from it, must show "© OpenStreetMap contributors" visibly on that page, in the map caption, not hidden behind a control. Link it to https://www.openstreetmap.org/copyright. `shore.geojson` is a derived database and stays under ODbL.
