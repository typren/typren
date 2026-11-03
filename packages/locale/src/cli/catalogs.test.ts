import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCatalogs } from "./catalogs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "typren-catalogs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, value: unknown) => {
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
  return join(dir, name);
};
const rejects = (p: Promise<unknown>, msg: string) => expect(p).rejects.toThrow(msg);

describe("loadCatalogs", () => {
  it("flattens nested, flat-dotted and mixed files", async () => {
    write("en.json", { home: { title: "Welcome, {name}" }, "home.sub": "Hi", cart: { "a.b": "x" } });
    const r = await loadCatalogs({ locales: dir });
    expect(r.catalogs.en).toEqual({ "home.title": "Welcome, {name}", "home.sub": "Hi", "cart.a.b": "x" });
  });

  it("normalizes en_US to en-US, including --default-locale", async () => {
    write("en_US.json", { a: "A" });
    write("fr.json", { a: "B" });
    const r = await loadCatalogs({ locales: dir, defaultLocale: "en_US" });
    expect(r.locales).toEqual(["en-US", "fr"]);
    expect(r.defaultLocale).toBe("en-US");
  });

  it("infers the default from a single file", async () => {
    const r = await loadCatalogs({ locales: write("de.json", { a: "A" }) });
    expect(r.defaultLocale).toBe("de");
    expect(r.catalogs.de).toEqual({ a: "A" });
  });

  it("takes the default from config and loads through a files source", async () => {
    const src = join(dir, "src");
    mkdirSync(src);
    writeFileSync(join(src, "en.json"), '{"a":"A"}');
    writeFileSync(join(src, "fr.json"), '{"a":"B"}');
    const config = write("cfg.json", { app: "demo", defaultLocale: "fr", source: { type: "files", dir: src } });
    const r = await loadCatalogs({ config });
    expect(r.locales).toEqual(["fr", "en"]);
  });

  it("lets --default-locale beat config and --locales beat the config source", async () => {
    const config = write("cfg.json", { app: "demo", defaultLocale: "fr", source: { type: "files", dir: "/nowhere" } });
    const sub = join(dir, "l");
    mkdirSync(sub);
    writeFileSync(join(sub, "en.json"), '{"a":"A"}');
    writeFileSync(join(sub, "fr.json"), '{"a":"B"}');
    const r = await loadCatalogs({ config, locales: sub, defaultLocale: "en" });
    expect(r.defaultLocale).toBe("en");
  });

  it("errors when the default is ambiguous, unknown, or the config is bad", async () => {
    write("en.json", { a: "A" });
    write("fr.json", { a: "B" });
    await rejects(loadCatalogs({ locales: dir }), "cannot tell the default locale: pass --default-locale <id> (found: en, fr)");
    await rejects(loadCatalogs({ locales: dir, defaultLocale: "de" }), 'default locale "de" has no catalog (found: en, fr)');
    const bad = write("cfg.json", { app: "x", defaultLocale: 3, source: { type: "files", dir } });
    await rejects(loadCatalogs({ config: bad }), "must be a string");
    await rejects(loadCatalogs({ config: join(dir, "nope.json") }), "config file not found");
  });

  it("errors on missing input, missing path and empty dir", async () => {
    await rejects(loadCatalogs({}), "pass --locales <dir|file> or --config <path>");
    await rejects(loadCatalogs({ locales: join(dir, "nope") }), "--locales not found");
    await rejects(loadCatalogs({ locales: dir }), "no <locale>.json catalogs found");
  });

  it("rejects non-string leaves but flattens arrays", async () => {
    await rejects(loadCatalogs({ locales: write("en.json", { a: { b: null } }) }), 'en: value at "a.b" is null');
    await rejects(loadCatalogs({ locales: write("en.json", { n: 3 }) }), 'value at "n" is number');
    await rejects(loadCatalogs({ locales: write("en.json", { n: true }) }), "is boolean");
    const r = await loadCatalogs({ locales: write("en.json", { a: ["x", "y"] }) });
    expect(r.catalogs.en).toEqual({ "a.0": "x", "a.1": "y" });
  });
});
