import { describe, expect, it } from "vitest";
import { USAGE_PRESET_NAMES, compileKeyPattern, findKeyRefs, type UsagePresetName } from "./usage-presets";

const keys = (src: string, presets: readonly UsagePresetName[] = USAGE_PRESET_NAMES, pats: RegExp[] = []) =>
  findKeyRefs(src, presets, pats).map((r) => (r.dynamic ? `${r.key}*` : r.key));

describe("findKeyRefs", () => {
  it("covers every vue-i18n site", () => {
    const src = [
      `$t('a.one')`,
      `this.$t("a.two")`,
      `i18n.global.t('a.three')`,
      `tc('a.four', 2)`,
      `te('a.five')`,
      `<p v-t="'a.six'"></p>`,
      `<p v-t="{ path: 'a.seven' }"></p>`,
      `<i18n-t keypath="a.eight" tag="p"/>`,
      `<i18n-t tag="p" :keypath="'a.nine'"/>`,
    ].join("\n");
    expect(keys(src, ["vue-i18n"])).toEqual(
      ["a.one", "a.two", "a.three", "a.four", "a.five", "a.six", "a.seven", "a.eight", "a.nine"],
    );
  });

  it("covers i18next sites", () => {
    expect(keys(`t('x.y'); <Trans i18nKey="x.z" />; <Trans i18nKey={'x.w'} />`, ["i18next"])).toEqual(["x.y", "x.z", "x.w"]);
  });

  it("covers react-intl sites", () => {
    const src = `<FormattedMessage id="r.a" /><FormattedHTMLMessage id={'r.b'} />\nintl.formatMessage({ id: 'r.c' })\ndefineMessages({ x: { id: "r.d" } })`;
    expect(keys(src, ["react-intl"])).toEqual(["r.a", "r.b", "r.c", "r.d"]);
  });

  it("covers typren sites", () => {
    expect(keys(`t(catalog, 'home.title', { name }); resolve(this.catalog, "home.sub")`, ["typren"])).toEqual(["home.title", "home.sub"]);
  });

  it("marks concatenation and template interpolation dynamic with a prefix", () => {
    expect(keys(`$t('a.b.' + x); $t(\`a.b.\${x}\`)`, ["vue-i18n"])).toEqual(["a.b.*"]);
  });

  it("drops a bare interpolation, empty key and variable argument", () => {
    expect(keys("$t(`${x}`); $t(''); $t(name); $t('open", ["vue-i18n"])).toEqual([]);
    expect(keys("$t(`a", ["vue-i18n"])).toEqual([]);
  });

  it("static backtick keys are static", () => {
    expect(keys("$t(`a.b`)", ["vue-i18n"])).toEqual(["a.b"]);
  });

  it("applies the i18next default namespace and ns: qualifier", () => {
    const src = `const { t } = useTranslation('common');\nt('save'); t('cart:items')`;
    expect(keys(src, ["i18next"])).toEqual(["save", "common.save", "cart.items"]);
  });

  it("does not match method calls like obj.format('x')", () => {
    expect(keys(`obj.format('x'); intl.format('y')`, ["vue-i18n"])).toEqual([]);
  });

  it("supports custom key patterns", () => {
    const re = compileKeyPattern("translate\\('([^']+)'\\)");
    expect(keys(`translate('c.one') translate('c.two')`, [], [re])).toEqual(["c.one", "c.two"]);
    expect(keys(`xa`, [], [/(a)/])).toEqual(["a"]);
  });

  it("reports 1-based line numbers and dedupes", () => {
    const refs = findKeyRefs(`a\n\n  $t('k')\n$t('k')`, ["vue-i18n"]);
    expect(refs.map((r) => r.line)).toEqual([3, 4]);
    expect(findKeyRefs(`t('k')`, ["vue-i18n", "i18next"])).toHaveLength(1);
  });

  it("filters by preset", () => {
    expect(keys(`$t('x')`, ["react-intl"])).toEqual([]);
  });
});

describe("compileKeyPattern", () => {
  it("rejects an invalid regex", () => {
    expect(() => compileKeyPattern("(")).toThrow('--key-pattern "(" is not a valid regex');
  });
  it("requires a capture group", () => {
    expect(() => compileKeyPattern("abc")).toThrow('--key-pattern "abc" needs a capture group (the key)');
  });
  it("returns a /g regex", () => {
    expect(compileKeyPattern("t\\((\\w+)\\)").flags).toContain("g");
  });
});

describe("findKeyRefs review fixes", () => {
  it("sites survive earlier attributes containing >", () => {
    const src = [
      `<Trans components={{ b: <strong /> }} i18nKey="home.rich" />`,
      `<FormattedMessage values={{ a: (c) => <a>{c}</a> }} id="home.link" />`,
      `<i18n-t :plural="n > 1" keypath="home.plural" />`,
    ].join("\n");
    expect(keys(src, ["i18next", "react-intl", "vue-i18n"])).toEqual(expect.arrayContaining(["home.rich", "home.link", "home.plural"]));
  });
  it("applies i18next keyPrefix", () => {
    const src = `const { t } = useTranslation('common', { keyPrefix: 'home' });\nt('title')`;
    expect(keys(src, ["i18next"])).toEqual(["title", "common.title", "home.title", "common.home.title"]);
  });
  it("counts quoted literals equal to a known key", () => {
    const src = `t(open ? 'menu.close' : 'menu.open'); const nav = [{ label: 'nav.home' }];`;
    const refs = findKeyRefs(src, ["i18next"], [], new Set(["menu.close", "menu.open", "nav.home", "other"]));
    expect(refs.map((r) => r.key).sort()).toEqual(["menu.close", "menu.open", "nav.home"]);
  });
});

describe("i18next namespace pattern", () => {
  it("scans long whitespace runs in linear time", () => {
    const src = `useTranslation(${" ".repeat(50_000)}x`;
    const start = performance.now();
    findKeyRefs(src, ["i18next"]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
