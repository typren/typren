import type { AuthAdapter } from "../auth-adapter";

/** Loopback Host values localAuth requires: "localhost", "127.0.0.1", "::1"
 *  (the Host header's IPv6 literal is bracketed, e.g. "[::1]:3000"), and any
 *  "*.localhost" subdomain. The client chooses the Host header, so this is a
 *  deny-only filter, never the network boundary (that is `isBoundToLoopback`
 *  below): it rejects a DNS-rebinding page, whose browser sends the
 *  attacker's hostname to a loopback-bound server. */
function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower.endsWith(".localhost");
}

/** True only when the running Next server listens on a loopback address.
 *  Route handlers and server actions get no socket peer address, so the bind
 *  is the one network fact a request can't forge. Next's start-server writes
 *  `__NEXT_PRIVATE_ORIGIN` from the address it actually bound: an explicit
 *  `-H 127.0.0.1` / `-H ::1` yields that literal, while the default bind
 *  (all interfaces) and `-H localhost` both yield "localhost", so "localhost"
 *  proves nothing and is refused.
 *  ponytail: reads a Next-private env var (verified on next 16.4). If Next
 *  renames or drops it, localAuth denies everything, failing closed; upgrade
 *  to a public bound-address API if Next ever ships one. */
function isBoundToLoopback(): boolean {
  try {
    const { hostname } = new URL(process.env.__NEXT_PRIVATE_ORIGIN ?? "");
    return hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
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
 * is explicitly set, refuses unless the Next server is bound to loopback
 * (`next dev -H 127.0.0.1`, which `typren init` scaffolds), and refuses a
 * non-loopback Host even then. The editor writes files, so never ship it open
 * by omission. Doesn't branch on `ctx.action`, so "admin"
 * (settings/onboarding/bootstrap writes) gets the exact same local-only gate
 * as every other write. There's only one tier in local dev.
 */
export function localAuth(
  opts: {
    /** default: NODE_ENV === "development" */
    predicate?: () => boolean;
    /** default: false */
    allowInProduction?: boolean;
    /** Resolve the request's Host header. Default: Next's `headers()` (see
     *  `defaultGetHost`). Override in tests. Only ever narrows access. */
    getHost?: () => Promise<string | null>;
  } = {}
): AuthAdapter {
  const predicate = opts.predicate ?? (() => process.env.NODE_ENV === "development");
  const getHost = opts.getHost ?? defaultGetHost;
  const allowed = async (): Promise<boolean> => {
    if (process.env.NODE_ENV === "production" && !opts.allowInProduction) return false;
    if (!predicate() || !isBoundToLoopback()) return false;
    return isLoopbackHost(await getHost());
  };
  return {
    getUser: async () => ((await allowed()) ? { id: "local-dev", name: "Local dev" } : null),
    authorize: async () => allowed(),
  };
}
