import { describe, it, expect } from "vitest";
import { resolveI18n, localizedPath, localizedHref, routeLocale, type I18nConfig } from "./i18n";

const exceptDefault: I18nConfig = { locales: ["en", "es"], defaultLocale: "en", routing: "prefix-except-default" };
const all: I18nConfig = { locales: ["en", "es"], defaultLocale: "en", routing: "prefix-all" };

describe("resolveI18n", () => {
  it("defaults to a single implicit locale (byte-identical single-locale mode)", () => {
    expect(resolveI18n()).toEqual({ locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", messages: undefined });
  });

  it("defaults locales to [defaultLocale] when only a default is given", () => {
    expect(resolveI18n({ defaultLocale: "fr" }).locales).toEqual(["fr"]);
  });

  it("throws when defaultLocale is not in locales (fail loud on misconfig)", () => {
    expect(() => resolveI18n({ locales: ["en", "es"], defaultLocale: "de" })).toThrow();
  });
});

describe("localizedPath / localizedHref (prefix-except-default)", () => {
  it("leaves the default locale unprefixed and prefixes others", () => {
    expect(localizedPath(exceptDefault, "/about", "en")).toBe("/about");
    expect(localizedPath(exceptDefault, "/about", "es")).toBe("/es/about");
    expect(localizedPath(exceptDefault, "/", "en")).toBe("/");
    expect(localizedPath(exceptDefault, "/", "es")).toBe("/es");
  });

  it("does not touch external / anchor / mailto hrefs", () => {
    expect(localizedHref(exceptDefault, "https://x.com", "es")).toBe("https://x.com");
    expect(localizedHref(exceptDefault, "#sec", "es")).toBe("#sec");
    expect(localizedHref(exceptDefault, "/about", "es")).toBe("/es/about");
  });
});

describe("localizedPath (prefix-all)", () => {
  it("prefixes every locale including the default", () => {
    expect(localizedPath(all, "/about", "en")).toBe("/en/about");
    expect(localizedPath(all, "/about", "es")).toBe("/es/about");
  });
});

describe("routeLocale (prefix-except-default)", () => {
  it("redirects an explicit default-locale prefix to the canonical bare path", () => {
    expect(routeLocale(exceptDefault, "/en/about")).toEqual({ type: "redirect", pathname: "/about" });
    expect(routeLocale(exceptDefault, "/en")).toEqual({ type: "redirect", pathname: "/" });
  });

  it("passes through a bare default path and a known non-default prefix", () => {
    expect(routeLocale(exceptDefault, "/about")).toEqual({ type: "next" });
    expect(routeLocale(exceptDefault, "/es/about")).toEqual({ type: "next" });
    expect(routeLocale(exceptDefault, "/")).toEqual({ type: "next" });
  });
});

describe("routeLocale (prefix-all)", () => {
  it("passes through a locale-prefixed path, rewrites a bare path under the default", () => {
    expect(routeLocale(all, "/es/about")).toEqual({ type: "next" });
    expect(routeLocale(all, "/about")).toEqual({ type: "rewrite", pathname: "/en/about" });
    expect(routeLocale(all, "/")).toEqual({ type: "rewrite", pathname: "/en" });
  });
});
