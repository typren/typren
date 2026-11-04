import { describe, expect, it } from "vitest";
import { FORMAT_NAMES, PLURAL_CATEGORIES, TYPREN_FEATURES, parseValue, pluralFamily } from "./formats";

describe("icu", () => {
  const icu = (v: string) => parseValue("icu", v);

  it("reads simple arguments", () => {
    expect(icu("Hi {name}")).toMatchObject({ placeholders: ["name"], features: ["placeholder"], errors: [] });
  });

  it("reads plurals with selects metadata", () => {
    const r = icu("{count, plural, one {# item} other {# items}}");
    expect(r.placeholders).toEqual(["count"]);
    expect(r.features).toEqual(["plural"]);
    expect(r.selects).toEqual([{ arg: "count", type: "plural", options: ["one", "other"] }]);
    expect(r.errors).toEqual([]);
  });

  it("flags a missing other and unknown categories", () => {
    expect(icu("{count, plural, one {x}}").errors).toEqual(['{count, plural} has no "other" option']);
    expect(icu("{count, plural, lots {x} other {y}}").errors).toEqual(['unknown plural category "lots" in {count, plural}']);
  });

  it("accepts =N, offset and selectordinal", () => {
    expect(icu("{n, plural, offset:1 =0 {none} other {#}}").errors).toEqual([]);
    expect(icu("{n, selectordinal, one {#st} other {#th}}").selects[0]!.type).toBe("selectordinal");
  });

  it("nests a select inside a plural", () => {
    const r = icu("{n, plural, one {{g, select, male {he} other {they}} has # item} other {{name} has #}}");
    expect(r.errors).toEqual([]);
    expect(r.placeholders).toEqual(["g", "n", "name"]);
    expect(r.features).toEqual(["placeholder", "plural", "select"]);
    expect(r.selects.map((s) => s.arg)).toEqual(["n", "g"]);
  });

  it("treats apostrophe-quoted braces as text", () => {
    expect(icu("'{'literal'}'")).toMatchObject({ placeholders: [], errors: [] });
    expect(icu("it''s {name}")).toMatchObject({ placeholders: ["name"], errors: [] });
    expect(icu("don't {name}").placeholders).toEqual(["name"]);
    expect(icu("'{unterminated").errors).toEqual([]);
    expect(icu("{n, plural, other {'#' items}}").errors).toEqual([]);
  });

  it("reads typed arguments", () => {
    expect(icu("{d, date, short}")).toMatchObject({ placeholders: ["d"], features: ["typed-arg"], errors: [] });
    expect(icu("{n, number}").features).toEqual(["typed-arg"]);
    expect(icu("{n, number, ::currency/USD}").errors).toEqual([]);
  });

  it("reports syntax errors", () => {
    expect(icu("{name").errors).toEqual(["unbalanced braces"]);
    expect(icu("stray }").errors).toEqual(["unbalanced braces"]);
    expect(icu("{a, foo}").errors).toEqual(['unknown argument type "foo" in {a, foo}']);
    expect(icu("{}").errors).toHaveLength(1);
    expect(icu("{a b}").errors).toHaveLength(1);
    expect(icu("{a, select}").errors).toHaveLength(1);
    expect(icu("{a, select, }").errors).toEqual(['{a, select} has no options']);
    expect(icu("{a, select, x y}").errors).toHaveLength(1);
    expect(icu("{n, plural, one {x").errors).toEqual(["unbalanced braces"]);
    expect(icu("{n, number, short").errors).toEqual(["unbalanced braces"]);
    expect(icu("{n x}").errors).toHaveLength(1);
    expect(icu("{a, select, x {y}").errors).toEqual(["unbalanced braces"]);
  });
});

