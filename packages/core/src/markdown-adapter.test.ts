import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createMarkdownAdapter, FOLDER_MARKER } from "./markdown-adapter";

// parse/serialize are pure string transforms (no fs touched), so a throwaway
// contentDir (never read) is enough to construct the adapter.
const adapter = createMarkdownAdapter({ contentDir: "/unused" });

describe("markdown-adapter parse/serialize", () => {
  // Every other fixture in this repo pre-writes `slices: []`, so this gap
  // (a file with real frontmatter + a real body but no slices key at all)
  // has never been exercised. `parse` must still default slices to [] rather
  // than throw or drop the rest of the frontmatter/body.
  it("round-trips a file that has frontmatter + a body and no slices key", () => {
    const raw = "---\ntitle: Ada Lovelace\nrole: Mathematician\n---\nAda wrote the first published algorithm.\n";

    const parsed = adapter.parse(raw);
    expect(parsed).toEqual({
      meta: { title: "Ada Lovelace", role: "Mathematician" },
      slices: [],
      body: "Ada wrote the first published algorithm.\n",
    });

    const serialized = adapter.serialize(parsed);
    expect(adapter.parse(serialized)).toEqual(parsed);
  });

  // `body` is typed as required, but pages arrive as JSON from untyped callers.
  it("serializes a page with no body as front matter only", () => {
    const page = { meta: { title: "x" }, slices: [] } as unknown as Parameters<typeof adapter.serialize>[0];
    expect(adapter.parse(adapter.serialize(page))).toEqual({
      meta: { title: "x" },
      slices: [],
      body: "\n",
    });
  });

  // Regression: the editor's duplicate() shallow-copies a slice (`{...slice}`),
  // so a duplicated page can carry two slices pointing at the very same nested
  // object. Before noRefs, gray-matter dumped that as a YAML anchor/alias pair,
  // which parse() (via parseMatter) refuses, making the duplicated page, and
  // every site listing/build that parses it, permanently unreadable.
  it("round-trips a page whose slices share a nested object reference (the Duplicate path)", () => {
    const cta = { label: "Buy now", href: "/buy" };
    const page = { meta: {}, slices: [{ slice: "hero", cta }, { slice: "hero", cta }], body: "" };

    const serialized = adapter.serialize(page);
    // gray-matter's dump adds a trailing newline to an empty body; trimmed
    // comparison keeps this test about the slices surviving, not whitespace.
    expect({ ...adapter.parse(serialized), body: adapter.parse(serialized).body.trim() }).toEqual(page);
  });

  it("refuses to serialize front matter over the parser's size cap, so nothing is ever written", () => {
    const page = { meta: { title: "x".repeat(256 * 1024) }, slices: [], body: "" };
    expect(() => adapter.serialize(page)).toThrow(/front matter exceeds 256 KB/);
  });
});

describe("markdown-adapter listSlugs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A shared content dir can hold non-page files whose names aren't valid
  // slugs. They're unreachable through the slug guard, so the listing must
  // skip them, not throw "unsafe slug" and take the whole page list down.
  it("skips files whose names aren't valid slugs instead of throwing", async () => {
    fs.writeFileSync(path.join(dir, "about.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "site_backup.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "About Us.md"), "---\nslices: []\n---\n");

    const withSlices = createMarkdownAdapter({ contentDir: dir });
    expect(await withSlices.listSlugs()).toEqual(["about"]);

    // The collection mode (requireSliceArray: false) reads every .md as a
    // record, so it hits the same guard on a different path.
    const collection = createMarkdownAdapter({ contentDir: dir, requireSliceArray: false });
    expect(await collection.listSlugs()).toEqual(["about"]);
  });
});

