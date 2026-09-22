import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffLocaleDirs, printDiffResult } from "./diff";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-diff-"));
}

describe("diffLocaleDirs", () => {
  let dirA: string;
  let dirB: string;

  beforeEach(() => {
    dirA = withTmpDir();
    dirB = withTmpDir();
  });

  afterEach(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("reports content-equal when both dirs load to the same catalogs", async () => {
    writeFileSync(join(dirA, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(dirB, "en.json"), JSON.stringify({ Greeting: "Hi" }));

    const result = await diffLocaleDirs(dirA, dirB);
    expect(result).toEqual({ reports: [{ locale: "en", added: 0, changed: 0, removed: 0 }], hasDifferences: false });
  });

  it("ignores filename style and indentation, only compares content", async () => {
    writeFileSync(join(dirA, "en_US.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(dirB, "en-US.json"), `{\n  "Greeting": "Hi"\n}\n`);

    const result = await diffLocaleDirs(dirA, dirB);
    expect(result.hasDifferences).toBe(false);
  });

  it("splits added vs changed vs removed keys", async () => {
    writeFileSync(join(dirA, "en.json"), JSON.stringify({ Greeting: "Hi", Bye: "Bye" }));
    writeFileSync(join(dirB, "en.json"), JSON.stringify({ Greeting: "Hello", New: "New" }));

    const result = await diffLocaleDirs(dirA, dirB);
    expect(result.hasDifferences).toBe(true);
    expect(result.reports).toEqual([{ locale: "en", added: 1, changed: 1, removed: 1 }]);
  });

  it("reports a locale present in only one dir as fully added or fully removed", async () => {
    writeFileSync(join(dirA, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(dirB, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    writeFileSync(join(dirB, "fr.json"), JSON.stringify({ Greeting: "Salut", Bye: "Salut" }));

    const result = await diffLocaleDirs(dirA, dirB);
    expect(result.hasDifferences).toBe(true);
    expect(result.reports).toEqual([
      { locale: "en", added: 0, changed: 0, removed: 0 },
      { locale: "fr", added: 2, changed: 0, removed: 0 },
    ]);
  });

  it("printDiffResult exits 1 when different, 0 when content-equal", () => {
    process.exitCode = undefined;
    printDiffResult(dirA, dirB, { reports: [], hasDifferences: true });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    printDiffResult(dirA, dirB, { reports: [], hasDifferences: false });
    expect(process.exitCode).toBe(0);
  });
});
