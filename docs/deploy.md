# Deploy notes

The app is one container. It serves https://surf.midwoodrathaus.fyi behind Cloudflare. The host is not chosen yet. Any machine that runs Docker and can reach the internet will work.

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

The first start waits up to 10 seconds for the first upstream data. Any other health check, for example one in a load balancer, must allow about 12 seconds.

```
docker inspect --format '{{.State.Health.Status}}' surf-report
```

## Cloudflare

For `surf.midwoodrathaus.fyi`:

1. Add a DNS record that points at the host, with the proxy on (orange cloud).
2. Add a Cache Rule for the host that caches HTML, with Edge TTL set to "Use cache-control header if present". The origin decides how long a page is cached.
3. Turn Always Online off.
4. Do not add any rule that serves stale content when the origin fails. A stale forecast is worse than an error page.

## Response headers

- Complete pages: `Cache-Control: public, max-age=0, s-maxage=120`. The browser always revalidates. Cloudflare keeps the page for 2 minutes.
- Loading, partial and error pages: `Cache-Control: no-store`.
- A strict `Content-Security-Policy` on every response.
- Static files under `/assets/` use `Cache-Control: public, max-age=31536000, immutable`. Their file names contain a content hash.
- A page URL with a trailing slash or a query string gets a 301 to the plain path, so cache-busting URLs do not skip the edge cache.
- When no upstream has ever loaded, pages answer 503 with `Retry-After: 30`.
- No cookies. There must be no `Set-Cookie` header.
- A bad `PORT` or `SITE_URL` stops the process at start with a message that names the variable.

Check them with:

```
curl -sI https://surf.midwoodrathaus.fyi/
```

A second request within 2 minutes should show `cf-cache-status: HIT`.

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
