# TODOS

Deferred work, with enough context to pick it up cold.

## Tune the star split and the call thresholds

Review the 0 to 5 star split and the good, marginal and poor thresholds against
real sessions.

**Why:** both are taste, not fact. The thresholds were copied from oneeightsix,
where they were set for a small, wind-sensitive beach break. The within-level
star split (poor 0 or 1, marginal 2 or 3, good 4 or 5, chosen by wave size and
period) has no data behind it yet.

**Context:** the thresholds live in `src/surfCall.ts`. `DESIGN.md` records the
rules for how stars nest inside the three levels.

**Depends on:** the site running for a few weeks, and someone noting which days
the call was wrong.

## Local notes

Add dated local notes to the home page: break names, the A train, a note per
stretch of beach.

**Why:** the local voice is what the site is meant to be remembered for. Version
one only has static header text naming Beach 67th to Beach 116th and the A train.

**Context:** the forecast is one grid point, so notes are text only and never
carry separate wave numbers. A note should age into a stale state after its own
date, the same way a reading does. Storing them as a markdown file in the repo is
the simplest start.

**Depends on:** version one shipping, and a person willing to write and update
the notes.

## Buoy 44025 and the NWS rip-current risk

Show the offshore buoy reading as a check on the model, and the NWS rip-current
risk line.

**Why:** version one is model-only and carries no safety line, and a buoy
reading is the cheapest way to see when the model is wrong. Until this lands,
`/about` states that conditions are model-based and that lifeguard flags rule.

**Context:** left out of version one on purpose. The parsing traps are recorded
in `homelab/stack/homeassistant-config/packages/rockaway.yaml`: NDBC columns go
`MM` one at a time, and the NWS text needs the `NYZ178` section cut out of a
product that covers every zone. The NWS source is a text scrape, so look at the
`api.weather.gov` products endpoint first.

**Depends on:** version one shipping, and a decision on where a rip-current line
sits on the first screen.

## Copies of the oneeightsix modules

Decide how fixes to the copied modules (`surfCall`, `surfChart`, `tide`,
`daylight`, `localTime`) reach the other repo.

**Why:** the modules were copied, not shared, so a threshold or bug fix in one
repo is missing from the other. The timezone, `Hour` record and gap-hour changes
already make the two copies differ on purpose.

**Context:** the options are a note at the top of each copied file naming its
origin and date, a shared package, or accepting the drift. Weigh the shared
package against oneeightsix's zero-runtime-dependency rule.

**Depends on:** version one shipping.
