import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { printAliasVerbResult, runAliasVerb, type AliasVerbResult } from "./aliases";

let dir: string;
const file = (n: string) => join(dir, n);
const write = (n: string, v: unknown, indent: string | number = 2, nl = true) =>
  writeFileSync(file(n), JSON.stringify(v, null, indent) + (nl ? "\n" : ""));
const read = (n: string) => readFileSync(file(n), "utf8");
const readJson = (n: string) => JSON.parse(read(n));
const run = (verb: Parameters<typeof runAliasVerb>[0], ...a: string[]) => runAliasVerb(verb, [...a, "--dir", dir], { now: new Date("2026-05-01T10:00:00Z") });
const fail = (r: AliasVerbResult) => {
  if (r.ok) throw new Error("expected failure");
  return r;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "typren-alias-verbs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const nested = { home: { title: "Home", sub: "Sub" }, landing: { intro: "Hi" }, other: { a: "A" } };

describe("rename", () => {
  it("renames in place within the same parent and records the alias", async () => {
    write("en.json", nested);
    write("fr.json", { home: { title: "Accueil", sub: "S" }, landing: { intro: "Salut" } });
    const r = await run("rename", "home.title", "home.heading");
    expect(r.ok).toBe(true);
    expect(Object.keys(readJson("en.json").home)).toEqual(["heading", "sub"]);
    expect(readJson("fr.json").home.heading).toBe("Accueil");
    expect(readJson("_aliases.json")).toEqual({ "home.title": { to: "home.heading", since: "2026-05-01" } });
    if (r.ok) expect(r.changedFiles).toEqual([file("en.json"), file("fr.json")]);
  });

  it("moves across parents, appends, and prunes the emptied parent", async () => {
    write("en.json", { home: { title: "Home" }, landing: { intro: "Hi" } });
    const r = await run("rename", "home.title", "landing.title", "--remove-after", "2027-01-01");
    expect(r.ok).toBe(true);
    expect(readJson("en.json")).toEqual({ landing: { intro: "Hi", title: "Home" } });
    expect(Object.keys(readJson("en.json").landing)).toEqual(["intro", "title"]);
    expect(readJson("_aliases.json")["home.title"].removeAfter).toBe("2027-01-01");
  });

  it("creates intermediate objects for a new path", async () => {
    write("en.json", { home: { title: "Home" }, keep: { a: "A" } });
    await run("rename", "home.title", "deep.er.title");
    expect(readJson("en.json")).toEqual({ keep: { a: "A" }, deep: { er: { title: "Home" } } });
  });

  it("renames in a flat file keeping position", async () => {
    write("en.json", { "home.title": "Home", "home.sub": "S", "z.k": "Z" });
    const r = await run("rename", "home.title", "landing.title");
    expect(r.ok).toBe(true);
    expect(Object.keys(readJson("en.json"))).toEqual(["landing.title", "home.sub", "z.k"]);
  });

  it("handles a nested and a flat locale together, skipping files without the key", async () => {
    write("en.json", nested);
    write("de.json", { "home.title": "Heim", "x.y": "Z" });
    write("fr.json", { landing: { intro: "Salut" }, home: { sub: "S" } });
    const before = read("fr.json");
    const r = await run("rename", "home.title", "landing.title");
    expect(r.ok).toBe(true);
    expect(readJson("de.json")).toEqual({ "landing.title": "Heim", "x.y": "Z" });
    expect(readJson("en.json").landing.title).toBe("Home");
    expect(read("fr.json")).toBe(before);
  });

  it("preserves tab and 4-space indent and trailing newline state", async () => {
    write("en.json", nested, "\t");
    write("fr.json", { home: { title: "A" } }, 4, false);
    await run("rename", "home.title", "home.heading");
    expect(read("en.json")).toBe(JSON.stringify(readJson("en.json"), null, "\t") + "\n");
    expect(read("fr.json")).toBe(JSON.stringify(readJson("fr.json"), null, 4));
    expect(read("fr.json").endsWith("\n")).toBe(false);
  });

  it("re-points an existing chain", async () => {
    write("en.json", { b: { x: "X" }, keep: "k" });
    write("_aliases.json", { "a.x": { to: "b.x", since: "2025-01-01" } });
    const r = await run("rename", "b.x", "c.x");
    expect(r.ok).toBe(true);
    expect(readJson("_aliases.json")).toEqual({
      "a.x": { to: "c.x", since: "2025-01-01" },
      "b.x": { to: "c.x", since: "2026-05-01" },
    });
  });

  it("uses --since", async () => {
    write("en.json", nested);
    await run("rename", "home.title", "home.heading", "--since", "v2");
    expect(readJson("_aliases.json")["home.title"].since).toBe("v2");
  });

  it("refuses an existing new key, and --force overwrites", async () => {
    write("en.json", { home: { title: "Old", sub: "S" }, landing: { title: "New" } });
    const before = read("en.json");
    const r = fail(await run("rename", "home.title", "landing.title"));
    expect(r.exitCode).toBe(1);
    expect(r.problems[0]).toContain("en.json");
    expect(read("en.json")).toBe(before);
    const forced = await run("rename", "home.title", "landing.title", "--force");
    expect(forced.ok).toBe(true);
    expect(readJson("en.json")).toEqual({ home: { sub: "S" }, landing: { title: "Old" } });
  });

  it("refuses a subtree target even with --force", async () => {
    write("en.json", { x: "X", home: { title: "T", body: "B" } });
    const before = read("en.json");
    const r = fail(await run("rename", "x", "home", "--force"));
    expect(r.exitCode).toBe(1);
    expect(r.problems[0]).toContain("is a subtree");
    expect(read("en.json")).toBe(before);
  });

  it("--force overwrite works when old and new keys sit in a flat file", async () => {
    write("en.json", { "a.x": "1", "b.x": "2" });
    expect((await run("rename", "a.x", "b.x", "--force")).ok).toBe(true);
    expect(readJson("en.json")).toEqual({ "b.x": "1" });
  });

  it("refuses when old is missing everywhere", async () => {
    write("en.json", nested);
    const r = fail(await run("rename", "nope.key", "x.y"));
    expect(r.exitCode).toBe(1);
  });

  it("refuses an intermediate leaf collision without writing", async () => {
    write("en.json", { home: { title: "T" }, landing: "leaf" });
    const before = read("en.json");
    const r = fail(await run("rename", "home.title", "landing.title"));
    expect(r.exitCode).toBe(1);
    expect(read("en.json")).toBe(before);
  });

  it("refuses when old or new is already an alias key", async () => {
    write("en.json", nested);
    write("_aliases.json", { "home.title": { to: "landing.intro", since: "s" }, "q.r": { to: "landing.intro", since: "s" } });
    expect(fail(await run("rename", "home.title", "z.z")).exitCode).toBe(1);
    expect(fail(await run("rename", "home.sub", "q.r")).exitCode).toBe(1);
  });

  it("refuses when old is missing from the default locale but present elsewhere, writing nothing", async () => {
    write("en.json", { landing: { intro: "Hi" } });
    write("fr.json", { home: { title: "Accueil" }, landing: { intro: "Salut" } });
    const before = [read("en.json"), read("fr.json")];
    const r = fail(await run("rename", "home.title", "landing.title"));
    expect(r.exitCode).toBe(1);
    expect(r.problems.join("\n")).toContain("target missing");
    expect([read("en.json"), read("fr.json")]).toEqual(before);
  });

  it("honours --default-locale", async () => {
    write("en.json", { landing: { intro: "Hi" } });
    write("fr.json", { home: { title: "Accueil" } });
    const r = await run("rename", "home.title", "landing.title", "--default-locale", "fr");
    expect(r.ok).toBe(true);
  });

  it("normalizes --default-locale against underscore filenames", async () => {
    write("en_US.json", { home: { title: "Hi" }, landing: { intro: "Hi" } });
    const r = await run("rename", "home.title", "landing.title", "--default-locale", "en_US");
    expect(r.ok).toBe(true);
  });

  it("keeps unrelated key order when the old parent empties", async () => {
    write("en.json", { a: { b: "1" }, z: "Z", n: { x: "X" } });
    await run("rename", "a.b", "n.y");
    expect(Object.keys(readJson("en.json"))).toEqual(["z", "n"]);
  });

  it("appends a brand-new parent last without moving others", async () => {
    write("en.json", { a: { b: "1" }, z: "Z" });
    await run("rename", "a.b", "q.b");
    expect(Object.keys(readJson("en.json"))).toEqual(["z", "q"]);
  });

  it("ignores symlinks and non-json files", async () => {
    write("en.json", nested);
    writeFileSync(file("notes.txt"), "x");
    mkdirSync(file("sub.json"));
    symlinkSync(file("en.json"), file("link.json"));
    const r = await run("rename", "home.title", "home.heading");
    expect(r.ok && r.changedFiles).toEqual([file("en.json")]);
  });

  it.each([
    [["bad..key", "x.y"], "bad key"],
    [["__proto__.x", "a.b"], "unsafe key"],
    [["a.b", "constructor.z"], "unsafe target"],
    [["a.b", "a.b"], "identical"],
    [["a", "a.b"], "prefix"],
    [["a.b.c", "a.b"], "reverse prefix"],
    [["a.b"], "missing positional"],
    [["a.b", "c.d", "e.f"], "extra positional"],
    [["a.b", "c.d", "--remove-after", "soon"], "bad date"],
    [["a.b", "c.d", "--remove-after"], "bare date flag"],
  ])("exits 2 for %j (%s)", async (args) => {
    write("en.json", nested);
    const before = read("en.json");
    expect(fail(await run("rename", ...args)).exitCode).toBe(2);
    expect(read("en.json")).toBe(before);
  });

  it("exits 2 on malformed alias file, invalid locale JSON, non-object, bad locale name, missing dir", async () => {
    write("en.json", nested);
    writeFileSync(file("_aliases.json"), "{nope");
    expect(fail(await run("rename", "home.title", "x.y")).exitCode).toBe(2);
    rmSync(file("_aliases.json"));
    writeFileSync(file("bad.json"), "{");
    expect(fail(await run("rename", "home.title", "x.y")).exitCode).toBe(2);
    writeFileSync(file("bad.json"), "[]");
    expect(fail(await run("rename", "home.title", "x.y")).exitCode).toBe(2);
    rmSync(file("bad.json"));
    writeFileSync(file("not a locale!.json"), "{}");
    expect(fail(await run("rename", "home.title", "x.y")).exitCode).toBe(2);
    expect(fail(await runAliasVerb("rename", ["a.b", "c.d", "--dir", file("missing")])).exitCode).toBe(2);
  });

  it("strips --json even before positionals", async () => {
    write("en.json", nested);
    const r = await runAliasVerb("rename", ["--json", "home.title", "home.heading", "--dir", dir]);
    expect(r.ok).toBe(true);
  });
});

describe("deprecate", () => {
  it("removes the key everywhere and records to:null", async () => {
    write("en.json", nested);
    write("de.json", { "home.title": "Heim", "x.y": "Z" });
    const r = await run("deprecate", "home.title", "--remove-after", "2027-02-02");
    expect(r.ok).toBe(true);
    expect(readJson("en.json").home).toEqual({ sub: "Sub" });
    expect(readJson("de.json")).toEqual({ "x.y": "Z" });
    expect(readJson("_aliases.json")).toEqual({ "home.title": { to: null, since: "2026-05-01", removeAfter: "2027-02-02" } });
  });

  it("prunes an emptied parent", async () => {
    write("en.json", { a: { b: "B" }, c: "C" });
    await run("deprecate", "a.b");
    expect(readJson("en.json")).toEqual({ c: "C" });
  });

  it("needs --force when the key is absent", async () => {
    write("en.json", nested);
    expect(fail(await run("deprecate", "gone.key")).exitCode).toBe(1);
    const r = await run("deprecate", "gone.key", "--force");
    expect(r.ok && r.changedFiles).toEqual([]);
    expect(readJson("_aliases.json")["gone.key"].to).toBeNull();
  });

  it("refuses when already aliased or another alias targets the key", async () => {
    write("en.json", nested);
    write("_aliases.json", { "old.t": { to: "home.title", since: "s" } });
    const before = read("en.json");
    const r = fail(await run("deprecate", "home.title"));
    expect(r.exitCode).toBe(1);
    expect(r.problems.join("\n")).toContain("target missing");
    expect(read("en.json")).toBe(before);
    expect(fail(await run("deprecate", "old.t")).exitCode).toBe(1);
  });

  it("refuses a subtree key", async () => {
    write("en.json", nested);
    const r = fail(await run("deprecate", "home"));
    expect(r.exitCode).toBe(1);
    expect(r.problems[0]).toContain("is a subtree");
  });

  it("refuses a key overlapping an existing alias", async () => {
    write("en.json", { x2: "X", y: "Y" });
    write("_aliases.json", { a: { to: "x2", since: "s" } });
    const r = fail(await run("deprecate", "a.b", "--force"));
    expect(r.exitCode).toBe(1);
    expect(r.problems.join("\n")).toContain("overlaps alias");
  });

  it("exits 2 without a key", async () => {
    expect(fail(await run("deprecate")).exitCode).toBe(2);
  });
});

describe("prune-aliases", () => {
  const aliases = {
    "a.a": { to: "z.z", since: "s", removeAfter: "2026-04-30" },
    "b.b": { to: null, since: "s", removeAfter: "2026-05-01" },
    "c.c": { to: "z.z", since: "s" },
    "d.d": { to: "z.z", since: "s", removeAfter: "2027-01-01" },
  };

  it("prunes past entries by the injected today and keeps the rest", async () => {
    write("_aliases.json", aliases);
    const r = await run("prune-aliases");
    expect(r.ok && r.pruned).toEqual(["a.a"]);
    expect(Object.keys(readJson("_aliases.json"))).toEqual(["c.c", "b.b", "d.d"].sort());
  });

  it("honours --older-than and writes {} when everything goes", async () => {
    write("_aliases.json", { "a.a": aliases["a.a"], "b.b": aliases["b.b"] });
    const r = await run("prune-aliases", "--older-than", "2030-01-01");
    expect(r.ok && r.pruned).toEqual(["a.a", "b.b"]);
    expect(readJson("_aliases.json")).toEqual({});
  });

  it("does not rewrite when nothing is pruned, and tolerates a missing file", async () => {
    write("_aliases.json", { "c.c": aliases["c.c"] }, 4);
    const before = read("_aliases.json");
    expect((await run("prune-aliases")).ok).toBe(true);
    expect(read("_aliases.json")).toBe(before);
    rmSync(file("_aliases.json"));
    const r = await run("prune-aliases");
    expect(r.ok && r.pruned).toEqual([]);
  });

  it("exits 2 on a bad date, an extra positional or a malformed file", async () => {
    expect(fail(await run("prune-aliases", "--older-than", "x")).exitCode).toBe(2);
    expect(fail(await run("prune-aliases", "extra")).exitCode).toBe(2);
    writeFileSync(file("_aliases.json"), "nope");
    expect(fail(await run("prune-aliases")).exitCode).toBe(2);
  });
});

describe("printAliasVerbResult", () => {
  let log: MockInstance<typeof console.log>;
  let err: MockInstance<typeof console.error>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  const ok = (extra: object): AliasVerbResult => ({ ok: true, verb: "rename", aliasesPath: "/x/_aliases.json", changedFiles: ["/x/en.json"], pruned: [], ...extra }) as AliasVerbResult;

  it("prints JSON only on stdout with exit codes 0/1/2", () => {
    printAliasVerbResult(ok({}), { json: true });
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(log.mock.calls[0]![0] as string).ok).toBe(true);
    for (const exitCode of [1, 2] as const) {
      printAliasVerbResult({ ok: false, verb: "rename", exitCode, problems: ["p"] }, { json: true });
      expect(process.exitCode).toBe(exitCode);
    }
    expect(log).toHaveBeenCalledTimes(3);
    expect(err).not.toHaveBeenCalled();
  });

  it("prints human lines per verb", () => {
    printAliasVerbResult(ok({ key: "home.title", to: "landing.title" }), { json: false });
    expect(log).toHaveBeenLastCalledWith('typren-locale rename: "home.title" → "landing.title" in 1 file(s); alias recorded in /x/_aliases.json');
    printAliasVerbResult(ok({ verb: "deprecate", key: "k" }), { json: false });
    expect(log).toHaveBeenLastCalledWith('typren-locale deprecate: "k" decommissioned in 1 file(s); alias recorded in /x/_aliases.json');
    printAliasVerbResult(ok({ verb: "prune-aliases", pruned: ["a", "b"] }), { json: false });
    expect(log.mock.calls.slice(-3).map((c) => c[0])).toEqual(["typren-locale prune-aliases: pruned 2 alias(es)", "  a", "  b"]);
  });

  it("prints problems on stderr", () => {
    printAliasVerbResult({ ok: false, verb: "deprecate", exitCode: 1, problems: ["one", "two"] }, { json: false });
    expect(err.mock.calls.map((c) => c[0])).toEqual(["typren-locale deprecate: one", "typren-locale deprecate: two"]);
    expect(process.exitCode).toBe(1);
  });
});
