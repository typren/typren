import { describe, expect, it } from "vitest";

/**
 * Static-host routing contract (packages/core/src/static-host.ts): the
 * directory-index rewrite + bare->slash canonicalization + redirect-store
 * lookup semantics a static-export site's edge must apply, regardless of
 * which host runs it. `@typren/core`'s `resolveStaticHostRequest` and
 * `@typren/adapter-cloudfront`'s hand-written `redirects.function.js` (it
 * cannot import the core function, cloudfront-js has no bundler) both run
 * this suite so an edit to one semantic can't quietly diverge from the other.
 */
export type StaticHostOutcome = { status: 301; location: string } | { serve: string };

export type StaticHostRunner = (req: {
  path: string;
  query?: string; // raw, no "?"
  redirects?: Record<string, string>; // the redirect store contents (key -> target)
  storeDown?: boolean; // every lookup rejects
}) => Promise<StaticHostOutcome>;

export function createStaticHostRoutingContractSuite(name: string, run: StaticHostRunner): void {
  describe(`static-host routing (${name})`, () => {
    it("301s a path found in the redirect store", async () => {
      await expect(run({ path: "/old-path", redirects: { "/old-path": "/new-path" } })).resolves.toEqual({
        status: 301,
        location: "/new-path",
      });
    });

    it("normalizes a trailing slash before the store lookup", async () => {
      await expect(run({ path: "/old-path/", redirects: { "/old-path": "/new-path" } })).resolves.toEqual({
        status: 301,
        location: "/new-path",
      });
    });

    it.each([
      ["/", "/index.html"],
      ["/about/", "/about/index.html"],
      ["/resources/2025-network-recap/", "/resources/2025-network-recap/index.html"],
    ])("rewrites %s to %s", async (path, serve) => {
      await expect(run({ path })).resolves.toEqual({ serve });
    });

    it.each([
      ["/about", "/about/"],
      ["/network", "/network/"],
    ])("301s the bare form %s to %s", async (path, location) => {
      await expect(run({ path })).resolves.toEqual({ status: 301, location });
    });

    it.each([
      "/opengraph-image",
      "/twitter-image",
      "/icon",
      "/apple-icon",
      "/robots.txt",
      "/sitemap.xml",
      "/_next/static/chunk.js",
      "/blog/opengraph-image",
      "/.well-known/apple-app-site-association",
    ])("leaves %s untouched", async (path) => {
      await expect(run({ path })).resolves.toEqual({ serve: path });
    });

    it("refuses a hostile store target: protocol-relative, backslash, control chars", async () => {
      await expect(run({ path: "/a", redirects: { "/a": "//evil.example/" } })).resolves.toEqual({
        status: 301,
        location: "/a/", // fell through to bare-form canonicalization
      });
      await expect(run({ path: "/b/", redirects: { "/b": "/x\\evil" } })).resolves.toEqual({ serve: "/b/index.html" });
      await expect(run({ path: "/c/", redirects: { "/c": "/x\r\nSet-Cookie: pwned" } })).resolves.toEqual({
        serve: "/c/index.html",
      });
    });

    it("still rewrites and canonicalizes when the store is down", async () => {
      await expect(run({ path: "/about/", storeDown: true })).resolves.toEqual({ serve: "/about/index.html" });
      await expect(run({ path: "/about", storeDown: true })).resolves.toEqual({ status: 301, location: "/about/" });
    });

    it.each(["//evil.example", "//evil.example/x", "///evil.example"])(
      "never 301s %s into a protocol-relative location",
      async (path) => {
        await expect(run({ path })).resolves.toEqual({ serve: path });
      }
    );

    it("preserves the query string on the bare-form 301", async () => {
      await expect(run({ path: "/about", query: "utm_source=newsletter&flag&tag=a&tag=b" })).resolves.toEqual({
        status: 301,
        location: "/about/?utm_source=newsletter&flag&tag=a&tag=b",
      });
    });

    it("appends the query string on a store redirect, with '?' or '&' as the target needs", async () => {
      await expect(run({ path: "/old", redirects: { "/old": "/new/" }, query: "a=1" })).resolves.toEqual({
        status: 301,
        location: "/new/?a=1",
      });
      await expect(run({ path: "/old", redirects: { "/old": "/new/?keep=1" }, query: "a=1" })).resolves.toEqual({
        status: 301,
        location: "/new/?keep=1&a=1",
      });
    });

    it("301s to an external https(s) target when the store says so", async () => {
      await expect(run({ path: "/old", redirects: { "/old": "https://example.com/x" } })).resolves.toEqual({
        status: 301,
        location: "https://example.com/x",
      });
    });
  });
}
