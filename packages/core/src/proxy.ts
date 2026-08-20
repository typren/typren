/**
 * Wave 5 (optional, additive): live admin-route rewrite for Node-runtime hosts.
 *
 * Verified against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`:
 * Next 16 defaults `proxy.ts` to the Node.js runtime, so it can `fs`-read
 * `typren.config.json` per request (mtime-cached below) and rewrite
 * `/<adminRoute>/**` -> `/editor/**` with zero restart, no CLI + redeploy
 * round-trip once a host wires this in.
 *
 * Honest limit: Next's own platform-support table lists Proxy as unsupported
 * under static export. Those hosts stay on the Wave-4 `typren apply-settings`
 * (next.config rewrite) + redeploy path. This module does not apply there.
 *
 * This package cannot own a host's `proxy.ts` (one per project, host-authored
 * as `apps/web/proxy.ts` or `src/proxy.ts`). Wire it like this:
 *
 * ```ts
 * // proxy.ts (host project root, alongside app/)
 * import { NextResponse } from "next/server";
 * import type { NextRequest } from "next/server";
 * import { typrenProxyRewrite } from "@typren/core/proxy";
 *
 * export function proxy(request: NextRequest) {
 *   const rewritten = typrenProxyRewrite(request.nextUrl);
 *   if (rewritten) return NextResponse.rewrite(new URL(rewritten, request.url));
 *   // ...any existing host proxy logic (locale detection, etc.) unchanged.
 * }
 * ```
 *
 * Auth is unchanged by this module: whatever gate the host mounts in front of
 * its editor routes (a layout calling `resolveAuth(config).authorize(...)`)
 * still runs exactly as today. This only rewrites
 * the URL an already-authorized request resolves to. Renaming the admin route
 * makes `/editor/**` itself 404 for anyone hitting it directly post-rename
 * (URL hygiene), it does not touch the auth boundary.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG_FILE = () => path.join(process.cwd(), "typren.config.json");

// ponytail: mtime-cached local-disk read (keyed by resolved file path, so
// tests / multi-config hosts don't collide); swap for a real cache/KV if the
// backing store is ever not local disk.
const cache = new Map<string, { mtimeMs: number; adminRoute: string }>();

/** Current `adminRoute` from `typren.config.json`, mtime-cached so a steady
 *  file only costs one `statSync` per request, not a `readFileSync` too.
 *  Missing file (`throwIfNoEntry: false`) or missing/invalid field -> "editor". */
export function currentAdminRoute(file: string = DEFAULT_CONFIG_FILE()): string {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) return "editor";
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.adminRoute;
  let adminRoute = "editor";
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed?.adminRoute === "string" && parsed.adminRoute) adminRoute = parsed.adminRoute;
  } catch {
    // malformed JSON mid-write: keep the "editor" default rather than throw
    // on a request path; the next well-formed write repopulates the cache.
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, adminRoute });
  return adminRoute;
}

/** `previewPath` derived from the live admin route, so it can never drift
 *  from whatever `currentAdminRoute` reports. */
export function previewPathFor(adminRoute: string): string {
  return `/${adminRoute}/preview`;
}

/**
 * Maps `/<adminRoute>/**` -> `/editor/**`; returns null when no rewrite
 * applies (adminRoute is still the default "editor", or the path isn't under
 * the admin route at all) so a host's proxy can fall through to its own logic.
 * Accepts `URL | string` (matches `request.nextUrl` or a plain path) rather
 * than a `NextRequest`, so this stays testable without a `next/server` import
 * and works the same whether the host is on the Node.js or edge convention.
 */
export function typrenProxyRewrite(url: URL | string, opts?: { configFile?: string }): string | null {
  const pathname = typeof url === "string" ? url.split("?")[0] : url.pathname;
  const adminRoute = currentAdminRoute(opts?.configFile);
  if (adminRoute === "editor") return null; // already the real route; nothing to rewrite
  const prefix = `/${adminRoute}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return `/editor${pathname.slice(prefix.length)}`;
}
