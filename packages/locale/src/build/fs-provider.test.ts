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

  it("loadRawEntries keys entries by the ORIGINAL filename verbatim, untouched bytes", async () => {
    writeFileSync(join(dir, "en_US.json"), '{"Greeting":{"Hello":"Hi"}}'); // compact, not pretty-printed
    const provider = createFsSourceProvider(dir);

    const entries = await provider.loadRawEntries();

    expect(Object.keys(entries)).toEqual(["en_US.json"]);
    expect(Buffer.from(entries["en_US.json"]!).toString("utf8")).toBe('{"Greeting":{"Hello":"Hi"}}');
  });

  it("loadSource applies the default '_' -> '-' normalization to the catalog key only", async () => {
    writeFileSync(join(dir, "en_US.json"), JSON.stringify({ Greeting: { Hello: "Hi" } }));
    const provider = createFsSourceProvider(dir);

    const catalogs = await provider.loadSource();

    expect(Object.keys(catalogs)).toEqual(["en-US"]);
    expect(catalogs["en-US"]).toEqual({ Greeting: { Hello: "Hi" } });
  });

  it("loadSource honors an explicit langMap override, loadRawEntries stays verbatim regardless", async () => {
    writeFileSync(join(dir, "en_US.json"), JSON.stringify({ Greeting: { Hello: "Hi" } }));
    const provider = createFsSourceProvider(dir, { en_US: "en-custom" });

    const catalogs = await provider.loadSource();
    const raw = await provider.loadRawEntries();

    expect(Object.keys(catalogs)).toEqual(["en-custom"]);
    expect(Object.keys(raw)).toEqual(["en_US.json"]); // langMap never renames the raw drop-in filename
  });

  it("loadSource leaves an already-dashed locale name unchanged", async () => {
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
    expect(Object.keys(await provider.loadRawEntries())).toEqual(["en.json"]);
  });
});
