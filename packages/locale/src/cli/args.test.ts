import { describe, expect, it } from "vitest";
import { parseArgs, parseStrictArgs, stringFlag, suggest } from "./args";

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

describe("parseStrictArgs", () => {
  const spec = { strings: ["config", "default-locale"], lists: ["key-pattern"], booleans: ["strict"] };
  const ok = (argv: string[]) => {
    const r = parseStrictArgs(argv, spec);
    if (!r.ok) throw new Error(r.error);
    return r.args;
  };
  const err = (argv: string[]) => {
    const r = parseStrictArgs(argv, spec);
    if (r.ok) throw new Error("expected failure");
    return r;
  };

  it("accepts the = form and the space form", () => {
    expect(ok(["--config=a.json"]).strings).toEqual({ config: "a.json" });
    expect(ok(["--config", "a.json", "--default-locale=x=y"]).strings).toEqual({ config: "a.json", "default-locale": "x=y" });
  });

  it("errors when a value is missing, with = as the escape hatch", () => {
    expect(err(["--config"]).error).toBe("--config needs a value");
    expect(err(["--config", "--json"]).error).toBe("--config needs a value");
    expect(ok(["--config=--x"]).strings.config).toBe("--x");
  });

  it("rejects a value on a boolean", () => {
    expect(err(["--json=1"]).error).toBe("--json takes no value");
  });

  it("reports unknown flags with and without a suggestion", () => {
    expect(err(["--confg", "x"]).error).toBe("unknown flag --confg (did you mean --config?)");
    expect(err(["--zzz"]).error).toBe("unknown flag --zzz");
  });

  it("treats a single-dash token as an unknown flag", () => {
    expect(err(["-x"]).error).toBe("unknown flag -x");
  });

  it("treats everything after -- as positional", () => {
    expect(ok(["a", "--", "--config", "b"]).positionals).toEqual(["a", "--config", "b"]);
  });

  it("collects lists in order and defaults them to []", () => {
    expect(ok(["--key-pattern", "a", "--key-pattern=b"]).lists["key-pattern"]).toEqual(["a", "b"]);
    expect(ok([]).lists["key-pattern"]).toEqual([]);
  });

  it("detects json on both branches and records booleans", () => {
    const a = ok(["--json", "--strict"]);
    expect(a.json).toBe(true);
    expect(a.booleans.has("strict")).toBe(true);
    expect(ok([]).json).toBe(false);
    expect(err(["--json", "--nope"]).json).toBe(true);
    expect(err(["--nope"]).json).toBe(false);
  });
});

describe("suggest", () => {
  it("fixes a verb typo", () => {
    expect(suggest("scna", ["scan", "check", "lint"])).toBe("scan");
  });
  it("returns undefined when nothing is close", () => {
    expect(suggest("zzz", ["config"])).toBeUndefined();
  });
  it("first candidate wins a tie", () => {
    expect(suggest("ab", ["aa", "bb"])).toBe("aa");
  });
});
