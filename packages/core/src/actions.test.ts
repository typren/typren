import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findMediaRefs, makeActions, mediaRefSwapper, rewriteMediaRefs } from "./actions";
import { createFsMediaAdapter } from "./fs-media-adapter";
import { makeCollectionActions } from "./collection";
import { createMarkdownAdapter } from "./markdown-adapter";
import type { AuthContext } from "./auth-adapter";
import type { CmsConfig, ContentAdapter } from "./types";

let dir: string;
let seen: AuthContext[];
let deny: (ctx: AuthContext) => boolean;

const page = { meta: { title: "T" }, slices: [], body: "x" };

function makeConfig(adapter?: ContentAdapter): CmsConfig {
  return {
    registry: {},
    defaults: {},
    adapter:
      adapter ??
      createMarkdownAdapter({ contentDir: dir, draftDir: path.join(dir, ".drafts"), locales: ["en", "de"], defaultLocale: "en" }),
    previewPath: "/studio/preview",
    // The fixture's "home" is renamed below like any page.
    homeSlug: "index",
    auth: {
      authorize: async (ctx) => {
        seen.push(ctx);
        return !deny(ctx);
      },
    },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-actions-"));
  fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n");
  seen = [];
  deny = () => false;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Every write's AuthContext must carry the same slug/locale/collectionId a
// read would, or a per-slug/per-locale/per-collection policy is bypassed.
describe("makeActions guard context", () => {
  it("passes slug and locale for every page action", async () => {
    const a = makeActions(makeConfig());
    await a.createTranslation("home", "de");
    await a.saveDraft("home", page, undefined, "de");
    await a.publish("home", undefined, "de");
    await a.discardDraft("home", "de");
    await a.deleteTranslation("home", "de");
    await a.createPage("About Us", "de");
    await a.duplicatePage("home", "en");
    await a.renamePage("home", "start");
    await a.deletePage("start");

    expect(seen.map(({ action, slug, locale }) => ({ action, slug, locale }))).toEqual([
      { action: "read", slug: "home", locale: "en" },
      { action: "saveDraft", slug: "home", locale: "de" },
      { action: "saveDraft", slug: "home", locale: "de" },
      { action: "publish", slug: "home", locale: "de" },
      { action: "discardDraft", slug: "home", locale: "de" },
      { action: "deletePage", slug: "home", locale: "de" },
      { action: "createPage", slug: "about-us", locale: "de" },
      { action: "read", slug: "home", locale: "en" },
      { action: "createPage", slug: "home", locale: "en" },
      { action: "createPage", slug: "home-copy", locale: "en" },
      { action: "renamePage", slug: "home", locale: undefined },
      { action: "renamePage", slug: "start", locale: undefined },
      { action: "deletePage", slug: "start", locale: undefined },
    ]);
    for (const ctx of seen) expect(ctx.collectionId).toBeUndefined();
  });

  it("forwards collectionId from makeCollectionActions on every write", async () => {
    const legalDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-legal-"));
    try {
      const a = makeCollectionActions(makeConfig(), { kind: "collection", label: "Legal Docs", dir: legalDir, schema: {} });
      const slug = await a.createPage("Terms");
      await a.saveDraft(slug, page);
      await a.publish(slug);
      await a.deletePage(slug);
      expect(seen).toHaveLength(4);
      for (const ctx of seen) expect(ctx).toMatchObject({ collectionId: "legal-docs", slug: "terms" });
    } finally {
      fs.rmSync(legalDir, { recursive: true, force: true });
    }
  });

  it("creates a draft-only page at an explicit nested slug, authorizing that slug", async () => {
    const a = makeActions(makeConfig());
    expect(await a.createPage("Day one", undefined, { slug: "event/1", draft: true })).toBe("event/1");
    expect(seen.at(-1)).toMatchObject({ action: "createPage", slug: "event/1" });
    expect(fs.existsSync(path.join(dir, ".drafts", "event", "1.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "event", "1.md"))).toBe(false);
    // The explicit slug skips slugify, so the adapter is what refuses a bad one.
    await expect(a.createPage("x", undefined, { slug: "../x" })).rejects.toThrow(/unsafe slug/);
    await expect(a.createPage("x", undefined, { slug: "de/x" })).rejects.toThrow(/unsafe slug/);
  });

  it("renames a nested page within its folder, moving its draft, and slugifies each segment", async () => {
    const a = makeActions(makeConfig());
    await a.createPage("Day one", undefined, { slug: "event/1", draft: true });
    expect(await a.renamePage("event/1", "event/Day One")).toEqual({ ok: true, slug: "event/day-one" });
    expect(seen.at(-1)).toMatchObject({ action: "renamePage", slug: "event/day-one" });
    expect(fs.existsSync(path.join(dir, ".drafts", "event", "day-one.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".drafts", "event", "1.md"))).toBe(false);
    // A dot segment slugifies away, so it can't climb out of the content dir.
    expect(await a.renamePage("event/day-one", "../x")).toEqual({ ok: true, slug: "x" });
  });

  it("runs onRename after the move, refuses a git rename on a detached HEAD first, and moves back when the hook throws", async () => {
    const onRename = vi.fn(async () => {});
    let branch = "";
    const git = { outgoing: async () => ({ branch, upstream: null, commits: [] }), commit: vi.fn(), push: vi.fn() };
    const a = makeActions({ ...makeConfig(), git: git as never, onRename });
    await expect(a.renamePage("home", "start")).rejects.toThrow(/branch/);
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(true);
    expect(onRename).not.toHaveBeenCalled();

    branch = "main";
    await a.renamePage("home", "start");
    expect(onRename).toHaveBeenCalledWith("home", "start");
    onRename.mockRejectedValueOnce(new Error("commit failed"));
    await expect(a.renamePage("start", "home")).rejects.toThrow("commit failed");
    expect(fs.existsSync(path.join(dir, "start.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(false);
  });

  it("keeps and deletes page folders through the adapter, authorizing the folder path", async () => {
    const a = makeActions(makeConfig());
    await a.createPageFolder("event");
    expect(seen.at(-1)).toMatchObject({ action: "createPage", slug: "event" });
    await a.deletePageFolder("event");
    expect(seen.at(-1)).toMatchObject({ action: "deletePage", slug: "event" });
    const bare = { ...createMarkdownAdapter({ contentDir: dir }), createFolder: undefined, deleteFolder: undefined };
    const b = makeActions(makeConfig(bare));
    await expect(b.createPageFolder("event")).rejects.toThrow(/no folders/);
    await expect(b.deletePageFolder("event")).rejects.toThrow(/no folders/);
  });

  it("refuses to rename onto a denied destination slug", async () => {
    deny = (ctx) => ctx.slug === "reserved";
    const a = makeActions(makeConfig());
    await expect(a.renamePage("home", "reserved")).rejects.toThrow(/unauthorized/);
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "reserved.md"))).toBe(false);
  });

  it("refuses a duplicate whose derived slug is denied, before writing it", async () => {
    deny = (ctx) => ctx.slug === "home-copy";
    const a = makeActions(makeConfig());
    await expect(a.duplicatePage("home")).rejects.toThrow(/unauthorized/);
    expect(fs.existsSync(path.join(dir, "home-copy.md"))).toBe(false);
  });

  it("refuses to create a page on a denied slug", async () => {
    deny = (ctx) => ctx.slug === "home";
    await expect(makeActions(makeConfig()).createPage("Home")).rejects.toThrow(/unauthorized/);
  });
});

describe("draftsWriteThrough adapters", () => {
  it("gate draft writes as publish, so saveDraft alone can't make content live", async () => {
    const base = makeConfig().adapter;
    const writeThrough: ContentAdapter = { ...base, draftsWriteThrough: true };
    deny = (ctx) => ctx.action === "publish";
    const a = makeActions(makeConfig(writeThrough));
    await expect(a.saveDraft("home", page)).rejects.toThrow(/unauthorized/);
    await expect(a.createTranslation("home", "de")).rejects.toThrow(/unauthorized/);
    expect(seen.map((c) => c.action)).toEqual(["publish", "read", "publish"]);
  });
});

describe("media references and folders", () => {
  let mediaDir: string;

  beforeEach(() => {
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-actions-media-"));
  });
  afterEach(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  const withMedia = (): CmsConfig => ({
    ...makeConfig(),
    mediaAdapter: createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" }),
  });

  it("mediaRefSwapper replaces only whole URLs, longest first", () => {
    const swap = mediaRefSwapper([
      { from: "/img/a.webp", to: "/img/x/a.webp" },
      { from: "/img/a.webp.bak", to: "/img/y.bak" },
    ]);
    expect(swap("![](/img/a.webp) /img/a.webp2 /img/a.webp.bak")).toBe("![](/img/x/a.webp) /img/a.webp2 /img/y.bak");
  });

  it("findMediaRefs counts per slug and locale, preferring the draft, on a URL boundary", async () => {
    fs.writeFileSync(path.join(dir, "about.md"), "---\ntitle: A\nslices: []\n---\n/img/a.webp and /img/a.webp2\n");
    fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n/img/b.webp\n");
    const adapter = makeConfig().adapter;
    await adapter.writeDraftRaw("home", "---\ntitle: Home\nslices: []\n---\n/img/a.webp /img/a.webp\n", "en");
    const uses = await findMediaRefs(adapter, ["/img/a.webp", "/img/b.webp", "/img/none.webp"]);
    expect(uses["/img/a.webp"]).toEqual(
      expect.arrayContaining([
        { slug: "about", locale: "en", count: 1 },
        { slug: "home", locale: "en", count: 2 },
      ])
    );
    expect(uses["/img/b.webp"]).toEqual([]);
    expect(uses["/img/none.webp"]).toEqual([]);
    expect(await findMediaRefs(adapter, [])).toEqual({});
  });

  it("rewriteMediaRefs updates published and draft sources and ignores an empty move list", async () => {
    const adapter = makeConfig().adapter;
    fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n/img/a.webp\n");
    await adapter.writeDraftRaw("home", "---\ntitle: Home\nslices: []\n---\n/img/a.webp\n", "en");
    await rewriteMediaRefs(adapter, []);
    await rewriteMediaRefs(adapter, [{ from: "/img/a.webp", to: "/img/b.webp" }]);
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("/img/b.webp");
    expect(await adapter.readDraftRaw("home", "en")).toContain("/img/b.webp");
  });

  it("lists folders, usage, and moves assets with reference rewrites and the onMediaMove hook", async () => {
    deny = () => false;
    const onMediaMove = vi.fn();
    const config = { ...withMedia(), onMediaMove };
    const a = makeActions(config);
    expect(await a.listMediaFolders()).toEqual([]);
    await a.createMediaFolder("pics");
    expect(await a.listMediaFolders()).toEqual(["pics"]);

    fs.writeFileSync(path.join(mediaDir, "a.webp"), "x");
    fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n/img/a.webp\n");
    expect((await a.mediaUsage())["/img/a.webp"]).toEqual([{ slug: "home", locale: "en", count: 1 }]);

    const moved = await a.moveMedia("a.webp", "pics", "b");
    expect(moved.url).toBe("/img/pics/b.webp");
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("/img/pics/b.webp");
    expect(onMediaMove).toHaveBeenCalledWith([{ from: "/img/a.webp", to: "/img/pics/b.webp" }]);

    onMediaMove.mockClear();
    await a.moveMedia("pics/b.webp", "pics");
    expect(onMediaMove).not.toHaveBeenCalled();

    await a.renameMediaFolder("pics", "photos");
    expect(onMediaMove).toHaveBeenCalledWith([{ from: "/img/pics/b.webp", to: "/img/photos/b.webp" }]);
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("/img/photos/b.webp");

    await a.createMediaFolder("empty");
    await a.deleteMediaFolder("empty");
    expect(await a.listMediaFolders()).toEqual(["photos"]);
  });

  it("renameMediaFolder with nothing inside skips the rewrite hook", async () => {
    const onMediaMove = vi.fn();
    const a = makeActions({ ...withMedia(), onMediaMove });
    await a.createMediaFolder("empty");
    await a.renameMediaFolder("empty", "also-empty");
    expect(onMediaMove).not.toHaveBeenCalled();
  });

  it("errors without a mediaAdapter or without folder support", async () => {
    const a = makeActions(makeConfig());
    expect(await a.listMediaFolders()).toEqual([]);
    await expect(a.mediaUsage()).rejects.toThrow(/no mediaAdapter configured/);
    await expect(a.createMediaFolder("x")).rejects.toThrow(/no mediaAdapter configured/);
    const flat = makeActions({
      ...makeConfig(),
      mediaAdapter: { list: async () => [], upload: async () => ({}) as never, delete: async () => {} },
    });
    await expect(flat.moveMedia("a.webp", "x")).rejects.toThrow(/has no folders/);
  });

  it("gates the folder and move actions as upload and delete", async () => {
    const a = makeActions(withMedia());
    deny = () => true;
    await expect(a.mediaUsage()).rejects.toThrow(/unauthorized/);
    await expect(a.listMediaFolders()).rejects.toThrow(/unauthorized/);
    await expect(a.createMediaFolder("x")).rejects.toThrow(/unauthorized/);
    await expect(a.deleteMediaFolder("x")).rejects.toThrow(/unauthorized/);
    await expect(a.moveMedia("a.webp", "x")).rejects.toThrow(/unauthorized/);
    await expect(a.renameMediaFolder("x", "y")).rejects.toThrow(/unauthorized/);

    seen = [];
    deny = (ctx) => ctx.action === "deleteMedia";
    await expect(a.moveMedia("a.webp", "x")).rejects.toThrow(/unauthorized/);
    expect(seen.map((c) => c.action)).toEqual(["uploadMedia", "deleteMedia"]);

    // A role that can't read a page can't copy it out either.
    deny = (ctx) => ctx.action === "read";
    await expect(a.duplicatePage("home")).rejects.toThrow(/unauthorized/);
    await expect(a.createTranslation("home", "de")).rejects.toThrow(/unauthorized/);

    // A media-only role can't rewrite live pages by moving what they use.
    deny = (ctx) => ctx.action === "publish";
    await expect(a.moveMedia("a.webp", "x")).rejects.toThrow(/unauthorized/);
    await expect(a.renameMediaFolder("x", "y")).rejects.toThrow(/unauthorized/);
  });
});

describe("reads", () => {
  it("lists pages and folders and opens a page, draft first, each behind read", async () => {
    const a = makeActions(makeConfig());
    fs.mkdirSync(path.join(dir, "event"));
    fs.writeFileSync(path.join(dir, "event", ".typren-folder"), "");
    expect((await a.listPages()).map((p) => p.slug)).toEqual(["home"]);
    expect(await a.listPageFolders()).toEqual(["event"]);
    expect(await a.getPage("home")).toEqual({ page: expect.objectContaining({ meta: { title: "Home" } }), version: expect.any(String), hasDraft: false });
    await a.createPage("Later", undefined, { slug: "later", draft: true });
    expect(await a.getPage("later")).toMatchObject({ page: { meta: { title: "Later" } }, hasDraft: true });
    expect(await a.getPage("missing")).toBeNull();
    expect(seen.filter((c) => c.action === "read").map((c) => c.slug)).toEqual([undefined, undefined, "home", "later", "missing"]);
    deny = (ctx) => ctx.action === "read";
    await expect(a.listPages()).rejects.toThrow(/unauthorized/);
    await expect(a.getPage("home")).rejects.toThrow(/unauthorized/);
    await expect(a.listPageFolders()).rejects.toThrow(/unauthorized/);
    deny = () => false;
    expect(await makeActions(makeConfig({ ...createMarkdownAdapter({ contentDir: dir }), listFolders: undefined })).listPageFolders()).toEqual([]);
  });
});

describe("page flows", () => {
  const site = (meta: string) => fs.writeFileSync(path.join(dir, "site.md"), `---\n${meta}\n---\n`);
  const draftOf = (slug: string) => fs.readFileSync(path.join(dir, ".drafts", `${slug}.md`), "utf8");
  const readMenuOf = (raw: string) => makeConfig().adapter.parse(raw).meta.nav;

  it("creates a draft page holding sections", async () => {
    const a = makeActions(makeConfig());
    expect(await a.createPageFrom("About", "about", [{ slice: "hero" }])).toBe("about");
    expect(await a.getPage("about")).toMatchObject({ page: { meta: { title: "About" }, slices: [{ slice: "hero" }] }, hasDraft: true });
    expect(await a.createPageFrom("Empty", "empty", [])).toBe("empty");
    expect(fs.existsSync(path.join(dir, "about.md"))).toBe(false);
  });

  it("inserts a section at an index or the end, and conflicts on a stale version", async () => {
    const a = makeActions(makeConfig());
    await a.saveDraft("home", { meta: { title: "Home" }, slices: [{ slice: "a" }, { slice: "b" }], body: "" });
    const { version } = (await a.getPage("home"))!;
    const first = await a.insertSection("home", { slice: "x" }, 1, version!);
    expect(first.ok).toBe(true);
    await a.insertSection("home", { slice: "y" }, "end");
    await a.insertSection("home", { slice: "z" }, 99);
    expect((await a.getPage("home"))!.page.slices.map((s) => s.slice)).toEqual(["a", "x", "b", "y", "z"]);
    expect(await a.insertSection("home", { slice: "w" }, 0, version!)).toMatchObject({ ok: false, code: "conflict" });
    await expect(a.insertSection("missing", { slice: "w" }, 0)).rejects.toThrow(/does not exist/);
  });

  it("updates trimmed meta, dropping an empty description and a false noindex", async () => {
    const a = makeActions(makeConfig());
    const r = await a.updatePageMeta("home", { title: "  Start ", noindex: true, description: " Hi " });
    expect(r.ok).toBe(true);
    expect((await a.getPage("home"))!.page.meta).toEqual({ title: "Start", noindex: true, description: "Hi" });
    await a.updatePageMeta("home", { noindex: false, description: "  " });
    expect((await a.getPage("home"))!.page.meta).toEqual({ title: "Start" });
    // Nothing changed: no write, the current version back.
    const { version } = (await a.getPage("home"))!;
    expect(await a.updatePageMeta("home", { title: "Start" }, "stale")).toEqual({ ok: true, version });
    expect(await a.updatePageMeta("home", { title: "Other" }, "stale")).toMatchObject({ ok: false, code: "conflict" });
    await expect(a.updatePageMeta("home", { title: " " })).rejects.toThrow(/needs a title/);
    await expect(a.updatePageMeta("missing", {})).rejects.toThrow(/does not exist/);
  });

  it("adds the page to the site doc's menu draft or unlinks it, only when that changes", async () => {
    fs.writeFileSync(path.join(dir, "about.md"), "---\ntitle: About\nslices: []\n---\n");
    site("nav:\n  - label: Docs\n    href: /docs");
    const a = makeActions({ ...makeConfig(), homeSlug: "home" });
    await a.updatePageMeta("about", { nav: true });
    expect(draftOf("site")).toContain("href: /about");
    await a.updatePageMeta("home", { title: "Start", nav: true });
    expect(draftOf("site")).toMatch(/label: Start\n\s+href: \//);
    const before = draftOf("site");
    await a.updatePageMeta("about", { nav: true });
    expect(draftOf("site")).toBe(before);
    await a.updatePageMeta("about", { nav: false });
    expect(draftOf("site")).not.toContain("/about");
    expect(seen.some((c) => c.slug === "site" && c.action === "saveDraft")).toBe(true);
  });

  it("refuses to delete the home page, but not its translation", async () => {
    const a = makeActions({ ...makeConfig(), homeSlug: "home" });
    await a.createTranslation("home", "de");
    await expect(a.deletePage("home")).rejects.toThrow("The home page can't be deleted.");
    await expect(a.deletePage("ghost")).rejects.toThrow('The page "ghost" does not exist.');
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(true);
    await a.deleteTranslation("home", "de");
  });

  it("points menu links at a renamed page and drops them for a deleted one, published and draft", async () => {
    fs.writeFileSync(path.join(dir, "careers.md"), "---\ntitle: Careers\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "crew.md"), "---\ntitle: Crew\nslices: []\n---\n");
    site("nav:\n  - label: Crew\n    href: /crew\n    children:\n      - label: Jobs\n        href: /careers#open\ncta:\n  label: Join\n  href: /careers\nfooter: kept");
    const a = makeActions({ ...makeConfig(), homeSlug: "home" });
    await a.updatePageMeta("home", { nav: true });
    expect(await a.renamePage("careers", "jobs")).toEqual({ ok: true, slug: "jobs" });
    const live = () => fs.readFileSync(path.join(dir, "site.md"), "utf8");
    for (const doc of [live(), draftOf("site")]) {
      expect(doc).toContain("href: /jobs#open");
      expect(doc).toMatch(/cta:\n\s+label: Join\n\s+href: \/jobs/);
      expect(doc).not.toContain("/careers");
    }
    expect(seen).toContainEqual(expect.objectContaining({ action: "publish", slug: "site" }));
    await a.deletePage("crew");
    for (const doc of [live(), draftOf("site")]) {
      expect(doc).not.toContain("/crew");
      expect(doc).toMatch(/- label: Jobs\n\s+href: \/jobs#open/);
    }
    expect(live()).toContain("footer: kept");
    await a.deletePage("jobs");
    expect(live()).not.toContain("cta");
    expect(readMenuOf(live())).toEqual([]);
  });

  it("refuses nav on a site whose menu is in its code", async () => {
    const a = makeActions(makeConfig());
    await expect(a.updatePageMeta("home", { nav: true })).rejects.toThrow(/built in its code/);
    site("title: Site");
    await expect(a.updatePageMeta("home", { nav: true })).rejects.toThrow(/built in its code/);
  });

  it("commits a page by saving then publishing it, or publishing its draft", async () => {
    const onPublish = vi.fn();
    const a = makeActions({ ...makeConfig(), onPublish });
    const { version } = (await a.getPage("home"))!;
    const saved = await a.commitPage("home", { meta: { title: "New" }, slices: [], body: "" }, version!);
    expect(saved.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("New");
    expect(onPublish).toHaveBeenCalledWith("home", "en");
    expect(await a.commitPage("home", page, "stale")).toMatchObject({ ok: false, code: "conflict" });
    await a.saveDraft("home", page);
    expect((await a.commitPage("home")).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(false);
  });

  it("publishes every page with a draft", async () => {
    const a = makeActions(makeConfig());
    await a.createPage("About", undefined, { slug: "about" });
    await a.saveDraft("home", page);
    await a.createPage("Later", undefined, { slug: "later", draft: true });
    await a.saveDraft("site", { meta: { nav: [] }, slices: [], body: "" });
    expect((await a.publishAll()).sort()).toEqual(["home", "later", "site"]);
    expect((await a.listPages()).filter((p) => p.hasDraft)).toEqual([]);
    expect((await a.listPages()).map((p) => p.slug)).not.toContain("site");
  });
});

describe("push and upload", () => {
  it("pushes behind the publish tier, and only with git", async () => {
    const push = vi.fn(async () => ({ ok: true as const }));
    const a = makeActions({ ...makeConfig(), git: { push } as never });
    expect(await a.push()).toEqual({ ok: true });
    deny = (ctx) => ctx.action === "publish";
    await expect(a.push()).rejects.toThrow(/unauthorized/);
    deny = () => false;
    await expect(makeActions(makeConfig()).push()).rejects.toThrow(/isn't a git checkout/);
  });

  it("lists behind read, and pushes or discards chosen files behind publish", async () => {
    const git = { pending: vi.fn(async () => []), pushPaths: vi.fn(async () => ({ ok: true as const })), discardPaths: vi.fn(async () => {}) };
    const a = makeActions({ ...makeConfig(), git: git as never });
    expect(await a.pendingChanges()).toEqual([]);
    expect(await a.pushChanges(["content/a.md"])).toEqual({ ok: true });
    await a.discardChanges(["content/a.md"]);
    expect(git.discardPaths).toHaveBeenCalledWith(["content/a.md"]);
    deny = (ctx) => ctx.action === "publish";
    await expect(a.pushChanges(["content/a.md"])).rejects.toThrow(/unauthorized/);
    await expect(a.discardChanges(["content/a.md"])).rejects.toThrow(/unauthorized/);
    deny = (ctx) => ctx.action === "read";
    await expect(a.pendingChanges()).rejects.toThrow(/unauthorized/);
    deny = () => false;
    await expect(makeActions(makeConfig()).pendingChanges()).rejects.toThrow(/isn't a git checkout/);
  });

  it("publishes chosen drafts one commit each before pushing their files, and reads a page's history", async () => {
    let head = 0;
    const commits: { hash: string; subject: string; files: string[] }[] = [];
    const git = {
      outgoing: vi.fn(async () => ({ branch: "main", upstream: "origin/main", commits: [...commits].reverse() })),
      pushPaths: vi.fn(async () => ({ ok: true as const })),
      history: vi.fn(async () => []),
    };
    // Each publish commits its page, except one that changed nothing.
    const onPublish = vi.fn(async (slug: string) => {
      if (slug !== "same") commits.push({ hash: `c${++head}`, subject: `content: update ${slug}`, files: [`content/${slug}.md`] });
    });
    const a = makeActions({ ...makeConfig(), git: git as never, onPublish });
    for (const slug of ["one", "two", "same"]) {
      fs.mkdirSync(path.join(dir, ".drafts"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".drafts", `${slug}.md`), "---\ntitle: D\nslices: []\n---\n");
    }
    expect(await a.pushChanges(["media/a.webp"], ["one", "two", "same"])).toEqual({ ok: true });
    expect(onPublish.mock.calls.map(([s]) => s)).toEqual(["one", "two", "same"]);
    expect(git.pushPaths).toHaveBeenCalledWith(["media/a.webp", "content/one.md", "content/two.md"]);
    git.pushPaths.mockClear();
    expect(await a.pushChanges([], [])).toEqual({ ok: true });
    expect(git.pushPaths).not.toHaveBeenCalled();
    await a.pageHistory("one", undefined, 5);
    expect(git.history).toHaveBeenCalledWith(path.join(dir, "one.md"), 5);
    expect(await makeActions({ ...makeConfig(), adapter: { ...makeConfig().adapter, pageFile: undefined } as never, git: git as never }).pageHistory("one")).toEqual([]);
    deny = (ctx) => ctx.action === "read";
    await expect(a.pageHistory("one")).rejects.toThrow(/unauthorized/);
    deny = () => false;
  });

  it("uploads a processed file through withCommit, and returns a refused one as data", async () => {
    const upload = vi.fn(async (file: { name: string }, folder?: string) => ({ id: `${folder}/${file.name}` }) as never);
    const withCommit = vi.fn((_message: string, write: () => Promise<unknown>) => write());
    const a = makeActions({ ...makeConfig(), mediaAdapter: { list: async () => [], upload, delete: async () => {} }, withCommit: withCommit as never });
    const png = await (await import("sharp")).default({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer();
    expect(await a.uploadMedia({ name: "Shot.PNG", buffer: png }, "events")).toEqual({ ok: true, asset: { id: "events/shot.webp" } });
    expect(withCommit).toHaveBeenCalledWith("media: upload shot.webp", expect.any(Function));
    expect(await a.uploadMedia({ name: "x.txt", buffer: Buffer.from("not an image") })).toMatchObject({ ok: false, error: expect.any(String) });
    deny = (ctx) => ctx.action === "uploadMedia";
    await expect(a.uploadMedia({ name: "a.png", buffer: png })).rejects.toThrow(/unauthorized/);
    deny = () => false;
    await expect(makeActions(makeConfig()).uploadMedia({ name: "a.png", buffer: png })).rejects.toThrow(/no mediaAdapter/);
  });
});

describe("rename locks", () => {
  it("locks the home page's slug and a page with pages under it", async () => {
    const a = makeActions({ ...makeConfig(), homeSlug: "home" });
    await expect(a.renamePage("home", "start")).rejects.toThrow(/home page keeps its slug/);
    expect(await a.renamePage("home", "home")).toEqual({ ok: true, slug: "home" });
    fs.writeFileSync(path.join(dir, "event.md"), "---\ntitle: Event\nslices: []\n---\n");
    await a.createPage("Day", undefined, { slug: "event/day", draft: true });
    await expect(a.renamePage("event", "events")).rejects.toThrow(/Move the pages under "event" first/);
  });
});
