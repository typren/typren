import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSourceProvider } from "./fs-provider";

describe("createFsSourceProvider", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "typren-locale-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("exposes its type as 'files'", () => {
    expect(createFsSourceProvider(dir).type).toBe("files");
  });

  it("loadSource applies the default '_' -> '-' normalization to the catalog key", async () => {
    writeFileSync(join(dir, "en_US.json"), JSON.stringify({ Greeting: { Hello: "Hi" } }));
    const provider = createFsSourceProvider(dir);

    const catalogs = await provider.loadSource();

    expect(Object.keys(catalogs)).toEqual(["en-US"]);
    expect(catalogs["en-US"]).toEqual({ Greeting: { Hello: "Hi" } });
  });

  it("honors an explicit langMap override", async () => {
    writeFileSync(join(dir, "en_US.json"), JSON.stringify({ Greeting: { Hello: "Hi" } }));
    const provider = createFsSourceProvider(dir, { en_US: "en-custom" });

    const catalogs = await provider.loadSource();

    expect(Object.keys(catalogs)).toEqual(["en-custom"]);
  });

  it("leaves an already-dashed locale name unchanged", async () => {
    writeFileSync(join(dir, "fr.json"), JSON.stringify({ Greeting: "Salut" }));
    const provider = createFsSourceProvider(dir);

    const catalogs = await provider.loadSource();

    expect(Object.keys(catalogs)).toEqual(["fr"]);
  });

  it("ignores non-.json files in the directory", async () => {
    writeFileSync(join(dir, "en.json"), JSON.stringify({ A: "a" }));
    writeFileSync(join(dir, "README.md"), "not a catalog");
    const provider = createFsSourceProvider(dir);

    expect(Object.keys(await provider.loadSource())).toEqual(["en"]);
  });
});
