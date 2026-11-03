import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_HELP, checkCatalogs, checkCommand, printCheckResult, runCheck } from "./check";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "typren-locale-check-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
  vi.restoreAllMocks();
});
const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));

function basic() {
  write("en.json", { home: { title: "Welcome, {name}", sub: "Hi" }, bye: "Bye", blank: "" });
  write("fr.json", { "home.title": "Bienvenue, {name}", bye: "", "home.pad": "  ", "home.ghost": "x", blank: "x" });
  write("de.json", { home: { title: "Willkommen", sub: "Hallo" }, bye: "Tschuess", blank: "leer" });
}

describe("runCheck", () => {
  it("reports Object.prototype names as missing and extra", async () => {
    write("en.json", { toString: "a", valueOf: "b" });
    write("fr.json", { hasOwnProperty: "c" });
    const r = await runCheck({ locales: dir, defaultLocale: "en" });
    const fr = r.locales.find((l) => l.locale === "fr")!;
    expect(fr.missing).toEqual(["toString", "valueOf"]);
    expect(fr.extra).toEqual(["hasOwnProperty"]);
  });

  it("reports missing, empty and extra per locale", async () => {
    basic();
    const r = await runCheck({ locales: dir, defaultLocale: "en" });
    expect(r).toEqual({
      ok: false,
      defaultLocale: "en",
      locales: [
        { locale: "en", missing: [], empty: ["blank"], extra: [] },
        { locale: "de", missing: [], empty: [], extra: [] },
        { locale: "fr", missing: ["home.sub"], empty: ["bye", "home.pad"], extra: ["home.ghost", "home.pad"] },
      ],
    });
  });

  it("handles en_US.json with --default-locale en-US", async () => {
    write("en_US.json", { a: "A" });
    write("fr.json", { a: "A" });
    const r = await runCheck({ locales: dir, defaultLocale: "en-US" });
    expect(r.ok).toBe(true);
    expect(r.locales.map((l) => l.locale)).toEqual(["en-US", "fr"]);
  });

  it("rejects an unknown format", async () => {
    write("en.json", { a: "A" });
    await expect(runCheck({ locales: dir, format: "x" as never })).rejects.toThrow(
      'unknown --format "x" (expected one of: icu, vue-i18n, i18next, typren)',
    );
  });

  it("compares i18next plural families only with --format i18next", async () => {
    write("en.json", { item_one: "one", item_other: "many", plain: "p" });
    write("ja.json", { item_other: "x", plain: "p" });
    write("pl.json", { item_one: "a", item_few: "b", item_many: "c", item_other: "d", plain: "p" });
    const on = await runCheck({ locales: dir, defaultLocale: "en", format: "i18next" });
    expect(on.ok).toBe(true);
    const off = await runCheck({ locales: dir, defaultLocale: "en" });
    expect(off.locales.find((l) => l.locale === "ja")!.missing).toEqual(["item_one"]);
    expect(off.locales.find((l) => l.locale === "pl")!.extra).toEqual(["item_few", "item_many"]);
  });

  it("reports the whole family missing when the locale has none", async () => {
    write("en.json", { item_one: "one", item_other: "many" });
    write("ja.json", { other: "x" });
    const r = await runCheck({ locales: dir, defaultLocale: "en", format: "i18next" });
    expect(r.locales[1]).toEqual({ locale: "ja", missing: ["item_one", "item_other"], empty: [], extra: ["other"] });
  });
});

describe("checkCatalogs", () => {
  it("is ok for identical catalogs", () => {
    const loaded = { defaultLocale: "en", locales: ["en", "fr"], catalogs: { en: { a: "A" }, fr: { a: "B" } } };
    expect(checkCatalogs(loaded).ok).toBe(true);
  });
});

