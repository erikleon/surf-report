// The about page: what the rating means, where the data comes from, how old it is.

import { BEACH_FACING_DEG } from "../beach.js";
import { CALL } from "../call.js";
import type { SiteModel } from "../model.js";
import type { PageContext } from "./context.js";
import { page } from "./layout.js";
import { clockWithDate, stars } from "./parts.js";

const when = (ms: number | undefined): string =>
  ms === undefined ? "not loaded yet" : `${clockWithDate(ms)}, New York time`;

export function renderAbout(model: SiteModel, ctx: PageContext): string {
  const offshoreFrom = (BEACH_FACING_DEG + 180) % 360;
  const body =
    `<h1 class="page-title">About</h1>` +
    `<section class="prose" aria-labelledby="h-what"><h2 id="h-what" class="label">What this is</h2>` +
    `<p>A surf forecast for Rockaway Beach, made for people who already read swell period. ` +
    `It gives one call for the day, the numbers behind it, and a 48 hour chart. It has no accounts and sets no cookies.</p>` +
    `<p>There is one forecast point for all of Rockaway. The numbers are the same from Beach 67th to Beach 116th. ` +
    `Nothing here is a per-break forecast.</p></section>` +
    `<section class="prose" aria-labelledby="h-rating"><h2 id="h-rating" class="label">How the rating works</h2>` +
    `<p>Every hour gets one of three levels. The first rule that applies decides it.</p>` +
    `<ul>` +
    `<li>Not today: it is dark, or the wind is onshore above ${CALL.blownOutMph} mph, or the waves are under ${CALL.tooSmallFt.toFixed(1)} ft.</li>` +
    `<li>Worth it: waves are ${CALL.minWaveFt.toFixed(1)} ft or more, the period is ${CALL.minPeriodS} seconds or more, ` +
    `and the wind is offshore or under ${CALL.calmWindMph} mph.</li>` +
    `<li>Marginal: everything else.</li></ul>` +
    `<p>Offshore wind blows from within 60 degrees of ${offshoreFrom} degrees (roughly north). Onshore is within 60 degrees of ${BEACH_FACING_DEG} degrees. ` +
    `The beach faces about ${BEACH_FACING_DEG} degrees. The rest is cross shore.</p>` +
    `<p>Stars sit inside the levels. Not today is 0 or 1 star, marginal is 2 or 3, worth it is 4 or 5. ` +
    `Onshore wind with something to ride gets 1 star. Marginal gets 3 when the waves and period pass the worth it minimums and the wind is the only problem, and 2 otherwise. ` +
    `Worth it gets 5 at ${CALL.topStarWaveFt.toFixed(1)} ft and ${CALL.topStarPeriodS} seconds or more, and 4 below that.</p>` +
    `<p>Solid stars are the rating. Faded stars are what the wind took away: the stars the same hour would earn with calm wind. ` +
    `For example, ${stars(2, 4)} is a 4 star swell held to 2 stars by wind.</p>` +
    `<p>The word and stars on Today come from the best remaining daylight hour. After sunset they come from tomorrow's daylight hours. ` +
    `Hours with no forecast are shaded and never scored.</p>` +
    `<p>These thresholds are untuned. They are a starting guess for a small, wind-sensitive beach break and will move after more sessions.</p></section>` +
    `<section class="prose" aria-labelledby="h-numbers"><h2 id="h-numbers" class="label">What the numbers are</h2>` +
    `<p>Wave height is open-water wave height in feet. It is not face height and it is not swell height. ` +
    `Waves on the sand can look bigger or smaller.</p>` +
    `<p>Everything is model-based. The lifeguards' flags rule on the beach. If the flags say stay out, stay out.</p>` +
    `<p>When the data is old, numbers turn marked with an amber square and the time they are from. ` +
    `When it is too old to trust, the call is hidden and only the numbers stay.</p></section>` +
    `<section class="prose" aria-labelledby="h-sources"><h2 id="h-sources" class="label">Sources</h2>` +
    `<ul class="sources">` +
    `<li><a href="https://open-meteo.com/en/docs/marine-weather-api">Open-Meteo marine</a>: wave height and period. Last good update ${when(model.fetchedAt.marine)}.</li>` +
    `<li><a href="https://open-meteo.com/en/docs">Open-Meteo forecast</a>: wind, sunrise and sunset. Last good update ${when(model.fetchedAt.forecast)}.</li>` +
    `<li><a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=8517137">NOAA CO-OPS</a> tide predictions, station 8517137. Public domain. Last good update ${when(model.fetchedAt.tides)}.</li>` +
    `</ul>` +
    `<p>Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a>, licensed ` +
    `<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. The free API is for non-commercial use.</p>` +
    `<p>Fonts: <a href="https://github.com/vercel/geist-font">Geist</a> and ` +
    `<a href="https://github.com/Instrument/instrument-serif">Instrument Serif</a>, both under the ` +
    `<a href="https://openfontlicense.org/">SIL Open Font License</a>, served from this site.</p>` +
    `<p>Source code: <a href="https://github.com/erikleon/surf-report">github.com/erikleon/surf-report</a>.</p></section>`;

  return page(ctx, {
    title: "About - Rockaway surf report",
    description:
      "How the Rockaway surf rating works, what the wave numbers mean, and where the data comes from.",
    path: "/about",
    current: "about",
    body,
  });
}
