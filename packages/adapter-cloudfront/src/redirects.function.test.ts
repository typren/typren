import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "redirects.function.js"), "utf8");

type EdgeResult =
  | { uri: string }
  | { statusCode: number; headers: { location: { value: string } } };

/**
 * Runs the committed CloudFront function the way the edge would: the
 * runtime provides the `cloudfront` module, so strip the import and inject
 * a stand-in whose kvs.get mirrors the real one (rejects on a missing key).
 */
function run(uri: string, redirects: Record<string, string> = {}, kvsGet?: (key: string) => Promise<string>): Promise<EdgeResult> {
  const get =
    kvsGet ??
    (async (key: string) => {
      const value = redirects[key];
      if (value === undefined) throw new Error(`KeyNotFound: ${key}`);
      return value;
    });
  const body = source.replace(/^import .*\n/m, "");
  const handler = new Function("cf", `${body}\nreturn handler;`)({ kvs: () => ({ get }) }) as (e: {
    request: { uri: string };
  }) => Promise<EdgeResult>;
  return handler({ request: { uri } });
}

describe("redirects.function.js", () => {
  it("301s a path found in the KVS", async () => {
    expect(await run("/old-path", { "/old-path": "/new-path" })).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/new-path" } },
    });
  });

  it("normalizes a trailing slash before the KVS lookup", async () => {
    expect(await run("/old-path/", { "/old-path": "/new-path" })).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/new-path" } },
    });
  });

  // The S3 REST origin has no index document: without this rewrite every
  // page on the site 404s. Regression guard for the class of outage where
  // the rewrite is lost by attaching a redirects-only function over it.
  it.each([
    ["/", "/index.html"],
    ["/about/", "/about/index.html"],
    ["/resources/2025-network-recap/", "/resources/2025-network-recap/index.html"],
  ])("rewrites %s to %s", async (uri, expected) => {
    expect(await run(uri)).toMatchObject({ uri: expected });
  });

  it.each([
    ["/about", "/about/"],
    ["/network", "/network/"],
  ])("301s the bare form %s to %s", async (uri, location) => {
    expect(await run(uri)).toMatchObject({ statusCode: 301, headers: { location: { value: location } } });
  });

  // Next's static-export metadata routes are real extensionless S3 objects
  // and must never be redirected or rewritten.
  it.each(["/opengraph-image", "/twitter-image", "/icon", "/apple-icon", "/robots.txt", "/sitemap.xml", "/_next/static/chunk.js"])(
    "leaves %s untouched",
    async (uri) => {
      expect(await run(uri)).toMatchObject({ uri });
    }
  );

  // A broken store must lose ONLY the redirect lookups — the index rewrite
  // and bare-slash canonicalization keep the site serving.
  it("still rewrites when the KVS is unavailable", async () => {
    const down = () => Promise.reject(new Error("store unavailable"));
    expect(await run("/about/", {}, down)).toMatchObject({ uri: "/about/index.html" });
    expect(await run("/about", {}, down)).toMatchObject({ statusCode: 301, headers: { location: { value: "/about/" } } });
  });
});
