import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAliasCopies,
  createAliasResolver,
  createI18nextParseMissingKeyHandler,
  createVueI18nMissingHandler,
  isIsoDate,
  isValidKeyPath,
  parseAliases,
  validateAliases,
  type AliasMap,
} from "./aliases";
import type { Catalog } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const e = (to: string | null) => ({ to, since: "1.0" });

describe("isValidKeyPath / isIsoDate", () => {
  it("validates key paths", () => {
    expect(isValidKeyPath("A.b")).toBe(true);
    for (const bad of ["", "a..b", ".a", "a.", "__proto__.x", "a.constructor", "prototype"]) {
      expect(isValidKeyPath(bad)).toBe(false);
    }
  });
  it("validates real ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
  });
});

describe("parseAliases", () => {
  const problem = (raw: unknown) => {
    try {
      parseAliases(raw);
    } catch (err) {
      return (err as Error).message;
    }
    return "";
  };

  it("normalizes valid input", () => {
    const out = parseAliases({ "A.b": { to: "C.d", since: "1.0", removeAfter: "2027-01-01" }, "E.f": e(null) });
    expect(out).toEqual({
      "A.b": { to: "C.d", since: "1.0", removeAfter: "2027-01-01" },
      "E.f": { to: null, since: "1.0" },
    });
  });
  it("rejects non-objects", () => {
    expect(problem([])).toContain("_aliases.json: must be a JSON object");
    expect(problem(null)).toContain("must be a JSON object");
  });
  it("reports each problem kind and joins them in one throw", () => {
    const msg = problem({
      "__proto__.x": e("a.b"),
      bad: "str",
      extra: { to: "a.b", since: "1", foo: 1 },
      noTo: { since: "1" },
      badTo: { to: "a..b", since: "1" },
      self: e("self"),
      noSince: { to: "a.b", since: "" },
      badDate: { to: "a.b", since: "1", removeAfter: "2026-02-30" },
      dateType: { to: "a.b", since: "1", removeAfter: 5 },
    });
    expect(msg).toMatch(/^_aliases\.json: /);
    for (const part of [
      '"__proto__.x" is not a valid key path',
      '"bad" entry must be an object',
      '"extra" has unknown field "foo"',
      '"noTo" needs "to"',
      '"badTo" needs "to"',
      '"self" aliases itself',
      '"noSince" needs a non-empty "since"',
      '"badDate" "removeAfter"',
      '"dateType" "removeAfter"',
    ]) {
      expect(msg).toContain(part);
    }
    expect(msg.split("; ").length).toBeGreaterThanOrEqual(9);
  });
  it("rejects unsafe targets", () => {
    expect(problem({ a: e("__proto__.x") })).toContain('"a" needs "to"');
  });
  it("rejects chains and 2-cycles", () => {
    expect(problem({ a: e("b"), b: e("c") })).toContain('"a" → "b" is a chain: "b" is itself an alias');
    const cycle = problem({ a: e("b"), b: e("a") });
    expect(cycle).toContain('"a" → "b" is a chain');
    expect(cycle).toContain('"b" → "a" is a chain');
  });
  it("rejects an alias key that is a dot-prefix of another", () => {
    expect(problem({ a: e("x"), "a.b": e("y") })).toContain('"a" overlaps alias "a.b"');
  });
  it("uses a custom label", () => {
    expect(() => parseAliases(1, "x.json")).toThrow(/^x\.json: /);
  });
});

describe("validateAliases", () => {
  const en: Catalog = { New: { A: "a" }, Old: { Keep: "k" } };
  const cats = { "en-US": en, "de-DE": { New: { A: "a" } } };

  it("is valid when targets exist and old keys are gone", () => {
    expect(validateAliases({ "Old.A": e("New.A") }, cats)).toEqual([]);
    expect(validateAliases({}, {})).toEqual([]);
  });
  it("reports a missing target in the default catalog", () => {
    expect(validateAliases({ "Old.A": e("New.Nope") }, cats)).toEqual([
      '"Old.A" → "New.Nope": target missing from default catalog "en-US"',
    ]);
  });
  it("rejects a target that is a subtree", () => {
    expect(validateAliases({ "Old.A": e("New") }, cats)).toHaveLength(1);
  });
  it("reports old key present as leaf or subtree, with decommissioned entries too", () => {
    expect(validateAliases({ "Old.Keep": e(null) }, cats)).toEqual(['"Old.Keep" is still present in "en-US"']);
    expect(validateAliases({ Old: e("New.A") }, cats)).toEqual(['"Old" is still present in "en-US"']);
  });
  it("reports a prefix-leaf collision", () => {
    const c = { "en-US": { New: { A: "a" }, P: "leaf" } };
    expect(validateAliases({ "P.x": e("New.A") }, c)).toEqual(['"P.x" collides with leaf "P" in "en-US"']);
  });
  it("sorts problems by key", () => {
    const out = validateAliases({ "Z.a": e("New.X"), "B.a": e("New.Y") }, cats);
    expect(out[0]).toContain('"B.a"');
    expect(out[1]).toContain('"Z.a"');
  });
  it("derives the default locale: en-US over de-DE, sorted[0] without en", () => {
    const cs = { "de-DE": { Only: { De: "x" } }, "en-US": { New: { A: "a" } } };
    expect(validateAliases({ "Old.A": e("New.A") }, cs)).toEqual([]);
    const noEn = { "fr-FR": { New: { A: "a" } }, "de-DE": { Other: { B: "b" } } };
    expect(validateAliases({ "Old.A": e("New.A") }, noEn)[0]).toContain('default catalog "de-DE"');
  });
  it("honours an explicit default locale and reports an unknown one", () => {
    expect(validateAliases({ "Old.A": e("New.A") }, cats, "de-DE")).toEqual([]);
    expect(validateAliases({ "Old.A": e("New.A") }, cats, "xx")).toEqual(['default locale "xx" has no catalog']);
  });
  it("reports empty catalogs", () => {
    expect(validateAliases({ a: e("b") }, {})).toEqual(["no locale catalogs to validate aliases against"]);
  });
});

