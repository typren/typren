import { describe, expect, it } from "vitest";
import { assertSafeNav, linksTo, navHrefError, readMenu, relink, unlink, type NavItem } from "./nav";

describe("navHrefError", () => {
  it.each(["/", "/about", "/about/?ref=nav#team", "#", "#team", "https://example.com/x", "http://example.com"])(
    "accepts %s",
    (href) => expect(navHrefError(href)).toBeNull()
  );

  it.each([
    ["", "Enter a link."],
    ["javascript:alert(1)", "full https://"],
    ["JavaScript:alert(1)", "full https://"],
    ["java\tscript:alert(1)", "spaces"],
    ["data:text/html,x", "full https://"],
    ["mailto:a@example.com", "full https://"],
    ["//evil.example", "single /"],
    ["/\\evil.example", "backslashes"],
    ["about", "full https://"],
    [" /about", "spaces"],
  ])("refuses %j", (href, why) => expect(navHrefError(href)).toContain(why));
});

describe("assertSafeNav", () => {
  it("passes safe menus and ignores items of another shape", () => {
    expect(() =>
      assertSafeNav({ nav: [{ label: "A", href: "/a", children: [{ label: "B", href: "https://b.example" }] }, "x", null], cta: 3 })
    ).not.toThrow();
    expect(() => assertSafeNav({ title: "Site settings" })).not.toThrow();
  });

  it("throws on an unsafe child, cta or non-text href", () => {
    expect(() => assertSafeNav({ nav: [{ href: "#", children: [{ href: "javascript:void 0" }] }] })).toThrow(/refused/);
    expect(() => assertSafeNav({ nav: [], cta: { label: "Go", href: "data:x" } })).toThrow(/refused/);
    expect(() => assertSafeNav({ nav: [{ label: "Odd", href: 3 }] })).toThrow(/must be text/);
  });
});

describe("readMenu, linksTo and unlink", () => {
  const nav = [
    { label: "About", href: "/about/", children: [{ label: "Team", href: "/about/team#x" }] },
    { label: "Docs", href: "https://docs.example.test/about", external: true },
  ];

  it("reads the menu's items, or null for a menu in code", () => {
    expect(readMenu({ nav: [nav[0], "junk"], cta: { label: "Go", href: "/go" } })).toEqual({
      nav: [nav[0]],
      cta: { label: "Go", href: "/go" },
    });
    expect(readMenu({ nav: [], cta: "x" })).toEqual({ nav: [], cta: undefined });
    expect(readMenu({})).toBeNull();
  });

  it("matches internal links by path, submenus included", () => {
    expect(linksTo(nav, "/about")).toBe(true);
    expect(linksTo(nav, "/about/team")).toBe(true);
    expect(linksTo(nav, "/docs")).toBe(false);
  });

  it("drops the items linking to a page, moving their submenu up", () => {
    expect(unlink(nav, "/about")).toEqual([{ label: "Team", href: "/about/team#x" }, nav[1]]);
    expect(unlink(nav, "/about/team")).toEqual([{ label: "About", href: "/about/" }, nav[1]]);
  });

  it("points the items linking to a page at its new path, keeping suffixes and external links", () => {
    expect(relink(nav, "/about/team", "/crew")).toEqual([{ ...nav[0], children: [{ label: "Team", href: "/crew#x" }] }, nav[1]]);
    expect(relink(nav, "/about", "/company")[0]!.href).toBe("/company/");
    expect(relink(nav, "/docs", "/x")).toEqual(nav);
  });
});

describe("nesting cap", () => {
  const chain = (levels: number, href = "/a") => {
    let item: Record<string, unknown> = { label: "x", href };
    for (let i = 1; i < levels; i++) item = { label: "x", href, children: [item] };
    return item as NavItem;
  };

  it("accepts eight levels and refuses a ninth, with a clear message", () => {
    expect(() => assertSafeNav({ nav: [chain(8)] })).not.toThrow();
    expect(() => assertSafeNav({ nav: [chain(9)] })).toThrow(/at most 8 levels/);
    expect(() => assertSafeNav({ nav: [], cta: chain(9) })).toThrow(/at most 8 levels/);
  });

  it("refuses a hostile depth instead of overflowing the stack", () => {
    expect(() => assertSafeNav({ nav: [chain(100_000)] })).toThrow(/at most 8 levels/);
    expect(() => unlink([chain(100_000)], "/a")).toThrow(/at most 8 levels/);
    expect(() => unlink([chain(100_000, "/b")], "/a")).toThrow(/at most 8 levels/);
    expect(unlink([chain(8, "/b")], "/a")).toEqual([chain(8, "/b")]);
  });
});
