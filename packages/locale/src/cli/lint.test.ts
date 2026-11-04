import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedCatalogs } from "./catalogs";
import type { FormatName } from "./formats";
import { LINT_HELP, lintCatalogs, lintCommand, printLintResult, runLint } from "./lint";

const cat = (en: Record<string, string>, ...rest: [string, Record<string, string>][]): LoadedCatalogs => ({
  defaultLocale: "en",
  locales: ["en", ...rest.map(([l]) => l)],
  catalogs: { en, ...Object.fromEntries(rest) },
});
const codes = (l: LoadedCatalogs, f: FormatName, to?: "typren") =>
  lintCatalogs(l, f, { to }).issues.map((i) => `${i.locale}:${i.key}:${i.severity}:${i.code}`);

describe("lintCatalogs icu", () => {
  it("flags placeholder mismatch with both sides", () => {
    const r = lintCatalogs(cat({ "home.title": "Welcome, {name}" }, ["fr", { "home.title": "Bienvenue, {nom}" }]), "icu");
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toBe("placeholders differ from en: missing {name}; extra {nom}");
    expect(r.counts.error).toBe(1);
  });
  it("flags select options differing, ignores plural categories", () => {
    const en = { a: "{g, select, m {He} f {She} other {They}}", b: "{n, plural, one {# x} other {# xs}}" };
    const fr = { a: "{g, select, m {Il} other {Iel}}", b: "{n, plural, one {# x} many {# x} other {# xs}}" };
    expect(codes(cat(en, ["fr", fr]), "icu")).toEqual(["fr:a:error:select-options"]);
    expect(codes(cat(en, ["fr", { a: "Il", b: fr.b }]), "icu")).toEqual(["fr:a:error:placeholder-mismatch", "fr:a:error:select-options"]);
  });
  it("flags plural missing other as syntax and html as info", () => {
    const l = cat({ n: "{n, plural, one {x} other {y}}", h: "<b>hi</b>" }, ["de", { n: "{n, plural, one {x}}", h: "<b>hi</b>" }]);
    expect(codes(l, "icu")).toEqual(["en:h:info:html", "de:h:info:html", "de:n:error:syntax"]);
  });
  it("reports default-locale syntax errors, skips empty values and extra keys", () => {
    const l = cat({ a: "{oops" , e: "" }, ["fr", { a: "{oops", e: "", extra: "{bad" }]);
    const r = lintCatalogs(l, "icu");
    expect(r.issues.map((i) => `${i.locale}:${i.key}`)).toEqual(["en:a", "fr:a"]);
  });
});

describe("lintCatalogs vue-i18n", () => {
  it("passes linked messages", () => {
    expect(codes(cat({ a: "@:b", b: "x" }, ["fr", { a: "@:b", b: "y" }]), "vue-i18n")).toEqual([]);
  });
  it("warns and errors on added @", () => {
    const r = lintCatalogs(cat({ a: "mail" }, ["fr", { a: "a@b" }]), "vue-i18n");
    expect(r.issues.map((i) => `${i.severity}:${i.code}`)).toEqual(["warning:special-char", "error:syntax"]);
    expect(r.issues[0]!.message).toBe(`adds "@", which vue-i18n treats as syntax; escape it as {'@'}`);
  });
  it("flags pipe branch mismatch", () => {
    expect(codes(cat({ a: "one | many" }, ["fr", { a: "un | deux | trois" }]), "vue-i18n")).toContain("fr:a:warning:plural-branches");
  });
});

describe("lintCatalogs i18next", () => {
  const en = { greet: "Hi {{name}}", item_one: "{{count}} item", item_other: "{{count}} items" };
  it("checks {{name}} parity", () => {
    expect(codes(cat(en, ["fr", { ...en, greet: "Salut {{nom}}" }]), "i18next")).toEqual(["fr:greet:error:placeholder-mismatch"]);
  });
  it("accepts ja with only _other, and _one omitting count", () => {
    expect(codes(cat(en, ["ja", { item_other: "{{count}}個" }]), "i18next")).toEqual([]);
    expect(codes(cat(en, ["fr", { item_one: "un objet", item_other: "{{count}} objets" }]), "i18next")).toEqual([]);
  });
  it("uses family counterpart for new members and flags missing _other", () => {
    const l = cat(en, ["ar", { item_few: "{{count}} x", item_two: "{{n}}" }]);
    expect(codes(l, "i18next")).toEqual(["ar:item_other:error:plural-family", "ar:item_two:error:placeholder-mismatch"]);
  });
  it("treats a prefix without a default _other as plain keys", () => {
    const l = cat({ p_one: "{{a}}" }, ["fr", { p_few: "{{a}}" }]);
    expect(codes(l, "i18next")).toEqual([]);
  });
  it("handles ordinal families separately", () => {
    const l = cat({ p_ordinal_one: "1st", p_ordinal_other: "nth", p_one: "x", p_other: "y" }, ["fr", { p_ordinal_other: "e" }]);
    expect(codes(l, "i18next")).toEqual([]);
  });
});

describe("lintCatalogs typren", () => {
  it("errors on {{x}} and ICU plural", () => {
    const l = cat({ a: "{{x}}", b: "{n, plural, one {a} other {b}}", c: "Hi {name}" });
    const r = lintCatalogs(l, "typren");
    expect(r.issues.map((i) => i.key)).toEqual(["a", "b"]);
    expect(r.issues.every((i) => i.code === "syntax")).toBe(true);
  });
});

