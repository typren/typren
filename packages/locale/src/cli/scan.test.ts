import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCAN_HELP, classifyKeys, collectSourceFiles, printScanResult, runScan, scanCommand } from "./scan";

let dir: string;
const w = (rel: string, body: string) => {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
};

const CATALOG = {
  home: { title: "Welcome, {name}", subtitle: "Hi" },
  nav: { home: "Home" },
  legal: { terms: "Terms" },
  errors: { notFound: "Nope", denied: "No" },
  common: { save: "Save" },
  welcome: "Hello",
  cart: { items_one: "{count} item", items_other: "{count} items" },
  status: { active: "Active" },
  menu: { open: "Open" },
  footer: { copy: "(c)" },
  old: { banner: "Old" },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scan-"));
  w("locales/en.json", JSON.stringify(CATALOG));
  w(
    "src/App.vue",
    `<template><p>{{ $t('home.title') }}</p><a v-t="'nav.home'"/><i18n-t keypath="legal.terms"/></template>\n<script>t(\`errors.\${code}\`)</script>`,
  );
  w(
    "src/Page.tsx",
    [
      `useTranslation('common');`,
      `t('save'); <Trans i18nKey="welcome"/>; t('cart:items', { count });`,
      `t('status.' + s); <FormattedMessage id="footer.copy"/>;`,
      `defineMessages({ open: { id: 'menu.open' } }); t(catalog, 'home.subtitle');`,
    ].join("\n"),
  );
  w("src/node_modules/x.js", `t('old.banner')`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = () => ({ sources: [join(dir, "src")], locales: join(dir, "locales") });

describe("runScan", () => {
  it("classifies used, dynamic and unused", async () => {
    const r = await runScan(base());
    expect(r.ok).toBe(false);
    expect(r.defaultLocale).toBe("en");
    expect(r.files).toBe(2);
    expect(r.used).toEqual([
      "cart.items_one", "cart.items_other", "common.save", "footer.copy", "home.subtitle",
      "home.title", "legal.terms", "menu.open", "nav.home", "welcome",
    ]);
    expect(r.dynamic).toEqual([
      { key: "errors.denied", prefix: "errors." },
      { key: "errors.notFound", prefix: "errors." },
      { key: "status.active", prefix: "status." },
    ]);
    expect(r.unused).toEqual(["old.banner"]);
  });

  it("allowUnused makes ok true", async () => {
    expect((await runScan({ ...base(), allowUnused: true })).ok).toBe(true);
  });

  it("react-intl alone still counts quoted literals equal to a key", async () => {
    const r = await runScan({ ...base(), presets: ["react-intl"] });
    expect(r.used).toContain("home.title");
    expect(r.used).toContain("footer.copy");
  });

  it("custom key pattern", async () => {
    w("src/Extra.ts", `translate('old.banner')`);
    const r = await runScan({ ...base(), keyPatterns: ["translate\\('([^']+)'"] });
    expect(r.unused).toEqual([]);
  });

  it("globs", async () => {
    const r = await runScan({ ...base(), sources: [join(dir, "src/*.vue")] });
    expect(r.files).toBe(1);
  });

  it.each([
    [() => ({ presets: ["nope" as never] }), /unknown --preset "nope"/],
    [() => ({ keyPatterns: ["("] }), /not a valid regex/],
    [() => ({ locales: join(dir, "missing") }), /--locales not found/],
    [() => ({ sources: [join(dir, "nowhere")] }), /source not found/],
    [() => ({ sources: [join(dir, "src/*.svelte")] }), /no source files matched/],
  ])("throws on bad input %#", async (patch, msg) => {
    await expect(runScan({ ...base(), ...patch() })).rejects.toThrow(msg);
  });

  it("needs a default locale among several", async () => {
    w("locales/fr.json", `{}`);
    await expect(runScan(base())).rejects.toThrow(/default locale/);
    expect((await runScan({ ...base(), defaultLocale: "en" })).defaultLocale).toBe("en");
  });
});

describe("collectSourceFiles", () => {
  it("keeps an explicit file of any extension", () => {
    w("notes.txt", "x");
    expect(collectSourceFiles([join(dir, "notes.txt")])).toEqual([join(dir, "notes.txt")]);
  });
});

describe("classifyKeys", () => {
  const refs = [{ key: "cart.items", dynamic: false, line: 1 }];
  it("plural suffixes follow the flag", () => {
    expect(classifyKeys(["cart.items_one"], refs, { pluralSuffixes: true }).used).toEqual(["cart.items_one"]);
    expect(classifyKeys(["cart.items_one"], refs, { pluralSuffixes: false }).unused).toEqual(["cart.items_one"]);
  });
  it("longest prefix wins", () => {
    const r = classifyKeys(
      ["a.b.c"],
      [{ key: "a.", dynamic: true, line: 1 }, { key: "a.b.", dynamic: true, line: 1 }],
      { pluralSuffixes: false },
    );
    expect(r.dynamic).toEqual([{ key: "a.b.c", prefix: "a.b." }]);
  });
});

describe("scanCommand", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
  const out = () => log.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

  it("exit 1 with human output", async () => {
    await scanCommand(["--locales", join(dir, "locales"), join(dir, "src")]);
    expect(process.exitCode).toBe(1);
    expect(out()).toContain("unused 1");
    expect(out()).toContain("errors.  errors.denied, errors.notFound");
    expect(out()).toContain("typren-locale scan: 1 unused key(s).");
  });

  it("--allow-unused exits 0; --json has the shape", async () => {
    await scanCommand(["--locales", join(dir, "locales"), join(dir, "src"), "--allow-unused", "--json"]);
    expect(process.exitCode).toBe(0);
    const j = JSON.parse(out());
    expect(Object.keys(j).sort()).toEqual(["defaultLocale", "dynamic", "files", "ok", "unused", "used"]);
    expect(j.ok).toBe(true);
  });

  it("clean run says so", async () => {
    w("src/Extra.ts", ["old.banner", "footer.copy", "home.subtitle", "home.title", "legal.terms", "menu.open", "nav.home"].map((k) => `t('${k}')`).join(";"));
    await scanCommand(["--locales", join(dir, "locales"), join(dir, "src"), "--preset", "i18next"]);
    expect(out()).toContain("no unused keys");
  });

  it.each([
    [[]],
    [["--locales", "x"]],
    [["--alow-unused", "src"]],
    [["--preset", "nope", "src"]],
    [["--key-pattern", "(", "src"]],
    [["--locales", "/no/such/dir", "src"]],
  ])("exit 2 for %j", async (argv) => {
    await scanCommand(argv);
    expect(process.exitCode).toBe(2);
    expect(err).toHaveBeenCalled();
  });

  it("suggests the flag", async () => {
    await scanCommand(["--alow-unused", "x"]);
    expect(err.mock.calls[0]![0]).toContain("--allow-unused");
  });

  it("missing default locale with several locale files exits 2", async () => {
    w("locales/fr.json", `{}`);
    await scanCommand(["--locales", join(dir, "locales"), join(dir, "src")]);
    expect(process.exitCode).toBe(2);
  });

  it("printScanResult json sets exit code", () => {
    printScanResult({ ok: false, defaultLocale: "en", files: 0, used: [], dynamic: [], unused: ["a"] }, { json: true });
    expect(process.exitCode).toBe(1);
  });

  it("help documents the contract", () => {
    for (const s of ["--key-pattern", "--allow-unused", "--json", "top-level key", "vue-i18n", "react-intl"]) {
      expect(SCAN_HELP).toContain(s);
    }
  });
});
