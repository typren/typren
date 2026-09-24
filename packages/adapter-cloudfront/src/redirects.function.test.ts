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
type EdgeQueryString = Record<string, { value: string; multiValue?: { value: string }[] }>;

function run(
  uri: string,
  redirects: Record<string, string> = {},
  kvsGet?: (key: string) => Promise<string>,
  querystring: EdgeQueryString = {}
): Promise<EdgeResult> {
  const get =
    kvsGet ??
    (async (key: string) => {
      const value = redirects[key];
      if (value === undefined) throw new Error(`KeyNotFound: ${key}`);
      return value;
    });
  const body = source.replace(/^import .*\n/m, "");
  const handler = new Function("cf", `${body}\nreturn handler;`)({ kvs: () => ({ get }) }) as (e: {
    request: { uri: string; querystring: EdgeQueryString };
  }) => Promise<EdgeResult>;
  return handler({ request: { uri, querystring } });
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

  // A broken store must lose ONLY the redirect lookups. The index rewrite
  // and bare-slash canonicalization keep the site serving.
  it("refuses to serve a hostile KVS target: protocol-relative, backslash, control chars", async () => {
    // Anyone with UpdateKeys controls these values; the function is the last
    // line of defense. Each falls through to normal handling instead of
    // emitting a Location off-site or with injected header content.
    expect(await run("/a", { "/a": "//evil.example/" })).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/a/" } }, // fell through to bare-form canonicalization
    });
    expect(await run("/b/", { "/b": "/x\\evil" })).toMatchObject({ uri: "/b/index.html" });
    expect(await run("/c/", { "/c": "/x\r\nSet-Cookie: pwned" })).toMatchObject({ uri: "/c/index.html" });
  });

  it("passes nested Next metadata routes and /.well-known/ through untouched", async () => {
    expect(await run("/blog/opengraph-image")).toMatchObject({ uri: "/blog/opengraph-image" });
    expect(await run("/.well-known/apple-app-site-association")).toMatchObject({
      uri: "/.well-known/apple-app-site-association",
    });
  });

  it("still rewrites when the KVS is unavailable", async () => {
    const down = () => Promise.reject(new Error("store unavailable"));
    expect(await run("/about/", {}, down)).toMatchObject({ uri: "/about/index.html" });
    expect(await run("/about", {}, down)).toMatchObject({ statusCode: 301, headers: { location: { value: "/about/" } } });
  });

  // CloudFront does not collapse repeated slashes, and a browser resolves a
  // "//host/path" Location as protocol-relative. Canonicalizing such a uri
  // would be an open redirect, so it must fall through to the origin instead.
  it.each(["//evil.example", "//evil.example/x", "///evil.example"])(
    "never 301s %s into a protocol-relative Location",
    async (uri) => {
      expect(await run(uri)).toMatchObject({ uri });
    }
  );

  it("preserves the query string on the bare-form 301", async () => {
    const result = await run("/about", {}, undefined, {
      utm_source: { value: "newsletter" },
      flag: { value: "" },
      tag: { value: "a", multiValue: [{ value: "a" }, { value: "b" }] },
    });
    expect(result).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/about/?utm_source=newsletter&flag&tag=a&tag=b" } },
    });
  });

  it("preserves the query string on a KVS redirect, appending to a target that has its own", async () => {
    expect(await run("/old", { "/old": "/new/" }, undefined, { a: { value: "1" } })).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/new/?a=1" } },
    });
    expect(await run("/old", { "/old": "/new/?keep=1" }, undefined, { a: { value: "1" } })).toMatchObject({
      statusCode: 301,
      headers: { location: { value: "/new/?keep=1&a=1" } },
    });
  });
});