describe("markdown-adapter nested slugs", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-nested-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = "---\nslices: []\n---\n";

  it("reads, writes and lists a nested slug as a path under the content dir", async () => {
    const md = createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"] });
    await md.writeRaw("event/1", page);
    await md.writeRaw("event/2", page);
    await md.writeRaw("about", page);
    expect(fs.existsSync(path.join(dir, "event", "1.md"))).toBe(true);
    expect(await md.readRaw("event/1")).toBe(page);
    // `event` has no page of its own: a folder implied by its children.
    expect(await md.listSlugs()).toEqual(["about", "event/1", "event/2"]);
    expect(await md.exists("event")).toBe(false);
    // A page and its folder coexist.
    await md.writeRaw("event", page);
    expect(await md.listSlugs()).toEqual(["about", "event", "event/1", "event/2"]);
  });

  it("keeps locale and draft directories out of the default locale's slugs", async () => {
    const md = createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"], draftSubdir: "drafts" });
    await md.writeRaw("about", page, "es");
    await md.writeDraftRaw("event/1", page);
    fs.mkdirSync(path.join(dir, "Bad Dir"));
    fs.writeFileSync(path.join(dir, "Bad Dir", "x.md"), page);
    expect(await md.listSlugs()).toEqual([]);
    expect(await md.listSlugs("es")).toEqual(["about"]);
    for (const slug of ["es/about", "ES/about", "drafts/x", "event//1", "event/", "/event", "event/../x"])
      await expect(md.readRaw(slug)).rejects.toThrow(/unsafe slug/);
    // A single segment named like a locale is an ordinary page beside its directory.
    await md.writeRaw("es", page);
    expect(await md.listSlugs()).toEqual(["es"]);
  });

  it("does not follow a symlinked folder", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-elsewhere-"));
    fs.writeFileSync(path.join(elsewhere, "secret.md"), page);
    fs.symlinkSync(elsewhere, path.join(dir, "linked"));
    const md = createMarkdownAdapter({ contentDir: dir });
    expect(await md.listSlugs()).toEqual([]);
    await expect(md.readRaw("linked/secret")).rejects.toThrow(/symlinked/);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it("lists draft slugs, nested ones included, published or not", async () => {
    const md = createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"] });
    expect(await md.listDraftSlugs!()).toEqual([]);
    await md.writeRaw("about", page);
    await md.writeDraftRaw("about", page);
    await md.writeDraftRaw("event/1", page);
    await md.writeDraftRaw("hola", page, "es");
    expect(await md.listDraftSlugs!()).toEqual(["about", "event/1"]);
    expect(await md.listDraftSlugs!("es")).toEqual(["hola"]);
    // Drafts never count as published pages.
    expect(await md.listSlugs()).toEqual(["about"]);
  });
});

describe("markdown-adapter page folders", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-folders-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps an empty folder as a marker file that never lists as a page", async () => {
    const md = createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"] });
    expect(await md.listFolders()).toEqual([]);
    await md.createFolder!("event");
    await md.createFolder!("docs/guides");
    await md.createFolder!("event"); // idempotent
    expect(fs.existsSync(path.join(dir, "event", FOLDER_MARKER))).toBe(true);
    expect(md.folderFile("event")).toBe(path.join(dir, "event", FOLDER_MARKER));
    expect(await md.listFolders()).toEqual(["docs/guides", "event"]);
    expect(await md.listSlugs()).toEqual([]);
    expect(await md.listFolders("es")).toEqual([]);
  });

  it("validates the folder path like a slug, reserving locale and draft directories even at the top", async () => {
    const md = createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"] });
    for (const bad of ["es", "ES/x", ".drafts", "../x", "a//b", ""])
      await expect(md.createFolder!(bad)).rejects.toThrow(/unsafe slug/);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-elsewhere-"));
    fs.symlinkSync(elsewhere, path.join(dir, "linked"));
    await expect(md.createFolder!("linked")).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it("deletes only an empty folder", async () => {
    const md = createMarkdownAdapter({ contentDir: dir });
    await md.deleteFolder!("missing");
    await md.createFolder!("event");
    await md.writeRaw("event/1", "---\nslices: []\n---\n");
    await expect(md.deleteFolder!("event")).rejects.toThrow(/not empty/);
    await md.deletePublished("event/1");
    await md.deleteFolder!("event");
    expect(fs.existsSync(path.join(dir, "event"))).toBe(false);
    expect(await md.listFolders()).toEqual([]);
  });
});

