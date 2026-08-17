import { NextResponse, type NextRequest } from "next/server";
import type { ContentStore } from "../store";
import { renderSlicesAsMarkdown, type SliceMarkdownRegistry } from "./markdown-render";

/** Matches "/some-slug.md" (single path segment) and returns the slug, or
 *  null. A pure function (no fs/req access) so both middleware (URL rewrite)
 *  and any other router glue can reuse the same match rule. */
export function matchMarkdownMirrorSlug(pathname: string): string | null {
  return pathname.match(/^\/([a-z0-9-]+)\.md$/i)?.[1] ?? null;
}

/** Route Handler factory: GET returns "# Title\n\n<flattened slices>" as
 *  text/markdown for a known slug, 404 for an unknown one. Mount at any path
 *  (e.g. src/app/md/[slug]/route.ts) — pair with createMarkdownMirrorMiddleware
 *  (or your own rewrite) to expose it at "/<slug>.md". Next's dynamic Route
 *  Handler segments resolve `params` as a Promise (same as page.tsx). */
export function createMarkdownRouteHandler(store: ContentStore, renderOverrides?: SliceMarkdownRegistry) {
  return {
    async GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
      const { slug } = await params;
      if (!store.listPages().some((p) => p.slug === slug)) {
        return new NextResponse("Not found", { status: 404 });
      }
      const page = store.getPublished(slug);
      const title = typeof page.meta.title === "string" ? page.meta.title : slug;
      const body = `# ${title}\n\n${renderSlicesAsMarkdown(page.slices, renderOverrides)}\n`;
      return new NextResponse(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    },
  };
}

/** Returns a NextRequest -> NextResponse handler that rewrites "/<slug>.md"
 *  -> "<mirrorPath>/<slug>" so the route handler above (mounted at
 *  mirrorPath) serves it transparently. Ship this as (part of) the host's
 *  proxy file (Next's `middleware.ts` file convention was renamed to
 *  `proxy.ts` in Next 16 — this factory works unchanged either way, only the
 *  host filename/export name changed) — this module exports the matcher
 *  separately so a host with other proxy concerns can compose them. */
export function createMarkdownMirrorMiddleware(mirrorPath: string) {
  return function markdownMirrorMiddleware(request: NextRequest) {
    const slug = matchMarkdownMirrorSlug(request.nextUrl.pathname);
    if (!slug) return NextResponse.next();
    return NextResponse.rewrite(new URL(`${mirrorPath}/${slug}`, request.url));
  };
}
