import { describe, expect, it } from "vitest";
import { parseArgs, stringFlag } from "./args";

describe("parseArgs", () => {
  it("pairs --flag with the following value", () => {
    expect(parseArgs(["--config", "foo.json"]).flags).toEqual({ config: "foo.json" });
  });

  it("treats a --flag followed by another --flag (or nothing) as boolean true", () => {
    expect(parseArgs(["--dry-run", "--out", "dist"]).flags).toEqual({ "dry-run": true, out: "dist" });
    expect(parseArgs(["--help"]).flags).toEqual({ help: true });
  });

  it("collects non--flag tokens as positionals, regardless of where they fall", () => {
    const { positionals } = parseArgs(["lokalise2", "file", "download", "--token", "abc"]);
    expect(positionals).toEqual(["lokalise2", "file", "download"]);
  });
});

describe("stringFlag", () => {
  it("returns the value for a string flag", () => {
    expect(stringFlag({ config: "foo.json" }, "config")).toBe("foo.json");
  });

  it("returns undefined for a boolean flag or a missing key", () => {
    expect(stringFlag({ help: true }, "help")).toBeUndefined();
    expect(stringFlag({}, "config")).toBeUndefined();
  });
});
