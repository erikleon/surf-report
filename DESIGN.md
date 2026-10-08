# Design System: surf-report

## Product Context
- **What this is:** A public, no-login surf forecast for Rockaway Beach, NYC. One beach, one local voice.
- **Who it's for:** Local surfers who check a phone before dawn and again on the sand. Surfers only: the site assumes swell period is understood and does not explain it.
- **Space/industry:** Surf forecasting. Peers: SurfCaptain, Surf-Forecast, Windguru, Windfinder, Surfline. Magicseaweed (closed May 2023) is the layout reference.
- **Project type:** Data-first web app, server-rendered, mobile-first. Not a marketing site.
- **The memorable thing:** It is the Rockaway local's page. No national site can copy that, so local identity outranks feature count.

## Aesthetic Direction
- **Direction:** Harbor chart. NOAA chart-paper feel with an editorial voice.
- **Decoration level:** Minimal. Hairline rules, a tide-line motif. No photography behind data.
- **Mood:** Calm, exact, a little salty. A well-used paper chart, not a dashboard and not a brand campaign.
- **Reference sites:** surfcaptain.com (maritime blue `#005384`, three-tab nav, drill-down location menu), Magicseaweed (hour-by-hour table: Surf, Swell, Period, Wind, Rating; solid and faded stars). The Wayback Machine could not be loaded during research, so the Magicseaweed layout comes from its published "Reading Your Forecast" guide.

## Typography
- **Display/Hero:** Instrument Serif. Break names, the daily headline, day headings. No other surf site uses a serif, and it carries the local voice.
- **Body:** Geist. Plain, legible at small sizes.
- **UI/Labels:** Geist, 500 weight, small caps off, `0.62rem` to `0.75rem` section labels.
- **Data/Tables:** Geist with `font-variant-numeric: tabular-nums`. Every number in a column lines up.
- **Code:** not used.
- **Loading:** Self-hosted WOFF2, served from the site's own `/assets/`. No Google Fonts request from any page. Both families are SIL OFL licensed.
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40 px. Body 16. Table cells 14. Section labels 12. Daily headline 28 on phone, 40 on desktop.

## Color
- **Approach:** Restrained. One blue, one paper, one ink. Colour carries information.
- **Paper (background):** `#F2EEE4` light, `#0B1820` dark.
- **Ink (text):** `#0F2230` light, `#E8E4D8` dark.
- **Sea (primary):** `#1F5F7A` light, `#5FA8C4` dark. Links, solid stars, chart area.
- **Foam (surface):** `#DCE6E4` light. Row banding and chart ground. Dark uses `#122630`.
- **Semantic, light:** good `#287052`, poor `#A63D40`, stale `#C98A12`, info is the sea blue.
- **Semantic, dark:** good `#52B38A`, poor `#E07A7D`, stale `#C98A12`.
- **Measured contrast (WCAG ratio):** light: ink on paper 14.03, sea on paper 6.09, good on paper 5.14, poor on paper 5.39. Dark: text on bg 14.17, sea on bg 6.76, good on bg 7.01, poor on bg 6.22, amber on bg 6.11.
- **Amber fails as text on light paper (2.54).** Stale text is always set in ink. Amber appears only as a 3px rule above the text and a small square marker by the as-of time. On the dark background amber passes (6.11), but the same rule-and-marker form is used in both modes so the two look alike.
- **Marginal:** ink at 40% opacity. It is neither a colour nor amber: a marginal hour reads dim, which is honest, nothing special.
- **Amber is stale only.** It is never decoration and never a rating colour. A stale reading must not look current, and amber is what says so.
- **Green is offshore or good. Red is onshore or a fault.** Do not spend either on decoration.
- **Dark mode:** Redesigned surfaces, not inverted. Saturation cut about 15 percent. Follows `prefers-color-scheme`; light is the fallback. Both variants get designed and checked.
- **Contrast:** Body text and every data value meet WCAG AA (4.5:1). Check the stale amber on both backgrounds before shipping.

