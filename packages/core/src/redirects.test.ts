import { describe, it, expect, vi } from "vitest";
import { buildRedirects } from "./redirects";
import { fakeStore } from "./seo/test-fixtures";

describe("buildRedirects", () => {
  it("returns no entries for pages with no aliases", async () => {
    const store = fakeStore([{ slug: "about" }]);
    expect(await buildRedirects(store)).toEqual([]);
  });

  it("maps a single alias to the page's canonical path", async () => {
    const store = fakeStore([{ slug: "brand-center", meta: { aliases: ["/old-path"] } }]);
    expect(await buildRedirects(store)).toEqual([{ from: "/old-path", to: "/brand-center", slug: "brand-center" }]);
  });

  it("supports multiple aliases on one page", async () => {
    const store = fakeStore([{ slug: "pricing", meta: { aliases: ["/plans", "/old-pricing"] } }]);
    const entries = await buildRedirects(store);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ from: "/plans", to: "/pricing", slug: "pricing" });
    expect(entries).toContainEqual({ from: "/old-pricing", to: "/pricing", slug: "pricing" });
  });

  it("normalizes a trailing slash on the alias", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/old-about/"] } }]);
    expect(await buildRedirects(store)).toEqual([{ from: "/old-about", to: "/about", slug: "about" }]);
  });

  it("maps homeSlug's alias target to the bare site root", async () => {
    const store = fakeStore([{ slug: "home", meta: { aliases: ["/welcome"] } }]);
    expect(await buildRedirects(store, { homeSlug: "home" })).toEqual([{ from: "/welcome", to: "/", slug: "home" }]);
  });

  it("throws on a duplicate alias claimed by two different pages", async () => {
    const store = fakeStore([
      { slug: "about", meta: { aliases: ["/old-path"] } },
      { slug: "team", meta: { aliases: ["/old-path"] } },
    ]);
    await expect(buildRedirects(store)).rejects.toThrow(/duplicate alias "\/old-path" claimed by both "about" and "team"/);
  });

  it("throws when an alias shadows another page's own canonical path", async () => {
    const store = fakeStore([{ slug: "about" }, { slug: "team", meta: { aliases: ["/about"] } }]);
    await expect(buildRedirects(store)).rejects.toThrow(/alias "\/about" shadows page "about"'s own canonical path/);
  });

  it("throws when a page aliases its own canonical path (redirect loop)", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/about"] } }]);
    await expect(buildRedirects(store)).rejects.toThrow(/"about" aliases its own canonical path "\/about" \(redirect loop\)/);
  });

  it.each([
    ["not a string", 42],
    ["missing leading slash", "old-path"],
    ["blank", "   "],
    ["contains whitespace", "/old path"],
  ])("throws on a malformed alias: %s", async (_label, bad) => {
    const store = fakeStore([{ slug: "about", meta: { aliases: [bad] } }]);
    await expect(buildRedirects(store)).rejects.toThrow(/invalid alias/);
  });

  it("throws when frontmatter aliases isn't an array", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: "/old-path" } }]);
    await expect(buildRedirects(store)).rejects.toThrow(/"aliases" must be an array of paths/);
  });

  it("throws once total entries exceed maxEntries", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/a", "/b", "/c"] } }]);
    await expect(buildRedirects(store, { maxEntries: 2 })).rejects.toThrow(/exceeds maxEntries \(2\)/);
  });

  it("throws on an alias longer than the generic path-length sanity limit", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: [`/${"a".repeat(2049)}`] } }]);
    await expect(buildRedirects(store)).rejects.toThrow(/exceeds 2048 characters/);
  });

  it("uses listSlugs, not listPages (no hasDraft/listLocales fan-out)", async () => {
    const store = fakeStore([{ slug: "about" }]);
    await buildRedirects(store);
    expect(store.listPagesCalls).toBe(0);
  });

  it.each([
    ["the site root", "/"],
    ["a /.well-known path", "/.well-known/apple-app-site-association"],
    ["a path with a file extension", "/robots.txt"],
  ])("warns and skips an alias claiming %s, without throwing", async (_label, bad) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore([{ slug: "about", meta: { aliases: [bad] } }]);
    expect(await buildRedirects(store)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(bad));
    warn.mockRestore();
  });

  it("warns and skips an alias under a reserved prefix (another locale or collection)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/blog/old-post"] } }]);
    expect(await buildRedirects(store, { reservedPrefixes: ["/blog"] })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("/blog"));
    warn.mockRestore();
  });

  it("still accepts an alias that is merely a prefix of a reserved path, not under it", async () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/blogging"] } }]);
    expect(await buildRedirects(store, { reservedPrefixes: ["/blog"] })).toEqual([
      { from: "/blogging", to: "/about", slug: "about" },
    ]);
  });

  it("still reports the duplicate owner by page order, not read-completion order", async () => {
    // Bounded-concurrency reads (mapLimit) must not reorder the validation
    // pass: "about" is declared first in `slugs`, so it stays the reported
    // owner even though nothing here guarantees its read settles first.
    const store = fakeStore([
      { slug: "about", meta: { aliases: ["/old-path"] } },
      { slug: "team", meta: { aliases: ["/old-path"] } },
    ]);
    await expect(buildRedirects(store)).rejects.toThrow(/claimed by both "about" and "team"/);
  });
});
