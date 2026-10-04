#!/usr/bin/env bash
# Builds the Rockaway nearshore depth contours and land outline:
#   data/map/bathymetry.geojson  depth contours, property depthFt (feet below MLLW)
#   data/map/land.geojson        area above mean high water, property kind = "land"
#
# Tested with GDAL 3.13.3. Needs gdalwarp, gdal_contour, gdal_polygonize.py, ogr2ogr
# with SpatiaLite, the `gdal raster` subcommands, bc and network access. The
# rasters are read remotely through /vsicurl/, so only the blocks that cover the
# box are fetched, not whole tiles.
#
# Run from the repo root: bash scripts/map/build-bathymetry.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# Pinned inputs. Change these on purpose, then rebuild and update SOURCES.json.
# ---------------------------------------------------------------------------

# Output box (WGS84 lon/lat): Rockaway's ocean side, Beach 9th to Beach 149th,
# plus about 2 km offshore.
WEST=-73.97
EAST=-73.76
SOUTH=40.525
NORTH=40.605
# Work on a slightly larger box so smoothing and contour lines do not bend at
# the edges, then clip to the output box at the end.
MARGIN=0.005

# NOAA BlueTopo (National Bathymetric Source), 4 m, UTM 18N, NAVD88 metres.
# Each file name carries its release date, so a URL is one fixed version.
# Tile list from BlueTopo_Tile_Scheme_20261001_163003.gpkg, filtered to the box.
BLUETOPO_BASE=https://noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com/BlueTopo
BLUETOPO_TILES=(
  BH4XD5FH/BlueTopo_BH4XD5FH_20260831.tiff
  BH4XD5FJ/BlueTopo_BH4XD5FJ_20260831.tiff
  BH4XF5FH/BlueTopo_BH4XF5FH_20260831.tiff
  BH4XF5FJ/BlueTopo_BH4XF5FJ_20260831.tiff
  BH4XG5FH/BlueTopo_BH4XG5FH_20260728.tiff
  BH4XG5FJ/BlueTopo_BH4XG5FJ_20260831.tiff
  BH4XH5FH/BlueTopo_BH4XH5FH_20260713.tiff
  BH4XH5FJ/BlueTopo_BH4XH5FJ_20260713.tiff
)

# NOAA NCEI CUDEM 1/9 arc-second topobathy (about 3 m), NAVD88 metres. BlueTopo
# stops at the waterline; CUDEM fills the land so the land outline is complete.
CUDEM_URL=https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/northeast_sandy/ncei19_n40x75_w074x00_2015v1.tif

# Tidal datums relative to NAVD88, in metres, from NOAA VDatum at the middle of
# the beach (-73.86, 40.57). The query that gives them:
VDATUM_QUERY='https://vdatum.noaa.gov/vdatumweb/api/convert?s_x=-73.86&s_y=40.57&s_z=0&s_h_frame=NAD83_2011&s_coor=geo&s_v_frame=NAVD88&s_v_unit=m&t_h_frame=NAD83_2011&t_v_frame=MLLW&t_v_unit=m&region=contiguous'
# (t_v_frame=MHW for the second value.) Along the beach the values change by
# less than 8 cm, so one constant is used for the whole box.
MLLW_BELOW_NAVD88_M=0.845   # NAVD88 0 m is 0.845 m above MLLW
MHW_ABOVE_NAVD88_M=0.603    # MHW is 0.603 m above NAVD88 0 m

# Contour depths in feet below MLLW.
DEPTHS_FT=(2 4 6 8 10 12 14 16 18 20 30 40 50 60)

# Douglas-Peucker tolerances in degrees (0.00007 deg is about 6 m east-west and 8 m north-south here).
CONTOUR_SIMPLIFY_DEG=${CONTOUR_SIMPLIFY_DEG:-0.00007}
LAND_SIMPLIFY_DEG=${LAND_SIMPLIFY_DEG:-0.00003}
# Closed contour loops shorter than this are noise, not features.
MIN_LOOP_M=30
# Land specks smaller than this many pixels are removed before polygonizing.
LAND_SIEVE_PX=40