describe("--to typren", () => {
  it("icu: plural, select, typed-arg", () => {
    const l = cat({ a: "{n, plural, one {a} other {b}}", b: "{g, select, m {a} other {b}}", c: "{n, number}", d: "Hi {name}" });
    const r = lintCatalogs(l, "icu", { to: "typren" });
    expect(r.to).toBe("typren");
    expect(r.issues.map((i) => i.message)).toEqual([
      "plural forms are not supported by typren's runtime (flat {var} only)",
      "ICU select is not supported by typren's runtime",
      "typed ICU arguments ({n, number}) render literally in typren",
    ]);
  });
  it("vue-i18n: linked", () => {
    expect(codes(cat({ a: "@:b", b: "x" }), "vue-i18n", "typren")).toEqual(["en:a:error:unsupported"]);
  });
  it("i18next: nesting, double-brace, formatter, plural family once per key", () => {
    const l = cat({ a: "$t(b)", b: "{{x}}", c: "{{v, uppercase}}", n_one: "{{count}} a", n_other: "{{count}} b" });
    const r = lintCatalogs(l, "i18next", { to: "typren" });
    expect(r.issues.filter((i) => i.key === "n_one")).toHaveLength(2);
    expect(r.issues.filter((i) => i.key === "c").map((i) => i.message)).toHaveLength(2);
    expect(r.issues.find((i) => i.key === "a")!.message).toContain("$t() nesting");
    expect(r.issues.find((i) => i.key === "b")!.message).toContain("rewrite as {name}");
  });
  it("plain {name} passes", () => {
    expect(codes(cat({ a: "Hi {name}" }), "icu", "typren")).toEqual([]);
  });
});

describe("commands", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-"));
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(s));
    vi.spyOn(console, "error").mockImplementation((s: string) => void err.push(s));
    process.exitCode = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });
  const write = (locale: string, data: object) => writeFileSync(join(dir, `${locale}.json`), JSON.stringify(data));
  const base = () => ["--locales", dir, "--default-locale", "en", "--format", "icu"];

  it("exit 0 with only warnings/info", async () => {
    write("en", { a: "<b>x</b>" });
    write("fr", { a: "<b>y</b>" });
    await lintCommand(base());
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("[info   ] en  a  html: contains HTML");
    expect(out.at(-1)).toBe("typren-locale lint: 0 error(s), 0 warning(s), 2 info.");
  });
  it("exit 1 on errors, json parses", async () => {
    write("en", { home: { title: "Welcome, {name}" } });
    write("fr", { home: { title: "Bienvenue" } });
    await lintCommand([...base(), "--json"]);
    expect(process.exitCode).toBe(1);
    const r = JSON.parse(out.join("\n"));
    expect(r.ok).toBe(false);
    expect(r.issues[0].key).toBe("home.title");
  });
  it("runLint rejects bad format and --to", async () => {
    await expect(runLint({ locales: dir, format: "xml" as FormatName })).rejects.toThrow("unknown --format");
    await expect(runLint({ locales: dir, format: "icu", to: "vue" as "typren" })).rejects.toThrow('--to only supports "typren"');
  });
  it("exit 2 on usage errors", async () => {
    write("en", { a: "x" });
    const cases: string[][] = [
      ["--locales", dir],
      [...base().slice(0, 4), "--format", "xml"],
      [...base(), "--to", "vue"],
      [...base(), "--fromat", "icu"],
      [...base(), "stray"],
    ];
    for (const argv of cases) {
      process.exitCode = 0;
      await lintCommand(argv);
      expect(process.exitCode).toBe(2);
    }
    expect(err.some((e) => e.includes("did you mean --format"))).toBe(true);
    expect(err.some((e) => e.includes("--format <icu|vue-i18n|i18next|typren> is required"))).toBe(true);
  });
  it("--help prints help; json failure emits error object", async () => {
    await lintCommand(["--help"]);
    expect(out[0]).toBe(LINT_HELP);
    out.length = 0;
    await lintCommand(["--json"]);
    expect(JSON.parse(out[0]!).ok).toBe(false);
  });
  it("printLintResult sets exit code", () => {
    printLintResult({ ok: true, defaultLocale: "en", format: "icu", issues: [], counts: { error: 0, warning: 0, info: 0 } }, { json: false });
    expect(process.exitCode).toBe(0);
  });
});

describe("lintCatalogs review fixes", () => {
  it("vue-i18n: differing branch counts between plurals warn; plural vs non-plural errors", () => {
    const r = lintCatalogs(cat({ a: "car | cars" }, ["ru", { a: "машина | машины | машин" }]), "vue-i18n");
    expect(r.issues.map((i) => `${i.severity}:${i.code}`)).toEqual(["warning:plural-branches"]);
    expect(r.ok).toBe(true);
    expect(codes(cat({ a: "car | cars" }, ["fr", { a: "voiture" }]), "vue-i18n")).toContain("fr:a:error:plural-branches");
  });
  it("vue-i18n: implicit {n}/{count} are ignored when plural", () => {
    const l = cat({ a: "none | {count} apples" }, ["ru", { a: "нет | {n} яблок" }]);
    expect(codes(l, "vue-i18n")).toEqual([]);
    expect(codes(cat({ a: "Hi {n}" }, ["fr", { a: "Salut" }]), "vue-i18n")).toContain("fr:a:error:placeholder-mismatch");
  });
  it("i18next: step_one/step_two without step_other are plain keys", () => {
    const en = { step_one: "First", step_two: "Second" };
    expect(codes(cat(en, ["fr", { step_one: "Premier", step_two: "Deuxieme" }]), "i18next")).toEqual([]);
    expect(codes(cat({ ...en, item_one: "{{count}} x", item_other: "{{count}} xs" }, ["fr", { ...en, item_one: "x" }]), "i18next")).toEqual([
      "fr:item_other:error:plural-family",
    ]);
  });
});
