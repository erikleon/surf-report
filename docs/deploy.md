# Deploy notes

The app is one container. It serves https://surf.midwoodrathaus.fyi behind Cloudflare. It runs on the home server, `mimir`, reached only through a Cloudflare Tunnel: the service and the tunnel are defined in the `homelab` repo's `stack/docker-compose.yml`, which routes the tunnel straight to this container on a network shared with nothing else. Any machine that runs Docker and can reach the internet would also work.

## Image

A push of a tag like `v0.1.0` builds and publishes `ghcr.io/<owner>/surf-report`. The tag must equal `v` plus the version in `package.json`. Each image gets two tags: the version and `sha-<short commit>`. There is no `latest` tag, so always name an exact version.

To build locally: `docker build -t surf-report:test .`

## Environment variables

| Name | Default in image | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | TCP port the server listens on. |
| `HOST` | `0.0.0.0` | Address the server binds to. Outside the image the default is `127.0.0.1`. |
| `VERDICT_LOG_DIR` | `/data` | Directory for the verdict log files. Outside the image the default is `./data`. |
| `SITE_URL` | `https://surf.midwoodrathaus.fyi` | Public address of the site: an http or https origin with no path. Used for absolute links. |

## Run it

```
docker run -d --name surf-report \
  -p 8080:8080 \
  -v surf-data:/data \
  -e SITE_URL=https://surf.midwoodrathaus.fyi \
  ghcr.io/<owner>/surf-report:0.1.0
```

With Docker Compose:

```yaml
services:
  surf-report:
    image: ghcr.io/<owner>/surf-report:0.1.0
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SITE_URL: https://surf.midwoodrathaus.fyi
    volumes:
      - surf-data:/data

volumes:
  surf-data:
```

The container runs as the `node` user. A new named volume takes the ownership of `/data` from the image. A bind mount must be writable by uid 1000.

## Health check

The route is `GET /healthz`. The image runs it every 30 seconds with the Node runtime (the image has no curl). The start period is 20 seconds and 3 failures mark the container unhealthy.

The server starts listening only after the first start-up fetch finishes or times out. Until then `/healthz` is not reachable. Once it answers, it returns 200 with `{"ok":true,"ready":true}`.

The first start waits up to 10 seconds for the first upstream data. Any other health check, for example one in a load balancer, must allow about 15 seconds: on an idle machine the server is ready after about 10.2 seconds, and a busy host adds a few more.

```
docker inspect --format '{{.State.Health.Status}}' surf-report
```

## Cloudflare

For `surf.midwoodrathaus.fyi`:

1. Add a DNS record that points at the host, with the proxy on (orange cloud).
2. Add a Cache Rule for the host that caches HTML: filter `(http.host eq "surf.midwoodrathaus.fyi")`, "Eligible for cache", Edge TTL "Use cache-control header if present, bypass cache if not", Browser TTL "Respect origin TTL" (without it the zone's default Browser Cache TTL of 4 hours replaced `max-age=0`, so browsers kept pages for hours), and "Serve stale content while revalidating" added with "Do not serve stale content while updating" turned on. The origin decides how long a page is cached, and a stale page is never served. This rule exists on the zone as "surf-report: cache HTML, respect origin headers" (deployed 2026-10-04).
3. Turn Always Online off. (It is off on the zone.) Keep Rocket Loader off too: it rewrites script tags, which the Content-Security-Policy blocks. Email Address Obfuscation can stay on; it only injects a script into pages that contain an email address, and these do not.
4. Do not add any rule that serves stale content when the origin fails. A stale forecast is worse than an error page.
5. Range requests on `/assets/map/basemap.<hash>.pmtiles` must reach the browser as `206 Partial Content`. Cloudflare either passes the `Range` header to the origin or caches the whole file (5.4 MB, well under the cache size limit) and cuts the ranges itself; both work. Do not add a rule that strips `Range`, and do not let any feature change the file: no compression, Polish, minification or Rocket Loader on `.pmtiles`. The tiles inside are already gzip-compressed, and the reader's byte offsets point into the file exactly as the origin sends it.

Check the basemap through Cloudflare with:

```
curl -s -o /dev/null -D - -H 'Range: bytes=0-16383' -H 'Accept-Encoding: br, gzip' \
  https://surf.midwoodrathaus.fyi/assets/map/basemap.<hash>.pmtiles
```

It must answer `206`, `Content-Range: bytes 0-16383/<size>` and no `Content-Encoding`. Take the hashed URL from the `"url"` of the style the `/map` page loads.

## Response headers

- Complete pages: `Cache-Control: public, max-age=0, s-maxage=120, no-transform`. The browser always revalidates. Cloudflare keeps the page for 2 minutes.
- Loading, partial and error pages: `Cache-Control: no-store`.
- A strict `Content-Security-Policy` on every response:

  ```
  default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:;
  connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

  The `/map` page alone adds `blob:` to `img-src` and adds `worker-src 'self'` for MapLibre's module worker:

  ```
  default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:;
  connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

- Static files under `/assets/` use `Cache-Control: public, max-age=31536000, immutable, no-transform`. Their file names contain a content hash.
- The basemap `/assets/map/basemap.<hash>.pmtiles` answers byte ranges: `Accept-Ranges: bytes`, `206` with `Content-Range` for one range (`bytes=a-b`, `bytes=a-` or `bytes=-n`), `416` with `Content-Range: bytes */<size>` when the range starts past the end, and the whole file with `200` for a request with more than one range or a range the server cannot parse. `If-Range` is ignored; the hashed name already pins the file. The basemap is never compressed.
- A page URL with a trailing slash or a query string gets a 301 to the plain path, so cache-busting URLs do not skip the edge cache. This covers `/`, `/week`, `/about`, `/map` and `/data/wind.json`.
- When no upstream has ever loaded, pages answer 503 with `Retry-After: 30`.
- `/map` follows the same cache rules as the other pages. When a map file was missing at start, the server logs one line naming every missing file, keeps serving the forecast pages, and answers `/map` with the 503 page and `no-store, no-transform`. Restart with the files in place to turn the map on.
- `/data/wind.json` is the wind field for the map, built from the cache on each request and compressed like a page. A fresh field gets `Cache-Control: public, max-age=0, s-maxage=120, no-transform`; a stale or missing one gets `no-store, no-transform`. It answers 200 even when the field is missing, with `{"state":"missing"}`.
- No cookies. There must be no `Set-Cookie` header.
- A bad `PORT` or `SITE_URL` stops the process at start with a message that names the variable.

Check them with:

```
curl -sI https://surf.midwoodrathaus.fyi/
```

A second request within 2 minutes should show `cf-cache-status: HIT`.

## Upstream usage

Open-Meteo counts each location in a request as one call. The wind grid asks for 100 points (a 10 by 10 grid over the New York Bight) in one request each hour, so it adds about 2,400 calls a day to the forecast and marine calls. That stays inside the free limit of 10,000 calls a day. A failed wind fetch does not affect the forecast pages; the map shows the old field as stale.

## Verdict log

The app writes one JSON object per line to `/data/verdicts-YYYY-MM.jsonl`, one file for each month.

```
docker exec surf-report ls /data
docker exec surf-report tail -n 5 /data/verdicts-2026-10.jsonl
```

To copy the files off the host:

```
docker cp surf-report:/data ./verdicts
```

Every response also carries `no-transform`. Cloudflare honours it by not rewriting the response, which keeps its Web Analytics beacon and other HTML rewrites out of the pages even when those features are on for the zone. Without it, Cloudflare injected `static.cloudflareinsights.com/beacon.min.js`, a third-party script the CSP blocks.
