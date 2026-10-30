import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli";
import { cliOwnerAuth, parseFlags, runContent } from "./content";
import * as telemetry from "./telemetry";

// A pre-push hook's GIT_DIR would point every git call below at the real checkout.
for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let site: string;
let extra: string[];
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(site, rel)), { recursive: true });
  fs.writeFileSync(path.join(site, rel), text);
};
const read = (rel: string) => fs.readFileSync(path.join(site, rel), "utf8");
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  extra.push(d);
  return d;
};

const SITE_DOC = "---\ntitle: Site\nnav:\n  - label: Home\n    href: /\n---\n";
function seed(dir: string) {
  site = dir;
  write("typren.config.json", JSON.stringify({ locales: ["en", "de"], defaultLocale: "en" }));
  write("content/home.md", "---\ntitle: Home\nslices:\n  - slice: hero\n    heading: Hi\n---\n");
  write("content/about.md", "---\ntitle: About\nslices: []\n---\n");
  write("content/site.md", SITE_DOC);
  write(".gitignore", "content/.drafts/\n.typren/.drafts/\n");
}
function gitInit() {
  sh(site, "init", "-q", "-b", "main");
  sh(site, "config", "user.name", "Test");
  sh(site, "config", "user.email", "test@example.test");
  sh(site, "add", ".");
  sh(site, "commit", "-q", "-m", "init");
}

// Parsed command output, probed freely by the assertions below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Run = { code: number; out: string; err: string; json: any };
async function run(args: string[], opts: { stdin?: string; cwd?: string } = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runContent(args, {
    cwd: opts.cwd ?? site,
    stdin: async () => opts.stdin ?? "",
    log: (t) => out.push(t),
    error: (t) => err.push(t),
  });
  const text = out.join("\n");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // text output
  }
  return { code, out: text, err: err.join("\n"), json };
}
const j = (...args: string[]) => run([...args, "--json"]);
const ok = async (...args: string[]) => {
  const r = await j(...args);
  expect(r.json, r.out + r.err).toMatchObject({ ok: true });
  return r.json;
};

beforeEach(() => {
  extra = [];
  seed(tmp("typren-content-"));
});
afterEach(() => {
  for (const d of extra) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseFlags", () => {
  it("splits positionals, value flags, =values and booleans, keeping - positional", () => {
    expect(parseFlags(["a", "--file=x.json", "--draft", "-", "--locale", "de"], { booleans: ["draft"], values: ["file"] })).toEqual({
      pos: ["a", "-"],
      flags: { file: "x.json", draft: true, locale: "de" },
    });
  });
  it("refuses unknown flags and a value flag with no value", () => {
    expect(() => parseFlags(["--basee-version", "1"], {})).toThrow("unknown flag --basee-version");
    expect(() => parseFlags(["--file"], { values: ["file"] })).toThrow("--file needs a value");
  });
});

describe("cliOwnerAuth", () => {
  it("allows every action", async () => {
    expect(await cliOwnerAuth.authorize({ action: "admin" })).toBe(true);
  });
});