## Spacing
- **Base unit:** 4px.
- **Density:** Comfortable-dense. Table rows about 44px so a thumb can hit them.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined.
- **Grid:** 1 column under 640px, a 7-day table from 900px. The 48 hour chart sits above the table on every width.
- **Max content width:** 1040px.
- **Border radius:** sm 2px, md 4px. Square-ish on purpose, like chart paper. No pill shapes and no uniform bubbly radius.

## The rating
- **Solid and faded stars (Magicseaweed's idea, kept).** Solid stars show what the swell supports. Faded stars show what the wind took away. The reason is always available on tap, in the `surfCall.ts` form: "onshore 15 mph", "dark", "too small, 0.8 ft".
- **Thresholds are taste, not fact.** The star mapping is new tuning on top of the good, marginal and poor thresholds copied from `oneeightsix`. Tune it in one place after watching it against real sessions.
- **Stars never use amber or red.** They are ink and sea blue only.
- **Stars nest inside the three levels of the hourly call.** Poor is 0 or 1 star, marginal is 2 or 3, good is 4 or 5. Wave size and period choose the star within a level. The band and the stars cannot disagree, and a poor hour never shows 4 stars.
- **The call is hidden when its inputs are stale.** The threshold is two missed refreshes plus the edge TTL. The page falls back to raw numbers, each with an absolute as-of time.

## Components
- **The call:** one large Instrument Serif word ("Worth it", "Marginal" or "Not today"), a stars row, one reason line, then a row of hour cells. There is no "6 to 9am" window: the cells show when. The word, stars and reason come from the best remaining daylight hour. The absolute "as of" time is printed directly under the word, because a cached page can be a few minutes old and the claim and its age should sit together. Sits on hairline rules. No box, fill or shadow.
- **Hour cells:** one cell per remaining daylight hour today, coloured good, marginal or poor with the same tokens as the chart band, labelled every three hours. A no-data hour uses the shaded no-data fill. After sunset the row shows tomorrow's daylight hours.
- **Now strip:** one row of four label-over-value columns divided by rules.
- **Stale banner:** one line with an amber rule above it. Text only, no icon.
- **Week table:** tabular numerals, 3-hour rows, rules between rows, foam banding on alternate days.
- **Top nav:** four text items (Today, Week, Map, About), underlined when current.
- **No cards.** Tappable rows keep 44px of vertical padding and underlined links, since there is no box to signal that they can be tapped.

## Local identity
- The header names the stretch (Beach 67th to Beach 116th) and the A train. Break names appear as labels and notes only.
- **The forecast is one grid point for all of Rockaway.** Never show per-break wave numbers. They would be invented. A break name may carry a text note, never a separate forecast.
- Local notes need a human to keep them current. A note older than its stated date reads as stale.

## Motion
- **Approach:** Minimal-functional. Only the scrubber, the "now" return and focus changes move.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms). Nothing runs longer than 250ms.
- `prefers-reduced-motion` removes all of it.