describe("printCheckResult", () => {
  it("sets exit 0 and prints complete", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printCheckResult(
      { ok: true, defaultLocale: "en", locales: [{ locale: "en", missing: [], empty: [], extra: [] }] },
      { json: false },
    );
    expect(process.exitCode).toBe(0);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "typren-locale check: default en, 1 locale(s)",
      "  en: ok",
      "typren-locale check: all locales complete.",
    ]);
  });

  it("sets exit 1 and prints details on problems", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printCheckResult(
      {
        ok: false,
        defaultLocale: "en",
        locales: [{ locale: "fr", missing: ["a"], empty: ["b"], extra: ["c"] }],
      },
      { json: false },
    );
    expect(process.exitCode).toBe(1);
    const out = log.mock.calls.map((c) => c[0]);
    expect(out).toContain("  fr: 1 missing, 1 empty, 1 extra");
    expect(out).toContain("    missing  a");
    expect(out).toContain("    empty    b");
    expect(out).toContain("    extra    c");
    expect(out.at(-1)).toBe("typren-locale check: problems found.");
  });
});

describe("checkCommand", () => {
  const run = async (argv: string[]) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await checkCommand(argv);
    return { out: log.mock.calls.map((c) => String(c[0])).join("\n"), err: err.mock.calls.map((c) => String(c[0])).join("\n") };
  };

  it("exits 0 when complete", async () => {
    write("en.json", { a: "A" });
    write("fr.json", { a: "B" });
    await run(["--locales", dir, "--default-locale", "en"]);
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 on problems and --json parses", async () => {
    basic();
    const { out } = await run(["--locales", dir, "--default-locale", "en", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(out).ok).toBe(false);
  });

  it("prints help", async () => {
    const { out } = await run(["--help"]);
    expect(out).toContain(CHECK_HELP.trim().split("\n")[0]);
    expect(process.exitCode).toBe(0);
  });

  it("exit 2 on unknown flag with suggestion", async () => {
    const { err } = await run(["--local", dir]);
    expect(process.exitCode).toBe(2);
    expect(err).toContain("did you mean --locales?");
  });

  it("exit 2 on positional", async () => {
    const { err } = await run([dir]);
    expect(process.exitCode).toBe(2);
    expect(err).toContain(`unexpected argument "${dir}" (pass the locale dir with --locales)`);
  });

  it("exit 2 on bad format", async () => {
    write("en.json", { a: "A" });
    const { err } = await run(["--locales", dir, "--format", "nope"]);
    expect(process.exitCode).toBe(2);
    expect(err).toContain('unknown --format "nope"');
  });

  it("exit 2 when the default is ambiguous", async () => {
    write("en.json", { a: "A" });
    write("fr.json", { a: "A" });
    const { err } = await run(["--locales", dir]);
    expect(process.exitCode).toBe(2);
    expect(err).toContain("cannot tell the default locale");
  });

  it("exit 2 with no source, and json error on stdout", async () => {
    const { err, out } = await run(["--json"]);
    expect(process.exitCode).toBe(2);
    expect(err).toContain("pass --locales");
    expect(JSON.parse(out).ok).toBe(false);
  });

  it("works from a config file source", async () => {
    mkdirSync(join(dir, "l"));
    writeFileSync(join(dir, "l", "en.json"), JSON.stringify({ a: "A" }));
    writeFileSync(join(dir, "c.json"), JSON.stringify({ app: "x", defaultLocale: "en", source: { type: "files", dir: join(dir, "l") } }));
    await run(["--config", join(dir, "c.json")]);
    expect(process.exitCode).toBe(0);
  });
});

describe("checkCatalogs plural families", () => {
  it("only treats prefixes with a default _other as families", () => {
    const loaded = {
      defaultLocale: "en",
      locales: ["en", "fr"],
      catalogs: { en: { step_one: "a", step_two: "b", item_one: "x", item_other: "xs" }, fr: { step_one: "a", item_many: "y" } },
    };
    expect(checkCatalogs(loaded, { pluralFamilies: true }).locales[1]).toEqual({ locale: "fr", missing: ["step_two"], empty: [], extra: [] });
  });
});
