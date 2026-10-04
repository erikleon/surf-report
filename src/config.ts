// Settings read from environment variables. A bad value throws, so the
// process refuses to start instead of running with a setting nobody meant.

export interface Config {
  port: number;
  host: string;
  /** Canonical origin with no trailing slash. */
  siteUrl: string;
  verdictLogDir: string;
}

type Env = Record<string, string | undefined>;

/** An unset variable and an empty one both mean "use the default". */
function read(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function bad(name: string, value: string, why: string): Error {
  return new Error(`Invalid ${name}=${JSON.stringify(value)}: ${why}`);
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw bad("PORT", value, "must be an integer from 1 to 65535");
  const port = Number(value);
  if (port < 1 || port > 65535) throw bad("PORT", value, "must be an integer from 1 to 65535");
  return port;
}

function parseSiteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad("SITE_URL", value, "must be an http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw bad("SITE_URL", value, "must be an http or https URL");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw bad("SITE_URL", value, "must be an origin only, with no path, query, fragment or credentials");
  }
  return url.origin;
}

export function loadConfig(env: Env): Config {
  const port = read(env, "PORT");
  const siteUrl = read(env, "SITE_URL");
  return {
    port: port === undefined ? 8080 : parsePort(port),
    host: read(env, "HOST") ?? "127.0.0.1",
    siteUrl: parseSiteUrl(siteUrl ?? "https://surf.midwoodrathaus.fyi"),
    verdictLogDir: read(env, "VERDICT_LOG_DIR") ?? "./data",
  };
}