describe("vue-i18n", () => {
  const vue = (v: string) => parseValue("vue-i18n", v);

  it("reads named, list and literal placeholders", () => {
    expect(vue("Hi {name} and { other }")).toMatchObject({ placeholders: ["name", "other"], features: ["placeholder"], errors: [] });
    expect(vue("{0} of {1}")).toMatchObject({ placeholders: ["0", "1"], features: ["list-placeholder"] });
    expect(vue("{'@'} and {'a|b'}")).toMatchObject({ placeholders: [], errors: [], specialChars: [] });
  });

  it("reads linked messages", () => {
    expect(vue("@:common.ok").features).toEqual(["linked"]);
    expect(vue("@.upper:x")).toMatchObject({ features: ["linked"], errors: [] });
    expect(vue("@:(a.b)").errors).toEqual([]);
  });

  it("rejects a bare @", () => {
    const r = vue("mail me at a@b");
    expect(r.errors).toEqual([`"@" must start a linked message (@:key); write {'@'} for a literal @`]);
    expect(r.specialChars).toEqual(["@"]);
  });

  it("counts pipe branches", () => {
    const r = vue("no apples | one apple | {count} apples");
    expect(r.pipeBranches).toBe(3);
    expect(r.features).toContain("plural");
    expect(r.specialChars).toEqual(["|"]);
    expect(vue("plain").pipeBranches).toBe(1);
  });

  it("records $ as a special char", () => {
    expect(vue("price $5").specialChars).toEqual(["$"]);
  });

  it("reports brace errors", () => {
    expect(vue("{").errors).toEqual(["unbalanced braces"]);
    expect(vue("}").errors).toEqual(["unbalanced braces"]);
    expect(vue("{}").errors).toEqual(["empty placeholder {}"]);
    expect(vue("{a b}").errors).toEqual(['invalid placeholder "{a b}"']);
  });
});

describe("i18next", () => {
  const i18 = (v: string) => parseValue("i18next", v);

  it("reads double-brace placeholders", () => {
    expect(i18("{{count}} items")).toMatchObject({ placeholders: ["count"], features: ["double-brace"], errors: [] });
    expect(i18("{{- html}}")).toMatchObject({ placeholders: ["html"], errors: [] });
    expect(i18("{{user.name}}").placeholders).toEqual(["user.name"]);
    expect(i18("{x} stays literal").placeholders).toEqual([]);
  });

  it("reads formatters and nesting", () => {
    expect(i18("{{date, datetime}}").features).toEqual(["double-brace", "formatter"]);
    expect(i18("$t(common.ok)").features).toEqual(["nesting"]);
    expect(i18("$t(a, { \"x\": (1) })").errors).toEqual([]);
  });

  it("reports unclosed and stray markers", () => {
    expect(i18("{{name").errors).toEqual(['unclosed "{{"']);
    expect(i18("a }} b").errors).toEqual(['stray "}}"']);
    expect(i18("$t(a").errors).toEqual(['unclosed "$t("']);
    expect(i18("{{ }}").errors).toHaveLength(1);
  });
});

describe("typren", () => {
  const typ = (v: string) => parseValue("typren", v);

  it("accepts flat placeholders", () => {
    expect(typ("Hi {name}")).toMatchObject({ placeholders: ["name"], features: ["placeholder"], errors: [] });
  });

  it("rejects what renders literally", () => {
    expect(typ("{{name}}").errors).toEqual(['"{{name}}" renders literally: typren only supports flat {var} placeholders']);
    expect(typ("{n, plural, other {x}}").errors).toHaveLength(1);
    expect(typ("{a b}").errors).toHaveLength(1);
    expect(typ("{}").errors).toHaveLength(1);
  });

  it("reports unbalanced braces", () => {
    expect(typ("{name").errors).toEqual(["unbalanced braces"]);
    expect(typ("name}").errors).toEqual(["unbalanced braces"]);
  });
});

describe("shared", () => {
  it("detects html in every profile", () => {
    for (const f of FORMAT_NAMES) expect(parseValue(f, "<b>x</b>").features).toContain("html");
    expect(parseValue("typren", "a < b").features).not.toContain("html");
  });

  it("exposes the typren feature set and plural categories", () => {
    expect(TYPREN_FEATURES.has("placeholder")).toBe(true);
    expect(TYPREN_FEATURES.has("plural")).toBe(false);
    expect(PLURAL_CATEGORIES).toHaveLength(6);
  });
});

describe("pluralFamily", () => {
  it("splits plural suffixes", () => {
    expect(pluralFamily("a_one")).toEqual({ base: "a", category: "one" });
    expect(pluralFamily("a_other")).toEqual({ base: "a", category: "other" });
    expect(pluralFamily("a_ordinal_two")).toEqual({ base: "a", category: "ordinal_two" });
    expect(pluralFamily("a_b_few")).toEqual({ base: "a_b", category: "few" });
  });
  it("rejects non-families", () => {
    expect(pluralFamily("_one")).toBeUndefined();
    expect(pluralFamily("a.b")).toBeUndefined();
  });
});