# Grid: 1/9 arc-second, the CUDEM pixel size, in degrees.
RES=0.0000308641975

OUT_DIR=${OUT_DIR:-data/map}

# ---------------------------------------------------------------------------

for tool in gdalbuildvrt gdalwarp gdal_translate gdal_contour gdal_polygonize.py ogr2ogr gdal bc; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
[ -d .git ] || [ -f .git ] || { echo "run from the repo root" >&2; exit 1; }

# Intermediate rasters go to a temp dir that is removed on exit. Set WORK_DIR
# to keep them in $WORK_DIR/bathymetry-work (for example to inspect smooth.tif).
if [ -n "${WORK_DIR:-}" ]; then
  TMP=$WORK_DIR/bathymetry-work
  rm -rf "$TMP" && mkdir -p "$TMP"
else
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
fi

W=$(echo "$WEST - $MARGIN" | bc -l)
E=$(echo "$EAST + $MARGIN" | bc -l)
S=$(echo "$SOUTH - $MARGIN" | bc -l)
N=$(echo "$NORTH + $MARGIN" | bc -l)
BOX_WKT="POLYGON(($WEST $SOUTH,$EAST $SOUTH,$EAST $NORTH,$WEST $NORTH,$WEST $SOUTH))"

echo "1. Mosaic BlueTopo elevation band (band 1) from the pinned tiles"
bt_inputs=()
for t in "${BLUETOPO_TILES[@]}"; do bt_inputs+=("/vsicurl/$BLUETOPO_BASE/$t"); done
gdalbuildvrt -q -b 1 "$TMP/bluetopo.vrt" "${bt_inputs[@]}"

echo "2. Merge onto one NAD83 lon/lat grid: CUDEM first, BlueTopo on top where it has data"
# -novshift: both inputs are already NAVD88 heights. Without it GDAL converts
# the compound CRS to ellipsoid heights (about 33 m off here).
# Both sources are NAD83 (CUDEM geographic, BlueTopo UTM 18N), so warping to
# NAD83 geographic is a plain inverse projection with no datum shift.
gdalwarp -q -overwrite -novshift \
  -t_srs EPSG:4269 -te "$W" "$S" "$E" "$N" -tr "$RES" "$RES" -r bilinear \
  -srcnodata "-99999" -dstnodata -99999 -ot Float32 \
  "/vsicurl/$CUDEM_URL" "$TMP/merged.tif"
gdalwarp -q -novshift -r bilinear -srcnodata nan \
  "$TMP/bluetopo.vrt" "$TMP/merged.tif"
# Label the grid WGS84. NAD83 and WGS84 differ by about 1 m here, far below
# what a surf map can show, and this is the standard null transform
# (EPSG:1188). Relabelling avoids GDAL picking different NAD83 to WGS84
# grid shifts for the New York and New Jersey parts of the box.
gdal raster edit -q --crs EPSG:4326 "$TMP/merged.tif"

echo "3. Smooth with two passes of a 5x5 gaussian (about 10 m) to remove pixel noise"
# Bars and troughs are 50 to 300 m across, so this keeps them and removes the
# stair-step edges and single-pixel survey noise that make jagged contours.
gdal raster neighbors -q --kernel gaussian --size 5 --method mean \
  --nodata -99999 --ot Float32 -i "$TMP/merged.tif" -o "$TMP/smooth1.tif"
gdal raster neighbors -q --kernel gaussian --size 5 --method mean \
  --nodata -99999 --ot Float32 -i "$TMP/smooth1.tif" -o "$TMP/smooth.tif"

