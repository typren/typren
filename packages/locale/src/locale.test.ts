import { describe, expect, it } from "vitest";
import { createAliasResolver } from "./aliases";
import { resolve, interpolate, t, getClosestLocale } from "./locale";
import type { Catalog } from "./types";

describe("resolve", () => {
  it("does dot-path lookup and returns { value }", () => {
    const catalog: Catalog = { Namespace: { KeyName: "hello" } };
    expect(resolve(catalog, "Namespace.KeyName")).toEqual({ value: "hello" });
    expect(resolve(catalog, "Namespace.Missing")).toBeUndefined();
    expect(resolve(catalog, "Namespace")).toBeUndefined(); // not a leaf string
  });
});

describe("interpolate", () => {
  it("substitutes {var}, leaves {{x}} alone, and leaves missing args literal", () => {
    expect(interpolate("hi {name}", { name: "Typren" })).toBe("hi Typren");
    expect(interpolate("keep {{x}} untouched", { x: "nope" })).toBe("keep {{x}} untouched");
    expect(interpolate("hi {name}", {})).toBe("hi {name}");
    expect(interpolate("hi {name}")).toBe("hi {name}");
  });
});

describe("t", () => {
  it("returns { value }, unknown key returns { value: key }", () => {
    const catalog: Catalog = { Greeting: { Hello: "Hi {name}" } };
    expect(t(catalog, "Greeting.Hello", { name: "World" })).toEqual({ value: "Hi World" });
    expect(t(catalog, "Greeting.Missing")).toEqual({ value: "Greeting.Missing" });
  });
});

describe("getClosestLocale", () => {
  it("keeps en-US and en-GB distinct", () => {
    const supported = ["en-US", "en-GB", "fr-FR"];
    expect(getClosestLocale(supported, "en-GB")).toBe("en-GB");
    expect(getClosestLocale(supported, "en-US")).toBe("en-US");
    // bare/unmatched "en" variant prefers en-US deterministically, not
    // whichever entry happens to sort first.
    expect(getClosestLocale(supported, "en-CA")).toBe("en-US");
  });

  it("falls back to language-only match, then supported[0]", () => {
    const supported = ["en-US", "fr-FR", "de-DE"];
    expect(getClosestLocale(supported, "fr-CA")).toBe("fr-FR");
    expect(getClosestLocale(supported, "ja-JP")).toBe("en-US"); // supported[0]
  });

  it("applies the override map before falling through to a language match", () => {
    const supported = ["es-US", "en-US"];
    const overrides = { "es-ES": "es-US" };
    expect(getClosestLocale(supported, "es-ES", overrides)).toBe("es-US");
    // no hardcoding: without the override, es-ES falls through to language match
    expect(getClosestLocale(supported, "es-ES")).toBe("es-US"); // es-* language match anyway
    expect(getClosestLocale(["en-US"], "es-ES")).toBe("en-US"); // no es-* at all -> default
  });

  it("throws on an empty supported list", () => {
    expect(() => getClosestLocale([], "en-US")).toThrow(/non-empty/);
  });
});

describe("t with alias resolver", () => {
  const catalog: Catalog = { New: { Greet: "hi {name}" }, Old: { Copy: "copy" } };
  const aliases = createAliasResolver(
    {
      "Old.Greet": { to: "New.Greet", since: "1.0" },
      "Old.Copy": { to: "New.Missing", since: "1.0" },
      "Old.Gone": { to: null, since: "1.0" },
    },
    { warn: false },
  );

  it("resolves the target with interpolation", () => {
    expect(t(catalog, "Old.Greet", { name: "Ada" }, aliases)).toEqual({ value: "hi Ada" });
  });
  it("renders a decommissioned key as itself", () => {
    expect(t(catalog, "Old.Gone", undefined, aliases)).toEqual({ value: "Old.Gone" });
  });
  it("leaves non-aliased keys unchanged", () => {
    expect(t(catalog, "New.Greet", { name: "Bo" }, aliases)).toEqual({ value: "hi Bo" });
  });
  it("falls back to an old-key copy when the target is missing", () => {
    expect(t(catalog, "Old.Copy", undefined, aliases)).toEqual({ value: "copy" });
  });
});
