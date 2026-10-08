// The Worker that runs first on every request except `/_next/*` (that
// exclusion is `run_worker_first` in wrangler-config.ts's generated config,
// not code here: `/_next/**` is already content-hashed and never needs a
// redirect or the directory-index rewrite, so skipping the Worker for it is
// a latency win, not a correctness requirement).
//
// Imports ONLY `@typren/core/static-host`, never the core package root: root
// pulls in node/jsdom/sharp, none of which exist in the Workers runtime, and
// wrangler bundles this file (plus whatever it imports) into the deployed
// Worker at deploy/dev time.
import { resolveStaticHostRequest } from "@typren/core/static-host";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Host canonicalization runs before routing, so a non-canonical host
    // costs one extra hop on a slash/bare mismatch rather than duplicating
    // the routing decision for both hosts.
    if (env.TYPREN_CANONICAL_HOST && url.hostname !== env.TYPREN_CANONICAL_HOST) {
      url.hostname = env.TYPREN_CANONICAL_HOST;
      return new Response(null, { status: 301, headers: { Location: url.toString() } });
    }

    // `env.REDIRECTS` is absent on a site deployed before `bootstrap` has
    // created the KV namespace and wired the binding. Treat that exactly
    // like an empty store: resolveStaticHostRequest already fails open on a
    // lookup rejection/null, so the site still serves, it just has no
    // redirects yet.
    const decision = await resolveStaticHostRequest(url.pathname, url.search.slice(1), (key) => env.REDIRECTS?.get(key) ?? null, {
      trailingSlash: env.TYPREN_TRAILING_SLASH !== "false",
    });

    if (decision.kind === "redirect") {
      return new Response(null, { status: decision.status, headers: { Location: decision.location } });
    }
    if (decision.kind === "rewrite") {
      // Serve the canonical object path (the directory-index rewrite)
      // instead of the request path; `request` as the second Request()
      // argument carries method/headers/body along unchanged.
      return env.ASSETS.fetch(new Request(new URL(decision.path, request.url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