## Rules that are load-bearing
Carried over from `oneeightsix`, where each one was learned the hard way.
- **No third-party requests from the page.** Fonts are self-hosted. A viewer's browser talks to this site and nothing else.
- **Stale must never look current.** Show an absolute "as of 6:15 AM", not "2 min old". Edge-cached HTML would freeze a relative age. The stale threshold is the edge cache TTL plus the refresh interval.
- **The scrubber selects, it never decides.** It picks among values the server already rendered. It does not fetch, interpolate or judge staleness.
- **No-data hours are drawn, not hidden.** An hour the forecast does not cover keeps its place on the axis. The wave and period lines bridge it with a dashed line at the average of the nearest known hours, over a shaded cell with its own "no data" fill. The bridge is a drawing aid for the chart only. The readout for that hour says "No forecast for this hour", shows no numbers, and the call is not scored. At the start or end of the series there is nothing to average, so the line stops and only the shade shows. The shade is ground, like night shading, and does not count against the three-series budget.
- **`touch-action: pan-y` stays on the chart**, so a swipe scrolls the page instead of scrubbing.
- **A visually hidden `<input type="range">` labelled "forecast hour" is required**, synced with the pointer scrub. It is the only keyboard and screen reader path to the timeline.
- **The readout is pinned above the chart, never a tooltip.** A finger covers the hour it selects.
- **At most three continuous series plus one categorical band per chart.** The three are wave height (area), period (dashed line) and tide (muted line, in its own short panel under the plot). Wind is a row of arrows. Everything else goes in the readout.
- **The wave height axis is 0 to 6 ft by default.** It widens only when a forecast wave passes 5.5 ft, to the next even foot above the tallest wave plus 10 percent.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-08 | Tide is a line in its own panel under the surf chart; wave axis defaults to 6 ft | Requested by the owner. The tide has its own scale because feet of tide and feet of swell do not compare, and low tides flattened on the swell axis; the playhead runs through both panels. Replaces the earlier rule that kept the tide in the readout only. A fixed 6 ft default keeps small days looking small. |
| 2026-10-03 | Initial design system created | /design-consultation, after reading the SurfCaptain page and Magicseaweed's published guide. The house Limestone system is for a private dashboard and does not fit a public ratings site. |
| 2026-10-03 | Surfers only, no beginner layer | Keeps the page dense and fast. Swell period is assumed. |
| 2026-10-03 | Local identity is the memorable thing | A single-beach site can do what national sites cannot. |
| 2026-10-03 | Solid and faded stars, reasons on tap | Keeps Magicseaweed's best idea and matches the "every verdict shows its rule" principle from `oneeightsix`. |
| 2026-10-03 | Light default, designed dark variant | Reads in glare on the sand. Differs from the dark-default house site. |
| 2026-10-03 | No per-break wave numbers | The upstream is one grid point. Per-break figures would be made up. |
| 2026-10-03 | Stale text is ink with an amber rule and marker | Amber on light paper measured 2.54:1, below AA. Good and poor were also below AA on one background each and were adjusted. |
| 2026-10-03 | The call is hidden when stale; no cards on the first screen; stars nest inside the three levels | /plan-design-review. See the plan file for the reasoning. |
| 2026-10-03 | Preview page skipped | User chose to write the file directly. Type and contrast are unchecked on a real screen. |
| 2026-10-04 | Maps: contour lines, not filled bands | The contours are open lines cut by the data box, the shore and survey gaps, so filled bands would be wrong in places. Lines are stroked in the sea-blue ramp (shallow light, deep dark), not ink, so depth still reads as a ramp. |
| 2026-10-04 | Maps: the static map is turned 17 degrees | The shore runs about 17 degrees north of east. Turning the map lays the beach across with the ocean below, and a north arrow shows the turn. The frame runs from Fort Tilden to about Beach 35th; Breezy Point is left out to keep the surf zone readable. |
| 2026-10-04 | Maps: the static map reaches the tip of Breezy Point | Asked for by the owner. The frame now starts at the last jetty on the point, about 8.1 km west of its origin, and the depth data was rebuilt over a box reaching 40.525 N so the turned frame's corner off the point is surveyed water, not a blank. |
| 2026-10-04 | Maps: street labels by a spacing rule | Beach 67th and 116th (the stretch ends) are tried first, then every tenth street; a label is kept only if its box stays 6 units clear of every kept label. Labels read "B90"; the legend says what that means. |
| 2026-10-04 | Maps: fonts named, not loaded | An SVG in an `<img>` cannot load web fonts, so its text names Geist and Instrument Serif with Arial and Times fallbacks and stays short. The caption is repeated as HTML under the image. |

## Maps
- **The static nearshore map is built** (`assets/map/nearshore.svg`, drawn by `src/mapSvg.ts`). It is the `/map` page's content without JavaScript and the fallback for the interactive map.
- **Depth is a sequential ramp of the sea blue.** Shallow is foam, deep is the darkest sea blue. Contours are hairlines stroked in that ramp (filled bands would be wrong where contours do not close), labelled in feet in Geist. The datum (mean lower low water) is in the caption.
- **Always show the survey date and "not for navigation".** Sandbars move; the map is a snapshot and says so.
- **No amber and no good/poor colours on a map.** Amber still means stale. A stale wind layer greys out and shows its as-of time.
- **Wind arrows follow the chart's arrows:** length scales with speed, and every arrow set also carries its speed as text.
- **Attribution is visible:** OpenStreetMap (ODbL) and NOAA, in the caption, not hidden in a control.
- **No third-party tiles, scripts or fonts.** Everything is served from the site's own origin.
