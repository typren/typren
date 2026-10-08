// Worker name rules (not a typren choice): lowercase letters, digits and
// hyphens, 1-63 characters, must not start or end with a hyphen.
// https://developers.cloudflare.com/workers/configuration/workers-dev/
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// A CF custom domain is a bare hostname: no scheme, no path, no wildcard
// (custom domains reject all three). A wildcard belongs on a *route*
// instead, out of scope for `init`'s simple case.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// A Cloudflare account id: 32 lowercase hex characters.
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;

export type RenderWranglerConfigOptions = {
  name: string;
  assetsDir?: string;
  domains?: string[];
  compatibilityDate: string;
  /** Pins the account, so a login with access to several accounts can't
   *  deploy to the wrong one (and non-interactive runs don't stop to ask). */
  accountId?: string;
  /** Next's `trailingSlash`. `false` (Next's default export) is written as
   *  the Worker's `TYPREN_TRAILING_SLASH` var. */
  trailingSlash?: boolean;
  /** Written as `TYPREN_CANONICAL_HOST`: the Worker 301s any other hostname
   *  (e.g. the apex) to this one. */
  canonicalHost?: string;
};

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `typren-cloudflare: "${name}" is not a valid Worker name (lowercase letters, digits and hyphens, 1-63 characters, cannot start or end with a hyphen)`
    );
  }
}

function validateDomain(domain: string): void {
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(`typren-cloudflare: "${domain}" is not a valid custom domain (a bare hostname, no scheme, path or wildcard)`);
  }
}

/**
 * Pure function rendering `wrangler.jsonc`'s contents. `name` and each
 * `domains` entry are validated here because they're written straight into a
 * config file wrangler then acts on: a trust-boundary check belongs at the
 * point untrusted/operator-supplied strings become config, not left to
 * wrangler's own (less specific) error messages.
 *
 * Native trailing-slash handling is OFF (`html_handling: "none"`): the
 * Worker owns canonicalization, matching `@typren/core`'s
 * `resolveStaticHostRequest` exactly (301s, query string preserved), which
 * CF's own `html_handling` modes don't attempt. `not_found_handling:
 * "404-page"` serves the static export's own `404.html`.
 */
export function renderWranglerConfig(opts: RenderWranglerConfigOptions): string {
  const { name, assetsDir = "./out", domains = [], compatibilityDate, accountId, trailingSlash = true, canonicalHost } = opts;
  validateName(name);
  for (const domain of domains) validateDomain(domain);
  if (canonicalHost !== undefined) validateDomain(canonicalHost);
  if (accountId !== undefined && !ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(`typren-cloudflare: "${accountId}" is not a valid Cloudflare account id (32 lowercase hex characters)`);
  }

  const vars: Record<string, string> = {};
  if (!trailingSlash) vars.TYPREN_TRAILING_SLASH = "false";
  if (canonicalHost) vars.TYPREN_CANONICAL_HOST = canonicalHost;
  const accountLine = accountId ? `\n  "account_id": ${JSON.stringify(accountId)},` : "";
  const varsLine = Object.keys(vars).length > 0 ? `,\n  "vars": ${JSON.stringify(vars)}` : "";

  const routesLine =
    domains.length > 0
      ? `,\n  "routes": [${domains.map((d) => `{ "pattern": "${d}", "custom_domain": true }`).join(", ")}]`
      : `\n  // , "routes": [{ "pattern": "example.com", "custom_domain": true }, ...]  only when domains given`;

  return `{
  "name": ${JSON.stringify(name)},${accountLine}
  "main": "node_modules/@typren/adapter-cloudflare/dist/worker.js",
  "compatibility_date": ${JSON.stringify(compatibilityDate)},
  "assets": {
    "directory": ${JSON.stringify(assetsDir)},
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "404-page",
    "run_worker_first": ["/*", "!/_next/*"]
  }${varsLine}${routesLine}
}
`;
}
