#!/usr/bin/env bash
# Rebuilds the self-hosted map client files:
#   assets/vendor/maplibre-gl/   MapLibre GL JS ESM build, worker, CSS, license
#   assets/vendor/pmtiles/       PMTiles browser reader (IIFE), license
#   assets/map/basemap.pmtiles   Protomaps basemap cut to the Rockaway box
#   assets/map/glyphs/           Noto Sans SDF glyph ranges, OFL license
#   assets/map/style-*.json      light and dark styles (scripts/map/build-styles.mjs)
#
# None of these packages enter package.json. They are fetched into a temp dir
# and copied. Needs: node/npm, curl, tar, shasum, and the pmtiles CLI.
#
# Protomaps deletes daily builds after about a week. To refresh the basemap,
# set PROTOMAPS_BUILD to a date listed at https://build.protomaps.com and
# update docs/map-client.md.
set -euo pipefail

MAPLIBRE_VERSION="6.12.0"
PMTILES_VERSION="4.5.0"
# pmtiles.js bundles fflate; its license ships next to the bundle.
FFLATE_VERSION="0.8.2"
# The pmtiles npm package has no LICENSE file; take it from the repository.
PMTILES_LICENSE_URL="https://raw.githubusercontent.com/protomaps/PMTiles/5897a82a16b233abac7b8f339c019b931c2bbf54/LICENSE"
BASEMAPS_VERSION="5.7.2"
BASEMAPS_ASSETS_COMMIT="028c18f713baecad011301ff7a69acc39bcc2ae7"
GLYPHS_BASE_URL="https://raw.githubusercontent.com/protomaps/basemaps-assets/${BASEMAPS_ASSETS_COMMIT}/fonts"
FONTS=("Noto Sans Regular" "Noto Sans Medium")
# 8192-8447 holds general punctuation: OSM names here use the en dash.
GLYPH_RANGES=("0-255" "256-511" "8192-8447")
PROTOMAPS_BUILD="20261003"
PROTOMAPS_URL="https://build.protomaps.com/${PROTOMAPS_BUILD}.pmtiles"
BBOX="-74.02,40.52,-73.70,40.66"
# 15 gave a 16 MB file; 14 keeps it near 5 MB. MapLibre overzooms past 14.
MAXZOOM="14"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR="${ROOT}/assets/vendor"
MAP="${ROOT}/assets/map"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

unpack() {
  # npm pack checks the tarball against the registry's integrity hash.
  local spec="$1" dest="$2"
  mkdir -p "${dest}"
  local tarball
  tarball="$(cd "${WORK}" && npm pack --silent "${spec}" | tail -n 1)"
  tar -xzf "${WORK}/${tarball}" -C "${dest}"
}

echo "maplibre-gl ${MAPLIBRE_VERSION}"
unpack "maplibre-gl@${MAPLIBRE_VERSION}" "${WORK}/maplibre"
rm -rf "${VENDOR}/maplibre-gl"
mkdir -p "${VENDOR}/maplibre-gl"
for f in maplibre-gl.mjs maplibre-gl-shared.mjs maplibre-gl-worker.mjs maplibre-gl.css; do
  cp "${WORK}/maplibre/package/dist/${f}" "${VENDOR}/maplibre-gl/${f}"
done
cp "${WORK}/maplibre/package/LICENSE.txt" "${VENDOR}/maplibre-gl/LICENSE.txt"

echo "pmtiles ${PMTILES_VERSION}"
unpack "pmtiles@${PMTILES_VERSION}" "${WORK}/pmtiles"
unpack "fflate@${FFLATE_VERSION}" "${WORK}/fflate"
rm -rf "${VENDOR}/pmtiles"
mkdir -p "${VENDOR}/pmtiles"
cp "${WORK}/pmtiles/package/dist/pmtiles.js" "${VENDOR}/pmtiles/pmtiles.js"
curl -fsSL "${PMTILES_LICENSE_URL}" -o "${VENDOR}/pmtiles/LICENSE"
cp "${WORK}/fflate/package/LICENSE" "${VENDOR}/pmtiles/LICENSE-fflate"

(cd "${VENDOR}" && shasum -a 256 maplibre-gl/* pmtiles/* > SHA256SUMS)

echo "glyphs at basemaps-assets ${BASEMAPS_ASSETS_COMMIT}"
rm -rf "${MAP}/glyphs"
for font in "${FONTS[@]}"; do
  mkdir -p "${MAP}/glyphs/${font}"
  encoded="${font// /%20}"
  for range in "${GLYPH_RANGES[@]}"; do
    curl -fsSL "${GLYPHS_BASE_URL}/${encoded}/${range}.pbf" -o "${MAP}/glyphs/${font}/${range}.pbf"
  done
done
curl -fsSL "${GLYPHS_BASE_URL}/OFL.txt" -o "${MAP}/glyphs/OFL.txt"

echo "basemap from ${PROTOMAPS_URL}"
mkdir -p "${MAP}"
rm -f "${MAP}/basemap.pmtiles"
pmtiles extract "${PROTOMAPS_URL}" "${MAP}/basemap.pmtiles" --bbox="${BBOX}" --maxzoom="${MAXZOOM}"

echo "styles from @protomaps/basemaps ${BASEMAPS_VERSION}"
unpack "@protomaps/basemaps@${BASEMAPS_VERSION}" "${WORK}/basemaps"
node "${ROOT}/scripts/map/build-styles.mjs" "${WORK}/basemaps/package"

echo
cd "${ROOT}"
find assets/vendor assets/map -type f ! -name '.*' | sort | while read -r f; do
  printf '%10d  %s  %s\n' "$(wc -c < "${f}")" "$(shasum -a 256 "${f}" | cut -c1-64)" "${f}"
done
