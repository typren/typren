import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashCatalog } from "../canonicalize";
import type { Catalog } from "../types";
import { createFsSourceProvider } from "./fs-provider";
import { writeLocaleFiles } from "./write-locale-files";

describe("writeLocaleFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "typren-locale-write-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to 'dash' style: filename is the canonical key verbatim", () => {
    const paths = writeLocaleFiles({ "en-US": { Greeting: "Hi" } }, dir);

    expect(paths).toEqual({ "en-US": join(dir, "en-US.json") });
    expect(readdirSync(dir)).toEqual(["en-US.json"]);
  });

  it("'underscore' style swaps '-' for '_' in the filename", () => {
    const paths = writeLocaleFiles({ "en-US": { Greeting: "Hi" } }, dir, { filenameStyle: "underscore" });

    expect(paths).toEqual({ "en-US": join(dir, "en_US.json") });
    expect(readdirSync(dir)).toEqual(["en_US.json"]);
  });

  it("a custom filenameStyle function controls the filename directly", () => {
    const paths = writeLocaleFiles({ "en-US": { Greeting: "Hi" } }, dir, {
      filenameStyle: (locale) => `${locale}.lang.json`,
    });

    expect(paths).toEqual({ "en-US": join(dir, "en-US.lang.json") });
    expect(readdirSync(dir)).toEqual(["en-US.lang.json"]);
  });

  it("writes deterministic, sorted-key, 2-space-indented bytes with a trailing newline", () => {
    const catalog: Catalog = { Zebra: "last", Alpha: { Nested: "first" } };

    writeLocaleFiles({ en: catalog }, dir);
    const bytes = readFileSync(join(dir, "en.json"), "utf8");

    expect(bytes).toBe('{\n  "Alpha": {\n    "Nested": "first"\n  },\n  "Zebra": "last"\n}\n');

    const dirB = mkdtempSync(join(tmpdir(), "typren-locale-write-"));
    try {
      writeLocaleFiles({ en: catalog }, dirB);
      expect(readFileSync(join(dirB, "en.json"), "utf8")).toBe(bytes);
    } finally {
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("round-trips through the fs provider: same catalogs, same hashes", async () => {
    const catalogs: Record<string, Catalog> = {
      "en-US": { Greeting: { Hello: "Hi {name}" } },
      fr: { Greeting: { Hello: "Salut {name}" } },
    };

    writeLocaleFiles(catalogs, dir);
    const loaded = await createFsSourceProvider(dir).loadSource();

    expect(loaded).toEqual(catalogs);
    expect(await hashCatalog(loaded["en-US"]!)).toBe(await hashCatalog(catalogs["en-US"]!));
    expect(await hashCatalog(loaded.fr!)).toBe(await hashCatalog(catalogs.fr!));
  });
});
