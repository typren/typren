import { describe, it, expect } from "vitest";
import { buildRedirects } from "./redirects";
import { fakeStore } from "./seo/test-fixtures";

describe("buildRedirects", () => {
  it("returns no entries for pages with no aliases", () => {
    const store = fakeStore([{ slug: "about" }]);
    expect(buildRedirects(store)).toEqual([]);
  });

  it("maps a single alias to the page's canonical path", () => {
    const store = fakeStore([{ slug: "brand-center", meta: { aliases: ["/old-path"] } }]);
    expect(buildRedirects(store)).toEqual([{ from: "/old-path", to: "/brand-center", slug: "brand-center" }]);
  });

  it("supports multiple aliases on one page", () => {
    const store = fakeStore([{ slug: "pricing", meta: { aliases: ["/plans", "/old-pricing"] } }]);
    const entries = buildRedirects(store);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ from: "/plans", to: "/pricing", slug: "pricing" });
    expect(entries).toContainEqual({ from: "/old-pricing", to: "/pricing", slug: "pricing" });
  });

  it("normalizes a trailing slash on the alias", () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/old-about/"] } }]);
    expect(buildRedirects(store)).toEqual([{ from: "/old-about", to: "/about", slug: "about" }]);
  });

  it("maps homeSlug's alias target to the bare site root", () => {
    const store = fakeStore([{ slug: "home", meta: { aliases: ["/welcome"] } }]);
    expect(buildRedirects(store, { homeSlug: "home" })).toEqual([{ from: "/welcome", to: "/", slug: "home" }]);
  });

  it("throws on a duplicate alias claimed by two different pages", () => {
    const store = fakeStore([
      { slug: "about", meta: { aliases: ["/old-path"] } },
      { slug: "team", meta: { aliases: ["/old-path"] } },
    ]);
    expect(() => buildRedirects(store)).toThrow(/duplicate alias "\/old-path" claimed by both "about" and "team"/);
  });

  it("throws when an alias shadows another page's own canonical path", () => {
    const store = fakeStore([{ slug: "about" }, { slug: "team", meta: { aliases: ["/about"] } }]);
    expect(() => buildRedirects(store)).toThrow(/alias "\/about" shadows page "about"'s own canonical path/);
  });

  it("throws when a page aliases its own canonical path (redirect loop)", () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/about"] } }]);
    expect(() => buildRedirects(store)).toThrow(/"about" aliases its own canonical path "\/about" \(redirect loop\)/);
  });

  it.each([
    ["not a string", 42],
    ["missing leading slash", "old-path"],
    ["blank", "   "],
    ["contains whitespace", "/old path"],
  ])("throws on a malformed alias: %s", (_label, bad) => {
    const store = fakeStore([{ slug: "about", meta: { aliases: [bad] } }]);
    expect(() => buildRedirects(store)).toThrow(/invalid alias/);
  });

  it("throws when frontmatter aliases isn't an array", () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: "/old-path" } }]);
    expect(() => buildRedirects(store)).toThrow(/"aliases" must be an array of paths/);
  });

  it("throws once total entries exceed maxEntries", () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: ["/a", "/b", "/c"] } }]);
    expect(() => buildRedirects(store, { maxEntries: 2 })).toThrow(/exceeds maxEntries \(2\)/);
  });

  it("throws on an alias longer than the generic path-length sanity limit", () => {
    const store = fakeStore([{ slug: "about", meta: { aliases: [`/${"a".repeat(2049)}`] } }]);
    expect(() => buildRedirects(store)).toThrow(/exceeds 2048 characters/);
  });
});
