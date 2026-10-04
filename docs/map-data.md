# Map data: depth contours and land outline

The nearshore map is drawn from two committed GeoJSON files in `data/map/`. The script `scripts/map/build-bathymetry.sh` builds both. They cover lon -73.96 to -73.76 and lat 40.545 to 40.605: the ocean side of the Rockaway Peninsula from Breezy Point to Beach 9th, about 2 km offshore, plus the Jamaica Bay side of the peninsula that falls inside the same box. Coordinates are WGS84 lon/lat with at most 6 decimals.

| File | Contents | Limit |
| --- | --- | --- |
| `bathymetry.geojson` | One MultiLineString per depth, property `depthFt` (feet below mean lower low water) | 600 KB |
| `land.geojson` | Polygons of the area above mean high water, property `kind: "land"` | 200 KB |
| `SOURCES.json` | Where the data comes from, its version, survey dates and datum | |

## Sources

Underwater: NOAA BlueTopo, the National Bathymetric Source, at 4 m. It merges the best available surveys and keeps a per-cell record of which survey each cell comes from. In the surf zone about half the cells come from a USGS multibeam survey of May 2023. Most of the rest come from NOAA surveys of 2009 and 2013 and USACE lidar of 2017. `SOURCES.json` has the breakdown.

On land: NOAA NCEI CUDEM at 1/9 arc-second (about 3 m), from about 2014. BlueTopo stops near the waterline, so CUDEM fills the land so that the land outline is complete. Where the two meet, the beach edge of the land outline can follow BlueTopo's coverage edge for a few metres.

The NCEI Coastal Relief Model (about 30 m) was not used: both sources above are about ten times finer. CUDEM alone was the other option for the water too, but its nearshore surveys are older than BlueTopo's.

Both rasters are read remotely with GDAL (`/vsicurl/`), so the build fetches only the parts that cover the box.

## Datum conversion

Both rasters give heights above NAVD88 in metres. Depth charts and tide tables use mean lower low water (MLLW), so the contours are converted:

- NAVD88 0 m is 0.845 m (2.77 ft) above MLLW. Depth in feet below MLLW = (-height - 0.845) / 0.3048.
- Mean high water (MHW) is 0.603 m (1.98 ft) above NAVD88. Land is every cell higher than that.

Both numbers come from NOAA VDatum at -73.86, 40.57, the middle of the beach. Along the beach the MLLW offset changes by less than 0.3 ft, so one constant is used for the whole box. The tide station named in the forecast (8517137, Beach Channel) publishes MHW and MLLW but no NAVD88 value, and it is on the bay side, where the tide range is about 0.9 ft larger than on the ocean beach. It could not give the offset.

## Contours

Contours are every 2 ft from 2 to 20 ft, then every 10 ft to 60 ft. Before contouring, the merged raster is smoothed with two passes of a 5 by 5 gaussian filter (about 10 m), which removes pixel noise but keeps bars and troughs, which are 50 m or more across. Closed loops shorter than 30 m are dropped. Lines are simplified with a 0.00007 degree tolerance (about 6 to 8 m). A finer tolerance of 0.00002 degrees gives a 1.2 MB file that looks the same at map scale, because the source surveys are already gridded at 4 m.

## Rebuild

Needs GDAL with SpatiaLite and the `gdal raster` subcommands (tested with GDAL 3.13.3), bc, and network access.

```
bash scripts/map/build-bathymetry.sh
```

The build is deterministic: the same pinned inputs give byte-identical files. To keep the intermediate rasters, set `WORK_DIR=/some/dir`. When NOAA publishes a new BlueTopo tile, its file name changes. Update the tile list at the top of the script, rebuild, and update `SOURCES.json`.

## Limits

- The surveys are snapshots, years old in places. Sandbars and the troughs beside the jetties move with every storm and through each season, so the map shows the bottom as it was surveyed, not as it is today.
- The surf zone (0 to about 6 ft deep) is the hardest place to survey. It is filled from lidar and edge-of-survey data and is the least reliable part of the map.
- Depths are rounded to the contour interval and smoothed over about 10 m.
- Not for navigation.