describe("page", () => {
  it("lists, creates, reads, saves, publishes, renames, duplicates and deletes", async () => {
    const list = await ok("page", "list");
    expect(list.pages.map((p: { slug: string }) => p.slug).sort()).toEqual(["about", "home"]);
    expect(list.folders).toEqual([]);

    expect(await ok("page", "create", "Pricing Plans", "--draft")).toEqual({ ok: true, slug: "pricing-plans", draft: true });
    expect(await ok("page", "create", "Team", "--slug", "company/team")).toEqual({ ok: true, slug: "company/team", draft: false });
    expect(fs.existsSync(path.join(site, "content/company/team.md"))).toBe(true);

    const got = await ok("page", "get", "pricing-plans");
    expect(got).toMatchObject({ slug: "pricing-plans", hasDraft: true, page: { meta: { title: "Pricing Plans" } } });

    write("page.json", JSON.stringify({ meta: { title: "Plans" }, slices: [{ slice: "hero", heading: "Hello" }] }));
    const saved = await ok("page", "save", "pricing-plans", "--file", "page.json");
    expect(saved.slug).toBe("pricing-plans");
    expect(typeof saved.version).toBe("string");
    expect((await ok("page", "publish", "pricing-plans")).version).toEqual(expect.any(String));
    expect(read("content/pricing-plans.md")).toContain("heading: Hello");

    expect(await ok("page", "rename", "pricing-plans", "plans")).toEqual({ ok: true, slug: "plans", from: "pricing-plans" });
    expect(await ok("page", "duplicate", "plans")).toMatchObject({ slug: "plans-copy", from: "plans" });
    expect(await ok("page", "delete", "plans-copy")).toEqual({ ok: true, slug: "plans-copy" });
    expect(fs.existsSync(path.join(site, "content/plans-copy.md"))).toBe(false);

    const text = await run(["page", "list"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("plans\tPlans");
  });

  it("deletes only a page that exists, refusing home and folders", async () => {
    const refused = async (code: string, ...args: string[]) => {
      const r = await j("page", "delete", ...args);
      expect(r.code).toBe(1);
      expect(r.json).toMatchObject({ ok: false, code });
      return r.json.error;
    };
    expect(await refused("not-found", "ghost")).toBe('page "ghost" does not exist');
    expect(await refused("invalid", "home")).toBe("The home page can't be deleted.");
    write("content/docs/intro.md", "---\ntitle: Intro\nslices: []\n---\n");
    expect(await refused("invalid", "docs")).toMatch(/is a folder/);
    await ok("page", "create", "x", "--folder", "--slug", "press");
    expect(await refused("invalid", "press")).toMatch(/is a folder/);
    expect(await ok("page", "delete", "press", "--folder")).toEqual({ ok: true, folder: "press" });
    expect((await ok("page", "list")).folders).toEqual([]);
    expect(fs.existsSync(path.join(site, "content/home.md"))).toBe(true);
  });

  it("reads page content from a .md file and from stdin", async () => {
    write("p.md", "---\ntitle: From MD\nslices: []\n---\nBody text\n");
    await ok("page", "save", "about", "--file", "p.md");
    expect((await ok("page", "get", "about")).page).toMatchObject({ meta: { title: "From MD" }, body: expect.stringContaining("Body text") });
    const r = await run(["page", "save", "about", "--file", "-", "--json"], { stdin: '{"meta":{"title":"Piped"}}' });
    expect(r.json.ok).toBe(true);
    expect((await ok("page", "get", "about")).page.meta.title).toBe("Piped");
    const md = await run(["page", "save", "about", "--file", "-", "--json"], { stdin: "---\ntitle: Piped md\nslices: []\n---\n" });
    expect(md.json.ok).toBe(true);
  });

  it("creates a folder, and a page from sections and from a template", async () => {
    expect(await ok("page", "create", "x", "--folder", "--slug", "guides")).toEqual({ ok: true, folder: "guides" });
    expect((await ok("page", "list")).folders).toEqual(["guides"]);

    write("slices.json", JSON.stringify([{ slice: "hero", heading: "A" }]));
    const tpl = await ok("template", "save", "Standard", "--file", "slices.json");
    expect(await ok("page", "create", "From Tpl", "--template", tpl.template.id)).toMatchObject({ slug: "from-tpl", draft: true });
    expect((await ok("page", "get", "from-tpl")).page.slices).toEqual([{ slice: "hero", heading: "A" }]);
    const missing = await j("page", "create", "Nope", "--template", "zzz");
    expect(missing.json).toMatchObject({ ok: false, code: "not-found" });
  });

  it("discards a draft, sets meta, and keeps the menu in step with --nav", async () => {
    await ok("page", "save", "about", "--file", (write("a.json", '{"meta":{"title":"Edited"}}'), "a.json"));
    await ok("page", "discard", "about");
    expect((await ok("page", "get", "about")).hasDraft).toBe(false);

    expect(await j("page", "set", "about")).toMatchObject({ code: 1, json: { ok: false, code: "usage" } });
    await ok("page", "set", "about", "--title", "About us", "--description", "Who we are", "--noindex", "--nav");
    const meta = (await ok("page", "get", "about")).page.meta;
    expect(meta).toMatchObject({ title: "About us", description: "Who we are", noindex: true });
    expect((await ok("nav", "get")).nav.map((n: { href: string }) => n.href)).toEqual(["/", "/about"]);
    await ok("page", "set", "about", "--no-nav", "--no-noindex", "--description", "");
    expect((await ok("nav", "get")).nav).toHaveLength(1);
    expect((await ok("page", "get", "about")).page.meta.noindex).toBeUndefined();
  });

  it("adds, translates and untranslates", async () => {
    await ok("page", "translate", "about", "--to", "de");
    expect((await j("page", "get", "about", "--locale", "de")).json.ok).toBe(true);
    await ok("page", "untranslate", "about", "--locale", "de");
    expect(await j("page", "untranslate", "about")).toMatchObject({ json: { code: "usage" } });
    expect(await j("page", "translate", "about")).toMatchObject({ json: { code: "usage" } });
    expect((await j("page", "translate", "about", "--to", "../x")).json.ok).toBe(false);
  });

  it("reports a version conflict as exit 2 with the current version", async () => {
    const first = await ok("page", "save", "about", "--file", (write("a.json", '{"meta":{"title":"One"}}'), "a.json"));
    await ok("page", "save", "about", "--file", (write("a2.json", '{"meta":{"title":"Two"}}'), "a2.json"));
    const stale = await j("page", "save", "about", "--file", "a.json", "--base-version", first.version);
    expect(stale.code).toBe(2);
    expect(stale.json).toMatchObject({ ok: false, code: "conflict", currentVersion: expect.any(String) });
    expect(stale.json.error).toBe(
      `"about" changed since version ${first.version}; it is now ${stale.json.currentVersion}. Read it again and retry.`
    );
    expect((await j("page", "publish", "about", "--base-version", "nope")).code).toBe(2);
    expect((await j("page", "set", "about", "--title", "T", "--base-version", "nope")).code).toBe(2);
    const text = await run(["page", "save", "about", "--file", "a.json", "--base-version", first.version]);
    expect(text.code).toBe(2);
    expect(text.err).toContain("typren page: ");
  });

  it("reports a rename onto an existing page as exit 2, and a duplicate create too", async () => {
    const r = await j("page", "rename", "about", "home");
    expect(r).toMatchObject({ code: 2, json: { ok: false, code: "conflict" } });
    expect((await j("page", "create", "About")).json.ok).toBe(false);
  });

  it("surfaces validation errors from the slug rules and the adapter", async () => {
    expect(await j("page", "create", "x", "--slug", "Bad Slug")).toMatchObject({ code: 1, json: { ok: false, code: "invalid" } });
    expect((await j("page", "rename", "about", "-bad")).json.code).toBe("invalid");
    expect((await j("page", "save", "../evil", "--file", (write("a.json", '{"meta":{}}'), "a.json"))).json.ok).toBe(false);
    expect((await j("page", "get", "ghost")).json).toMatchObject({ ok: false, code: "not-found" });
    expect((await j("page", "rename", "home", "front")).json.ok).toBe(false);
  });

  it("rejects bad input files and usage", async () => {
    write("bad.json", "{nope");
    write("arr.json", "[]");
    write("x.txt", "hi");
    expect((await j("page", "save", "about", "--file", "bad.json")).json.code).toBe("input");
    expect((await j("page", "save", "about", "--file", "arr.json")).json.code).toBe("input");
    expect((await j("page", "save", "about", "--file", "x.txt")).json.code).toBe("input");
    expect((await j("page", "save", "about", "--file", "missing.json")).json.code).toBe("input");
    expect((await j("page", "save", "about")).json.code).toBe("usage");
    expect((await run(["page", "save", "about", "--file", "-", "--json"], { stdin: "{nope" })).json.code).toBe("input");
    write("slices-bad.json", '{"slice":"x"}');
    expect((await j("page", "create", "T", "--sections", "slices-bad.json")).json.code).toBe("input");
    expect((await j("page", "save")).json.code).toBe("usage");
    expect((await j("page")).json.code).toBe("usage");
    expect((await j("page", "frobnicate")).json.code).toBe("usage");
    expect((await j("page", "list", "--nope")).json.code).toBe("usage");
    expect((await j("page", "list", "--cwd", "/definitely/not/a/site")).json.ok).toBe(false);
  });

  it("fails clearly on an invalid studio block", async () => {
    write("typren.config.json", JSON.stringify({ studio: { media: { dir: "../x", publicPath: "/x" } } }));
    expect(await j("page", "list")).toMatchObject({ code: 1, json: { ok: false, code: "site" } });
  });
});

describe("page add-section and create --sections", () => {
  // The manifest imports slices/defaults.ts, which vitest only loads from inside the project.
  it("fills the slice's defaults from the site's defaults.ts", async () => {
    seed(fs.mkdtempSync(path.join(import.meta.dirname, "..", ".tmp-studio-")));
    extra.push(site);
    // Its own repo, so the outer checkout is never mistaken for the site's.
    gitInit();
    write("slices/defaults.ts", 'export const defaults = { hero: { heading: "Default", cta: "Go" }, text: { body: "x" } };\n');
    await ok("page", "save", "about", "--file", (write("a.json", '{"meta":{"title":"About"},"slices":[{"slice":"text","body":"first"}]}'), "a.json"));
    write("s.json", '{"slice":"hero","heading":"Mine"}');
    await ok("page", "add-section", "about", "--file", "s.json", "--at", "0");
    expect((await ok("page", "get", "about")).page.slices).toEqual([
      { slice: "hero", heading: "Mine", cta: "Go" },
      { slice: "text", body: "first" },
    ]);
    await ok("page", "add-section", "about", "--file", "s.json");
    expect((await ok("page", "get", "about")).page.slices).toHaveLength(3);

    write("slices.json", JSON.stringify([{ slice: "hero", heading: "A" }, { slice: "text" }]));
    expect(await ok("page", "create", "Landing", "--sections", "slices.json")).toEqual({ ok: true, slug: "landing", draft: true });
    expect((await ok("page", "get", "landing")).page.slices).toEqual([
      { slice: "hero", heading: "A", cta: "Go" },
      { slice: "text", body: "x" },
    ]);
    write("bad.json", '[{"slice":"nope"}]');
    expect((await j("page", "create", "Bad", "--sections", "bad.json")).json).toMatchObject({ ok: false, code: "invalid" });

    write("u.json", '{"slice":"nope"}');
    expect((await j("page", "add-section", "about", "--file", "u.json")).json).toMatchObject({ ok: false, code: "invalid" });
    expect((await j("page", "add-section", "about", "--file", "s.json", "--at", "x")).json.code).toBe("usage");
    expect((await j("page", "add-section", "about", "--file", "arr.json")).json.ok).toBe(false);
    fs.rmSync(path.join(site, "slices"), { recursive: true });
    expect((await j("page", "add-section", "about", "--file", "s.json")).json).toMatchObject({ ok: false, code: "site" });
  });
});

describe("template and section", () => {
  it("save, list, update, delete", async () => {
    write("slices.json", '[{"slice":"hero","heading":"A"}]');
    const t = (await ok("template", "save", "Home", "--file", "slices.json")).template;
    expect((await ok("template", "list")).templates).toHaveLength(1);
    write("slices2.json", '[{"slice":"hero","heading":"B"},{"slice":"text"}]');
    const up = await ok("template", "update", t.id, "--file", "slices2.json", "--name", "Home v2");
    expect(up.template).toMatchObject({ name: "Home v2", slices: [{ slice: "hero", heading: "B" }, { slice: "text" }] });
    const stale = await j("template", "update", t.id, "--file", "slices2.json", "--base-saved-at", t.savedAt);
    expect(stale).toMatchObject({ code: 2, json: { ok: false, code: "conflict" } });
    expect(await j("template", "update", "ghost", "--file", "slices2.json")).toMatchObject({ code: 1, json: { code: "missing" } });
    await ok("template", "delete", t.id);
    expect((await run(["template", "list"])).out).toBe("no templates");
    expect((await j("template", "save", "Bad", "--file", "x.json")).json.ok).toBe(false);
  });

  it("round-trips a saved section", async () => {
    write("s.json", '{"slice":"hero","heading":"A"}');
    const s = (await ok("section", "save", "Hero", "--file", "s.json")).section;
    expect((await run(["section", "list"])).out).toContain("Hero\thero");
    write("s2.json", '{"slice":"hero","heading":"B"}');
    expect((await ok("section", "update", s.id, "--file", "s2.json", "--name", "Hero 2")).section).toMatchObject({ name: "Hero 2", slice: { heading: "B" } });
    expect((await j("section", "update", s.id, "--file", "s2.json", "--base-saved-at", s.savedAt)).code).toBe(2);
    expect((await j("section", "update", "ghost", "--file", "s2.json")).json.code).toBe("missing");
    await ok("section", "delete", s.id);
    expect((await ok("section", "list")).sections).toEqual([]);
    expect((await run(["section", "list"])).out).toBe("no saved sections");
    expect((await j("section", "save", "Bad", "--file", (write("b.json", '{"heading":"x"}'), "b.json"))).json.code).toBe("input");
  });
});

describe("template and section folders", () => {
  it("creates, renames and deletes folders and moves entries into them, for both nouns", async () => {
    write("slices.json", '[{"slice":"hero"}]');
    write("s.json", '{"slice":"hero"}');
    const t = (await ok("template", "save", "Home", "--file", "slices.json")).template;
    const s = (await ok("section", "save", "Hero", "--file", "s.json")).section;
    for (const [noun, entry] of [["template", t], ["section", s]] as const) {
      expect(await ok(noun, "folder", "create", "a/b")).toEqual({ ok: true, folder: "a/b" });
      expect((await ok(noun, "folder", "list")).folders).toEqual(["a", "a/b"]);
      expect((await ok(noun, "move", entry.id, "a/b"))[noun]).toMatchObject({ folder: "a/b" });
      expect((await run([noun, "list"])).out).toContain("\ta/b");
      expect(await j(noun, "folder", "delete", "a")).toMatchObject({ code: 1, json: { ok: false, code: "invalid" } });
      expect(await ok(noun, "folder", "rename", "a", "c")).toEqual({ ok: true, folder: "a", to: "c" });
      expect(await j(noun, "move", entry.id, "/", "--base-saved-at", "stale")).toMatchObject({ code: 2, json: { code: "conflict" } });
      expect(await j(noun, "move", "ghost", "/")).toMatchObject({ code: 1, json: { code: "missing" } });
      await ok(noun, "move", entry.id, "/");
      await ok(noun, "folder", "delete", "c/b");
      await ok(noun, "folder", "delete", "c");
      expect((await run([noun, "folder", "list"])).out).toBe("no folders");
      expect(await j(noun, "folder", "create", "../x")).toMatchObject({ code: 1, json: { code: "invalid" } });
      expect(await j(noun, "folder", "zap", "x")).toMatchObject({ code: 1, json: { code: "usage" } });
      expect(await j(noun, "move", entry.id)).toMatchObject({ code: 1, json: { code: "usage" } });
    }
  });
});

describe("media", () => {
  it("uploads, lists, moves, reports usage and deletes, with folders", async () => {
    fs.writeFileSync(path.join(site, "logo.png"), PNG);
    const up = await ok("media", "upload", "logo.png", "--folder", "brand");
    const asset = up.asset;
    expect(asset.id.startsWith("brand/")).toBe(true);
    write("content/about.md", `---\ntitle: About\nslices:\n  - slice: hero\n    image: ${asset.url}\n---\n`);
    expect((await ok("media", "usage")).usage[asset.url]).toEqual([{ slug: "about", locale: "en", count: 1 }]);
    expect((await run(["media", "usage"])).out).toContain("about x1");

    expect((await ok("media", "list")).assets).toHaveLength(1);
    await ok("media", "folder", "create", "archive");
    expect((await run(["media", "list"])).out).toContain("archive/\t(folder)");
    const moved = (await ok("media", "move", asset.id, "archive", "--name", "mark")).asset;
    expect(moved.url).toContain("/archive/mark");
    // References follow the move.
    expect(read("content/about.md")).toContain(moved.url);
    await ok("media", "folder", "rename", "archive", "old");
    expect((await ok("media", "list")).folders).toContain("old");
    const inUse = await j("media", "delete", `old/${path.basename(moved.url)}`);
    expect(inUse.code).toBe(1);
    expect(inUse.json).toMatchObject({ ok: false, code: "invalid", error: expect.stringContaining("is used on about") });
    await ok("media", "delete", `old/${path.basename(moved.url)}`, "--force");
    await ok("media", "folder", "delete", "old");

    expect((await j("media", "upload", "missing.png")).json.code).toBe("input");
    fs.writeFileSync(path.join(site, "x.exe"), "MZ");
    expect((await j("media", "upload", "x.exe")).json.code).toBe("upload");
    expect((await j("media", "folder", "explode", "a")).json.code).toBe("usage");
    expect((await j("media", "folder", "rename", "a")).json.code).toBe("usage");
    expect((await j("media", "move", "../../x", "a")).json.ok).toBe(false);
    expect((await run(["media", "usage"])).out).not.toContain("logo");
  });
});

describe("settings and style", () => {
  it("sets runtime settings as a draft, then publishes", async () => {
    expect((await ok("settings", "get")).settings).toEqual({ brand: { name: "" }, seo: {} });
    await ok("settings", "set", "brand.name", "Acme");
    await ok("settings", "set", "seo.description", '"Great, "');
    const got = await ok("settings", "get");
    expect(got).toMatchObject({ hasDraft: true, settings: { brand: { name: "Acme" } }, bootstrap: { locales: ["en", "de"] } });
    expect((await run(["settings", "get"])).out).toContain('"name": "Acme"');
    await ok("settings", "publish");
    expect((await ok("settings", "get")).hasDraft).toBe(false);
    expect((await ok("settings", "get")).settings.seo.description).toBe("Great, ");
  });

  it("refuses bad keys and the keys other commands own", async () => {
    expect((await j("settings", "set", "__proto__.x", "1")).json.code).toBe("invalid");
    expect((await j("settings", "set", "a b", "1")).json.code).toBe("invalid");
    expect((await j("settings", "set", "style.x", "1")).json.code).toBe("usage");
    expect((await j("settings", "set", "bootstrap.locales", "1")).json.code).toBe("usage");
    await ok("settings", "set", "brand.name", "Acme");
    expect((await j("settings", "set", "brand.name.first", "x")).json.code).toBe("invalid");
    expect((await j("settings", "set", "brand.name", "B", "--base-version", "stale")).code).toBe(2);
    expect((await j("settings", "set", "onlykey")).json.code).toBe("usage");
  });

  it("writes bootstrap keys through the store's validation", async () => {
    await ok("settings", "bootstrap", "set", "locales", "en,fr");
    expect(JSON.parse(read("typren.config.json")).locales).toEqual(["en", "fr"]);
    await ok("settings", "bootstrap", "set", "onboarded", "true");
    expect(JSON.parse(read("typren.config.json")).onboarded).toBe(true);
    expect((await j("settings", "bootstrap", "set", "routing", "sideways")).json).toMatchObject({ ok: false, code: "invalid" });
    expect((await j("settings", "bootstrap", "set", "bogus", "1")).json.code).toBe("invalid");
    expect((await j("settings", "bootstrap", "get", "x")).json.code).toBe("usage");
  });

  it("gets, sets, unsets and publishes style tokens", async () => {
    expect((await run(["style", "get"])).out).toBe("no style tokens set");
    await ok("style", "set", "primary", "#ff0000");
    await ok("style", "set", "typren-radius", "8px");
    expect((await ok("style", "get")).style).toEqual({ "--typren-primary": "#ff0000", "--typren-radius": "8px" });
    expect((await run(["style", "get"])).out).toContain("--typren-primary: #ff0000");
    await ok("style", "unset", "radius");
    await ok("style", "publish");
    expect((await ok("style", "get"))).toMatchObject({ style: { "--typren-primary": "#ff0000" }, hasDraft: false });
  });

  it("refuses an unsafe style value and an unknown token", async () => {
    expect((await j("style", "set", "primary", "red; } body { display:none"))).toMatchObject({ code: 1, json: { ok: false, code: "invalid" } });
    expect((await j("style", "set", "primary", "url(http://evil.test/x)")).json.code).toBe("invalid");
    expect((await j("style", "set", "bogus", "red")).json.code).toBe("invalid");
    expect((await j("style", "unset", "bogus")).json.code).toBe("invalid");
    expect((await ok("style", "get")).style).toEqual({});
  });
});

describe("nav", () => {
  it("reads, sets and publishes the menu", async () => {
    expect((await ok("nav", "get")).cta).toBeNull();
    write("nav.json", JSON.stringify({ nav: [{ label: "Home", href: "/" }, { label: "Docs", href: "https://example.test/docs" }], cta: { label: "Go", href: "/go" } }));
    await ok("nav", "set", "--file", "nav.json");
    expect(await ok("nav", "get")).toMatchObject({ hasDraft: true, cta: { href: "/go" } });
    expect((await run(["nav", "get"])).out).toContain("Docs");
    await ok("nav", "publish");
    expect(read("content/site.md")).toContain("https://example.test/docs");
    await run(["nav", "set", "--file", "-", "--json"], { stdin: '{"nav":[]}' });
    expect((await ok("nav", "get")).cta).toBeNull();
  });

  it("refuses an unsafe link, bad files, and a site with no menu", async () => {
    write("evil.json", '{"nav":[{"label":"x","href":"javascript:alert(1)"}]}');
    const r = await j("nav", "set", "--file", "evil.json");
    expect(r).toMatchObject({ code: 1, json: { ok: false, code: "error" } });
    expect(r.json.error).toContain("refused");
    expect(read("content/site.md")).toBe(SITE_DOC);
    write("notnav.json", '{"links":[]}');
    expect((await j("nav", "set", "--file", "notnav.json")).json.code).toBe("input");
    expect((await j("nav", "set", "--file", "nav-missing.json")).json.code).toBe("input");

    write("content/site.md", "---\ntitle: Site\n---\n");
    expect((await j("nav", "get")).json.code).toBe("not-found");
    fs.rmSync(path.join(site, "content/site.md"));
    expect((await j("nav", "set", "--file", "notnav.json")).json.code).toBe("input");
    write("ok.json", '{"nav":[]}');
    expect((await j("nav", "set", "--file", "ok.json")).json.code).toBe("not-found");
  });
});

describe("without git", () => {
  it("saves and publishes pending drafts in place", async () => {
    await ok("page", "create", "Draft One", "--draft");
    await ok("page", "create", "Draft Two", "--draft");
    expect((await ok("status")).git).toBe(false);
    expect((await run(["status"])).out).toContain("not a git checkout");
    expect((await ok("status")).drafts.sort()).toEqual(["draft-one", "draft-two"]);

    expect(await ok("save", "draft-one", "about")).toEqual({ ok: true, saved: ["draft-one"], skipped: ["about"] });
    expect(fs.existsSync(path.join(site, "content/draft-one.md"))).toBe(true);
    expect(await ok("publish")).toEqual({ ok: true, published: ["draft-two"] });
    expect((await run(["publish"])).out).toBe("nothing to publish");
    expect((await run(["save"])).out).toBe("nothing to save");
  });
});

// Each test here runs real git (init, several commits, a push to a bare
// remote); under coverage instrumentation that outgrows the 5s default.
describe("with git", { timeout: 30_000 }, () => {
  beforeEach(gitInit);

  it("commits each save, reports status, and pushes", async () => {
    const remote = tmp("typren-remote-");
    sh(remote, "init", "-q", "--bare", "-b", "main");
    sh(site, "remote", "add", "origin", remote);
    sh(site, "push", "-q", "-u", "origin", "main");

    expect(await ok("status")).toMatchObject({ git: true, branch: "main", detached: false, upstream: "origin/main", outgoing: [], drafts: [] });

    await ok("page", "create", "New One", "--draft");
    await ok("page", "save", "home", "--file", (write("h.json", '{"meta":{"title":"Home 2"}}'), "h.json"));
    await ok("settings", "set", "brand.name", "Acme");
    await ok("nav", "set", "--file", (write("n.json", '{"nav":[]}'), "n.json"));
    const status = await ok("status");
    expect(status.drafts.sort()).toEqual(["home", "new-one", "site"]);
    expect(status).toMatchObject({ settingsDraft: true, navDraft: true });
    expect((await run(["status"])).out).toContain("settings has a draft");

    expect((await ok("save")).saved.sort()).toEqual(["home", "new-one", "site"]);
    expect(sh(site, "log", "--format=%s", "-3").split("\n").sort()).toEqual(["content: update home", "content: update navigation", "content: update new-one"]);
    await ok("settings", "publish");
    expect(sh(site, "log", "--format=%s", "-1")).toBe("content: update settings");

    const out = await ok("status");
    expect(out.outgoing).toHaveLength(4);
    expect((await run(["status"])).out).toContain("outgoing commits: 4");
    expect(await ok("publish")).toEqual({ ok: true, pushed: 4 });
    expect(sh(remote, "log", "--format=%s", "-1")).toMatch(/^content: update/);
  });

  it("lists saved changes per file, pushes some and discards others", async () => {
    const remote = tmp("typren-remote-");
    sh(remote, "init", "-q", "--bare", "-b", "main");
    sh(site, "remote", "add", "origin", remote);
    sh(site, "push", "-q", "-u", "origin", "main");
    expect((await run(["changes", "list"])).out).toBe("nothing waiting to push");

    await ok("page", "save", "home", "--file", (write("h.json", '{"meta":{"title":"Home 2"}}'), "h.json"));
    await ok("page", "save", "about", "--file", (write("a.json", '{"meta":{"title":"About 2"}}'), "a.json"));
    await ok("save");
    // A developer's code commit in the site folder is not content.
    write("app/page.tsx", "export default 1;\n");
    sh(site, "add", "app/page.tsx");
    sh(site, "commit", "-q", "-m", "feat: code");
    expect((await j("changes", "push", "app/page.tsx")).json).toMatchObject({ ok: false, code: "git" });
    const list = await ok("changes", "list");
    const paths = list.changes.map((c: { path: string }) => c.path);
    expect(paths).toHaveLength(2);
    const [about, home] = paths.sort();
    expect((await run(["changes", "list"])).out).toContain(`modified ${home}`);

    expect(await ok("changes", "push", home)).toEqual({ ok: true, pushed: [home] });
    expect(sh(remote, "show", `main:${home}`)).toContain("Home 2");
    expect(await ok("changes", "discard", about)).toEqual({ ok: true, discarded: [about] });
    expect((await ok("changes", "list")).changes).toEqual([]);
    expect(read(about)).not.toContain("About 2");

    const r = await j("changes", "discard", "../escape.md");
    expect(r).toMatchObject({ code: 1, json: { ok: false, code: "git" } });
    expect((await j("changes", "push", home)).json.code).toBe("git");
  });

  it("pushes page drafts one commit each, and reads a page's history", async () => {
    const remote = tmp("typren-remote-");
    sh(remote, "init", "-q", "--bare", "-b", "main");
    sh(site, "remote", "add", "origin", remote);
    sh(site, "push", "-q", "-u", "origin", "main");
    await ok("page", "save", "home", "--file", (write("h.json", '{"meta":{"title":"Home 2"}}'), "h.json"));
    await ok("page", "save", "about", "--file", (write("a.json", '{"meta":{"title":"About 2"}}'), "a.json"));
    expect((await ok("changes", "list")).drafts.sort()).toEqual(["about", "home"]);
    expect((await run(["changes", "list"])).out).toContain("draft    home");
    expect(await ok("changes", "push", "home", "about")).toEqual({ ok: true, pushed: ["home", "about"] });
    expect(sh(remote, "log", "--format=%s", "main", "-2")).toBe("content: update about\ncontent: update home");
    expect((await ok("changes", "list")).drafts).toEqual([]);
    const log = await ok("changes", "log", "home");
    expect(log.history[0]).toMatchObject({ subject: "content: update home" });
    expect((await run(["changes", "log", "home"])).out).toMatch(/content: update home/);
    expect((await j("changes", "log")).json.code).toBe("usage");
  });

  it("commits page deletes and renames", async () => {
    await ok("page", "rename", "about", "who");
    expect(sh(site, "log", "--format=%s", "-1")).toBe("content: rename about to who");
    await ok("page", "delete", "who");
    expect(sh(site, "log", "--format=%s", "-1")).toBe("content: delete who");
  });

  it("refuses a push with no upstream, verbatim", async () => {
    const r = await j("publish");
    expect(r).toMatchObject({ code: 1, json: { ok: false, code: "git" } });
    expect(r.json.error).toContain("no upstream");
    const text = await run(["publish"]);
    expect(text.err).toContain('typren publish: The branch "main" has no upstream');
  });

  it("refuses to save on a detached HEAD and keeps the draft", async () => {
    await ok("page", "save", "home", "--file", (write("h.json", '{"meta":{"title":"Home 2"}}'), "h.json"));
    sh(site, "checkout", "-q", "--detach");
    const publish = await j("page", "publish", "home");
    expect(publish).toMatchObject({ code: 1, json: { ok: false, code: "git", error: "Check out a branch in your site folder to save." } });
    expect((await j("save")).json).toMatchObject({ ok: false, code: "git" });
    expect((await j("page", "rename", "about", "who")).json.code).toBe("git");
    expect((await ok("page", "get", "home")).hasDraft).toBe(true);
    expect(await ok("status")).toMatchObject({ detached: true, branch: "" });
    expect((await run(["status"])).out).toContain("detached HEAD");
    expect((await j("publish")).json).toMatchObject({ ok: false, code: "git" });
  });

  it("surfaces a commit hook's refusal and leaves the page unpublished", async () => {
    fs.writeFileSync(path.join(site, ".git/hooks/pre-commit"), "#!/bin/sh\necho blocked by policy\nexit 1\n", { mode: 0o755 });
    await ok("page", "save", "home", "--file", (write("h.json", '{"meta":{"title":"Home 2"}}'), "h.json"));
    const r = await j("page", "publish", "home");
    expect(r.json).toMatchObject({ ok: false, code: "git" });
    expect(r.json.error).toContain("blocked by policy");
    expect((await ok("page", "get", "home")).hasDraft).toBe(true);
  });
});

describe("main", () => {
  let logs: string[];
  beforeEach(() => {
    vi.spyOn(telemetry, "isEnabled").mockReturnValue(true);
    vi.spyOn(telemetry, "firstRunNotice").mockReturnValue("NOTICE");
    vi.spyOn(telemetry, "record").mockImplementation(() => {});
    logs = [];
    vi.spyOn(console, "log").mockImplementation((m: string) => void logs.push(m));
    vi.spyOn(console, "error").mockImplementation((m: string) => void logs.push(m));
  });
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("dispatches content commands, keeping --json output clean of the first-run notice", async () => {
    await main(["page", "list", "--cwd", site, "--json"]);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toMatchObject({ ok: true });
    expect(process.exitCode).toBeUndefined();
    expect(telemetry.record).toHaveBeenCalledWith("page");
  });

  it("prints the notice for text output and sets the exit code on failure", async () => {
    await main(["status", "--cwd", site]);
    expect(logs[0]).toBe("NOTICE");
    logs.length = 0;
    await main(["page", "get", "ghost", "--cwd", site]);
    expect(process.exitCode).toBe(1);
    expect(logs.join("\n")).toContain('typren page: page "ghost" does not exist');
    expect(telemetry.record).toHaveBeenCalledTimes(1);
  });

  it("lists the content commands in --help", async () => {
    await main(["--help"]);
    expect(logs.join("\n")).toContain("page add-section <slug> --file slice.json");
  });
});