describe("markdown-adapter locale validation", () => {
  // Regression: `locales` (and `defaultLocale`) become path segments
  // (localeDir/localeSubdir), so an unsafe entry in the allowlist ITSELF --
  // not just an unlisted locale passed at call time -- must be rejected at
  // construction, before any read/write can turn it into a traversal.
  it("rejects a path-traversal locale in the locales array", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["en", "../../etc"] })).toThrow(
      /unsafe locale/
    );
  });

  it("rejects a path-traversal defaultLocale", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", defaultLocale: "../escape" })).toThrow(
      /unsafe locale/
    );
  });

  it("rejects an absolute-path locale", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["/etc/passwd"] })).toThrow(/unsafe locale/);
  });

  it("accepts ordinary BCP-47-ish locales, including region subtags", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["en", "en-US", "pt-BR"] })).not.toThrow();
  });
});

describe("markdown-adapter contract", () => {
  let contractDir: string;
  beforeEach(() => {
    contractDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-contract-"));
  });
  afterEach(() => fs.rmSync(contractDir, { recursive: true, force: true }));

  createContentAdapterContractSuite(() => createMarkdownAdapter({ contentDir: contractDir }));
});

describe("markdown-adapter symlinks", () => {
  let root: string;
  let contentDir: string;
  let outside: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-link-"));
    contentDir = path.join(root, "content");
    outside = path.join(root, "secret.txt");
    fs.mkdirSync(path.join(contentDir, ".drafts"), { recursive: true });
    fs.writeFileSync(outside, "DB_PASSWORD=hunter2\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("refuses to read or write through a symlinked page or draft file", async () => {
    fs.symlinkSync(outside, path.join(contentDir, "leak.md"));
    fs.symlinkSync(outside, path.join(contentDir, ".drafts", "pwn.md"));
    const md = createMarkdownAdapter({ contentDir });

    await expect(md.readRaw("leak")).rejects.toThrow(/symlinked/);
    await expect(md.exists("leak")).rejects.toThrow(/symlinked/);
    await expect(md.writeRaw("leak", "x")).rejects.toThrow(/symlinked/);
    await expect(md.writeDraftRaw("pwn", "x")).rejects.toThrow(/symlinked/);
    expect(fs.readFileSync(outside, "utf8")).toBe("DB_PASSWORD=hunter2\n");
  });

  it("refuses a locale or drafts directory that links outside the content root", async () => {
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(contentDir, "es"));
    fs.rmSync(path.join(contentDir, ".drafts"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(contentDir, ".drafts"));
    const md = createMarkdownAdapter({ contentDir, locales: ["en", "es"] });

    await expect(md.writeRaw("about", "x", "es")).rejects.toThrow(/symlinked/);
    await expect(md.writeDraftRaw("about", "x")).rejects.toThrow(/symlinked/);
    await expect(md.writeDraftRaw("about", "x", "es")).rejects.toThrow(/symlinked/);
    await expect(md.listSlugs("es")).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses a linked .drafts even when draftDir is passed explicitly inside contentDir", async () => {
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "notes.md"), "PRIVATE");
    fs.rmSync(path.join(contentDir, ".drafts"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(contentDir, ".drafts"));
    const md = createMarkdownAdapter({ contentDir, draftDir: path.join(contentDir, ".drafts") });

    await expect(md.readDraftRaw("notes")).rejects.toThrow(/symlinked/);
    await expect(md.writeDraftRaw("pwned", "x")).rejects.toThrow(/symlinked/);
    await expect(md.deleteDraft("notes")).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(elsewhere)).toEqual(["notes.md"]);
  });

  it("treats a draftDir named like ..drafts inside contentDir as inside", async () => {
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(contentDir, "..drafts"));
    const md = createMarkdownAdapter({ contentDir, draftDir: path.join(contentDir, "..drafts") });

    await expect(md.writeDraftRaw("pwned", "x")).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it("allows a draftDir outside contentDir and reports absent paths as missing", async () => {
    const md = createMarkdownAdapter({ contentDir, draftDir: path.join(root, "drafts") });

    await md.writeDraftRaw("home", "x");
    expect(await md.readDraftRaw("home")).toBe("x");
    expect(await md.exists("a".repeat(300))).toBe(false);
  });

  it("still works when the content root itself is reached through a symlink", async () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(contentDir, alias);
    const md = createMarkdownAdapter({ contentDir: alias });

    await md.writeRaw("home", "---\nslices: []\n---\n");
    expect(await md.readRaw("home")).toContain("slices");
  });
});