echo "4. Contour at the chosen depths, converted to NAVD88 metres"
# gdal_contour wants increasing levels, so walk the depths from deepest up.
levels=()
for (( i=${#DEPTHS_FT[@]}-1; i>=0; i-- )); do
  ft=${DEPTHS_FT[$i]}
  levels+=("$(printf '%.4f' "$(echo "-($ft * 0.3048) - $MLLW_BELOW_NAVD88_M" | bc -l)")")
done
gdal_contour -q -a elev -snodata -99999 -fl "${levels[@]}" \
  "$TMP/smooth.tif" "$TMP/contours.gpkg"
# The SQL below runs inside a SpatiaLite database because GeodesicLength needs
# its spatial_ref_sys table.
ogr2ogr -q -f SQLite -dsco SPATIALITE=YES -lco GEOMETRY_NAME=geom \
  "$TMP/work.sqlite" "$TMP/contours.gpkg" -nln contour_raw

echo "5. Name each line by depth, drop tiny closed loops, simplify, clip to the box"
# depthFt goes back from the NAVD88 level to whole feet below MLLW.
ogr2ogr -q -update -lco GEOMETRY_NAME=geom "$TMP/work.sqlite" "$TMP/work.sqlite" \
  -nln contour_simple -nlt MULTILINESTRING \
  -clipdst "$WEST" "$SOUTH" "$EAST" "$NORTH" -sql "
    SELECT CAST(ROUND((-elev - $MLLW_BELOW_NAVD88_M) / 0.3048) AS INTEGER) AS depthFt,
           ST_SimplifyPreserveTopology(geom, $CONTOUR_SIMPLIFY_DEG) AS geom
    FROM contour_raw
    WHERE NOT (ST_IsClosed(geom) AND GeodesicLength(geom) < $MIN_LOOP_M)"
# One MultiLineString per depth keeps the file small and the order stable.
ogr2ogr -q -f GeoJSON "$TMP/bathymetry.geojson" "$TMP/work.sqlite" \
  -lco RFC7946=YES -lco COORDINATE_PRECISION=6 -lco WRITE_NAME=NO -nln bathymetry \
  -sql "
    SELECT depthFt AS "depthFt", ST_Multi(ST_Collect(geom)) AS geom
    FROM contour_simple
    WHERE geom IS NOT NULL AND GeodesicLength(geom) > 0
    GROUP BY depthFt ORDER BY depthFt"

echo "6. Land mask: cells above mean high water, with small specks removed"
gdal raster reclassify -q --ot UInt8 \
  -m "[-inf,$MHW_ABOVE_NAVD88_M]=0; ($MHW_ABOVE_NAVD88_M,inf]=1" \
  -i "$TMP/smooth.tif" -o "$TMP/land_mask0.tif"
# The input's -99999 nodata value is carried over and means nothing on a 0/1 mask.
gdal_translate -q -a_nodata none "$TMP/land_mask0.tif" "$TMP/land_mask.tif"
gdal raster sieve -q --size-threshold "$LAND_SIEVE_PX" --connect-diagonal-pixels \
  -i "$TMP/land_mask.tif" -o "$TMP/land_sieved.tif"

echo "7. Polygonize the mask, merge, simplify, clip to the box"
gdal_polygonize.py -q -8 "$TMP/land_sieved.tif" -f GPKG "$TMP/land_raw.gpkg" land value
ogr2ogr -q -update -lco GEOMETRY_NAME=geom "$TMP/work.sqlite" "$TMP/land_raw.gpkg" \
  -nln land_raw -where "value = 1"
ogr2ogr -q -f GeoJSON "$TMP/land.geojson" "$TMP/work.sqlite" \
  -lco RFC7946=YES -lco COORDINATE_PRECISION=6 -lco WRITE_NAME=NO -nln land \
  -explodecollections -nlt POLYGON -sql "
    SELECT 'land' AS kind,
           ST_Intersection(
             ST_SimplifyPreserveTopology(ST_Union(geom), $LAND_SIMPLIFY_DEG),
             ST_GeomFromText('$BOX_WKT', 4326)) AS geom
    FROM land_raw"

echo "8. Copy the results into $OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$TMP/bathymetry.geojson" "$OUT_DIR/bathymetry.geojson"
cp "$TMP/land.geojson" "$OUT_DIR/land.geojson"
ls -l "$OUT_DIR/bathymetry.geojson" "$OUT_DIR/land.geojson"
