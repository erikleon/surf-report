# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A public, no-login surf forecast for Rockaway Beach, NYC. Node and TypeScript, server-rendered, no client framework. The server (`src/server.ts`), config and asset loading are in place; `src/index.ts` is the entry point.

## Commands

```
npm test              # vitest, one run
npm run test:tz       # the suite under three host timezones; CI runs this
npm run typecheck     # tsc --noEmit
npm run test:e2e      # Playwright in Chromium; run npm run build first, it starts the servers from dist/
npm run build         # tsc to dist/
npm start             # node dist/index.js; needs assets/site.css, PORT/HOST/SITE_URL/VERDICT_LOG_DIR are optional
npm run contract      # check the live upstreams; makes real network requests
docker build -t surf-report:test .   # build the container image locally
```

Run a single test file with `npx vitest run tests/<name>.test.ts`, or one test by name with `-t "<part of the name>"`.

Run the full suite after any multi-file change and report pass and fail counts.

## Testing

vitest, tests in `tests/**/*.test.ts`. The suite must pass with the host set to `America/New_York`, `UTC` and `Pacific/Auckland`, because the site's hours are New York hours whatever zone the server runs in.

## Conventions

- One runtime dependency: `strictdatetime`. Anything else needs a reason. Prefer the standard library.
- All local time goes through `strictdatetime` in `America/New_York`. Do not use `getHours()`, `getDate()` or `new Date(string)` to read a forecast time: they follow the host's zone, or put a zone onto a stamp that has none.
- Forecast hours are strings like `2026-10-03T06:00` compared as strings. Do not parse them into a `Date`.
- Server owns state. Whether data is fresh, stale or missing is decided on the server and rendered into the HTML. Browser JavaScript only moves a view cursor.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