describe("applyAliasCopies", () => {
  it("copies targets, skips null and missing, and does not mutate", () => {
    const catalog: Catalog = { New: { A: "a {x}" } };
    const snapshot = JSON.stringify(catalog);
    const out = applyAliasCopies(catalog, { "Old.A": e("New.A"), "Old.N": e(null), "Old.M": e("New.Nope") });
    expect(out).toEqual({ New: { A: "a {x}" }, Old: { A: "a {x}" } });
    expect(JSON.stringify(catalog)).toBe(snapshot);
  });
});

describe("createAliasResolver", () => {
  const map: AliasMap = { "Old.A": e("New.A"), "Old.Gone": e(null) };

  it("warns once per key with exact messages and fires the hook once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = vi.fn();
    const r = createAliasResolver(map, { warn: true, onDeprecatedKey: hook });
    expect(r.lookup("Old.A")).toBe("New.A");
    expect(r.lookup("Old.A")).toBe("New.A");
    expect(r.lookup("Old.Gone")).toBeNull();
    expect(warn.mock.calls).toEqual([['"Old.A" is deprecated → use "New.A"'], ['"Old.Gone" is decommissioned']]);
    expect(hook.mock.calls).toEqual([["Old.A", "New.A"], ["Old.Gone", null]]);
  });
  it("never warns for non-aliased keys, including prototype names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = createAliasResolver(map, { warn: true });
    expect(r.lookup("New.A")).toBeUndefined();
    expect(r.lookup("constructor")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
  it("swallows a throwing hook", () => {
    const r = createAliasResolver(map, {
      warn: false,
      onDeprecatedKey: () => {
        throw new Error("boom");
      },
    });
    expect(r.lookup("Old.A")).toBe("New.A");
  });
  it("warn:false is silent but still hooks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = vi.fn();
    createAliasResolver(map, { warn: false, onDeprecatedKey: hook }).lookup("Old.A");
    expect(warn).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
  });
  it("defaults to dev warnings and stays silent in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    createAliasResolver(map).lookup("Old.A");
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "development");
    createAliasResolver(map).lookup("Old.A");
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("counts a missing process as dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("process", undefined);
    try {
      createAliasResolver(map).lookup("Old.A");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("throws on a chain", () => {
    expect(() => createAliasResolver({ a: e("b"), b: e("c") })).toThrow(/chain/);
  });
});

describe("createVueI18nMissingHandler", () => {
  const messages: Record<string, unknown> = { "en-US": { New: { A: "hello" } }, "fr-FR": "weird" };
  const i18n = { getLocaleMessage: (l: string) => messages[l] };
  const handler = createVueI18nMissingHandler(
    i18n,
    createAliasResolver({ "Old.A": e("New.A"), "Old.M": e("New.Nope"), "Old.G": e(null) }, { warn: false }),
  );

  it("resolves the target in the locale's messages", () => {
    expect(handler("en-US", "Old.A")).toBe("hello");
  });
  it("falls back to t() when the stored message is precompiled", () => {
    const t = vi.fn(() => "compiled");
    const h = createVueI18nMissingHandler(
      { getLocaleMessage: () => ({ New: { A: () => "fn" } }), te: (k) => k === "New.A", t },
      createAliasResolver({ "Old.A": e("New.A") }, { warn: false }),
    );
    expect(h("en-US", "Old.A")).toBe("compiled");
    expect(t).toHaveBeenCalledWith("New.A", {}, { locale: "en-US" });
  });
  it("returns undefined for missing target, decommissioned, non-aliased and non-object messages", () => {
    expect(handler("en-US", "Old.M")).toBeUndefined();
    expect(handler("en-US", "Old.G")).toBeUndefined();
    expect(handler("en-US", "Other")).toBeUndefined();
    expect(handler("fr-FR", "Old.A")).toBeUndefined();
    expect(handler("xx", "Old.A")).toBeUndefined();
  });
});

describe("createI18nextParseMissingKeyHandler", () => {
  const translate = vi.fn((k: string, o?: Record<string, unknown>) => `${k}|${JSON.stringify(o)}`);
  const handler = createI18nextParseMissingKeyHandler(
    translate,
    createAliasResolver({ "Old.A": e("New.A"), "Old.G": e(null) }, { warn: false }),
  );

  it("forwards options to translate(target)", () => {
    expect(handler("Old.A", undefined, { n: 1 })).toBe('New.A|{"n":1}');
  });
  it("returns defaultValue or key when not aliased or decommissioned", () => {
    expect(handler("Other", "dflt")).toBe("dflt");
    expect(handler("Other")).toBe("Other");
    expect(handler("Old.G", "d")).toBe("d");
    expect(handler("Old.G")).toBe("Old.G");
  });
});
