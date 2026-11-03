import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALIASES_FILE, aliasesPathFor, readAliasesFile, writeAliasesFile } from "./aliases-file";

describe("aliases-file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "typren-locale-aliases-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when the file is missing", () => {
    expect(readAliasesFile(join(dir, ALIASES_FILE))).toBeUndefined();
  });

  it("throws naming the path on invalid JSON", () => {
    const path = join(dir, ALIASES_FILE);
    writeFileSync(path, "{nope");
    expect(() => readAliasesFile(path)).toThrow(`${path} is not valid JSON`);
  });

  it("names the path when an entry is malformed", () => {
    const path = join(dir, ALIASES_FILE);
    writeFileSync(path, JSON.stringify({ "Menu.Start": 7 }));
    expect(() => readAliasesFile(path)).toThrow(path);
  });

  it("writes sorted keys and fixed field order with a trailing newline, and round-trips", () => {
    const path = join(dir, "nested", ALIASES_FILE);
    writeAliasesFile(path, {
      "Z.Old": { to: "Z.New", removeAfter: "2030-01-01", since: "2029-01-01" },
      "A.Old": { to: null, since: "2026-01-01" },
    });
    expect(readFileSync(path, "utf8")).toBe(
      `{\n  "A.Old": {\n    "to": null,\n    "since": "2026-01-01"\n  },\n  "Z.Old": {\n    "to": "Z.New",\n    "since": "2029-01-01",\n    "removeAfter": "2030-01-01"\n  }\n}\n`,
    );
    expect(Object.keys(readAliasesFile(path)!)).toEqual(["A.Old", "Z.Old"]);
  });

  it("aliasesPathFor: explicit wins, files source defaults, otherwise undefined", () => {
    const files = { type: "files" as const, dir };
    expect(aliasesPathFor(files, "x.json")).toBe("x.json");
    expect(aliasesPathFor(files)).toBe(join(dir, ALIASES_FILE));
    const remote = { type: "export-api" } as unknown as Parameters<typeof aliasesPathFor>[0];
    expect(aliasesPathFor(remote)).toBeUndefined();
  });
});
