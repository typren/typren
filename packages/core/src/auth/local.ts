import type { AuthAdapter } from "../auth-adapter";

/** Loopback Host values localAuth accepts on top of the NODE_ENV rule below:
 *  "localhost", "127.0.0.1", "::1" (the Host header's IPv6 literal is
 *  bracketed, e.g. "[::1]:3000"), and any "*.localhost" subdomain. A bare
 *  NODE_ENV==="development" check is not itself a network boundary: a
 *  misconfigured dev server bound to 0.0.0.0 (common in containers/VMs) would
 *  otherwise expose the same gate -- unauthenticated file writes -- to
 *  anything that can reach that host on the LAN. */
function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower.endsWith(".localhost");
}

/** Default `getHost`: reads the Host header via Next's `headers()`. Dynamically
 *  imported (this module has no peer deps otherwise), so an unavailable import
 *  or a call outside a Next request scope fails closed -- treated as a
 *  non-loopback host -- rather than throwing out of a dev-only gate. */
async function defaultGetHost(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("host");
  } catch {
    return null;
  }
}

/**
 * Dev-only gate (entry `@typren/core/auth/local`, no peer deps outside the
 * `getHost` default above). Refuses in production unless `allowInProduction`
 * is explicitly set, AND refuses any non-loopback Host even in development.
 * The editor writes files, so never ship it open by omission. Doesn't branch
 * on `ctx.action`, so "admin" (settings/onboarding/bootstrap writes) gets the
 * exact same local-only gate as every other write. There's only one tier in
 * local dev.
 */
export function localAuth(
  opts: {
    /** default: NODE_ENV === "development" */
    predicate?: () => boolean;
    /** default: false */
    allowInProduction?: boolean;
    /** Resolve the request's Host header. Default: Next's `headers()` (see
     *  `defaultGetHost`). Override for a non-Next host, or in tests. */
    getHost?: () => Promise<string | null>;
  } = {}
): AuthAdapter {
  const predicate = opts.predicate ?? (() => process.env.NODE_ENV === "development");
  const getHost = opts.getHost ?? defaultGetHost;
  const allowed = async (): Promise<boolean> => {
    if (process.env.NODE_ENV === "production" && !opts.allowInProduction) return false;
    if (!predicate()) return false;
    return isLoopbackHost(await getHost());
  };
  return {
    getUser: async () => ((await allowed()) ? { id: "local-dev", name: "Local dev" } : null),
    authorize: async () => allowed(),
  };
}
