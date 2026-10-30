import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { makeActions } from "./actions";
import { handleMediaUpload } from "./media";
import { createLocalSiteConfig, rewriteSiteFiles, type LocalSite } from "./local-site";

// Stripped so a pre-push hook's GIT_DIR cannot redirect these into the typren checkout.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;

let site: string;
let local: LocalSite;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: site, env, encoding: "utf8" }).trim();
const allow = { authorize: async () => true };
const config = () => createLocalSiteConfig(local, { auth: allow });
const file = (rel: string) => path.join(site, rel);
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), text);
};
const read = (rel: string) => fs.readFileSync(file(rel), "utf8");
const page = (title: string) => `---\ntitle: ${title}\nslices: []\n---\n`;

/** A checkout with one commit; `content/.drafts/` is ignored like the scaffold's. */
const initRepo = () => {
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "Test");
  sh("config", "user.email", "test@example.test");
  write(".gitignore", "content/.drafts/\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "init");
};
const lastCommit = () => sh("show", "--name-status", "--no-renames", "--format=%s", "HEAD").split("\n").filter(Boolean);
const blockCommits = () =>
  fs.writeFileSync(path.join(site, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'blocked'\nexit 1\n", { mode: 0o755 });

beforeEach(() => {
  site = fs.mkdtempSync(path.join(os.tmpdir(), "typren-local-"));
  write("content/home.md", "---\ntitle: Home\nslices:\n  - slice: hero\n    heading: Hi\n---\n");
  local = { siteDir: site, contentDir: path.join(site, "content") };
});

afterEach(() => fs.rmSync(site, { recursive: true, force: true }));

describe("createLocalSiteConfig", () => {
  it("reads locales from the site's typren.config.json and injects auth", () => {
    write("typren.config.json", JSON.stringify({ locales: ["en", "de"], defaultLocale: "de" }));
    const c = config();
    expect(c.adapter.locales).toEqual(["en", "de"]);
    expect(c.adapter.defaultLocale).toBe("de");
    expect(c.settingsAdapter?.readBootstrap().defaultLocale).toBe("de");
    expect(c.auth).toBe(allow);
    expect(c.git).toBeUndefined();
    expect(c.withCommit).toBeUndefined();
  });

  it("stores media under media.dir, public/img at /img by default", async () => {
    const upload = async (s: LocalSite) =>
      (await createLocalSiteConfig(s, { auth: allow }).mediaAdapter!.upload({ name: "a.webp", buffer: Buffer.from([1]), mime: "image/webp" })).url;
    expect(await upload(local)).toMatch(/^\/img\/a-\w+\.webp$/);
    expect(await upload({ ...local, media: { dir: "static/up", publicPath: "/up" } })).toMatch(/^\/up\/a-\w+\.webp$/);
    expect(fs.readdirSync(file("static/up"))).toHaveLength(1);
  });

  it("commits the published page file on publish, with folder markers riding along", async () => {
    initRepo();
    write("typren.config.json", JSON.stringify({ locales: ["en", "de"], defaultLocale: "en" }));
    write("content/de/home.md", page("Start"));
    const c = config();
    expect(c.git).toBeDefined();
    fs.appendFileSync(file("content/home.md"), "Edited.\n");
    await c.onPublish!("home", "en");
    expect(sh("log", "-1", "--format=%s")).toBe("content: update home");
    await c.onPublish!("home", "de");
    expect(lastCommit()).toEqual(["content: update home (de)", "A\tcontent/de/home.md"]);
    await c.adapter.createFolder!("event");
    fs.appendFileSync(file("content/home.md"), "More.\n");
    await c.onPublish!("home", "en");
    expect(lastCommit().slice(1)).toEqual(["A\tcontent/event/.typren-folder", "M\tcontent/home.md"]);
    // Deleting it commits at once, leaving no stray deletion in the tree.
    await c.adapter.deleteFolder!("event");
    expect(lastCommit()).toEqual(["content: delete folder event", "D\tcontent/event/.typren-folder"]);
    expect(sh("status", "--porcelain", "--", "content")).toBe("");
  });

  it("puts the draft back when the publish commit fails, so Save can retry", async () => {
    initRepo();
    fs.appendFileSync(file("content/home.md"), "Edited.\n");
    blockCommits();
    await expect(config().onPublish!("home", "en")).rejects.toThrow("A check in your repository stopped the commit: blocked");
    expect(read("content/.drafts/home.md")).toBe(read("content/home.md"));
  });

  it("refuses a folder delete on a detached HEAD before removing it, and restores it on a failed commit", async () => {
    initRepo();
    const c = config();
    await c.adapter.createFolder!("event");
    sh("add", ".");
    sh("commit", "-q", "-m", "folder");
    sh("checkout", "-q", "--detach");
    await expect(c.adapter.deleteFolder!("event")).rejects.toThrow(/branch/);
    expect(fs.existsSync(file("content/event/.typren-folder"))).toBe(true);
    sh("checkout", "-q", "main");
    blockCommits();
    await expect(c.adapter.deleteFolder!("event")).rejects.toThrow(/blocked/);
    expect(fs.existsSync(file("content/event/.typren-folder"))).toBe(true);
  });

  it("commits a rename at once, moving only what git tracks, and refuses on a detached HEAD first", async () => {
    write("content/event/1.md", page("Day one"));
    initRepo();
    const actions = makeActions(config());
    // An ignored draft moves on disk but stays out of the commit.
    await actions.saveDraft("event/1", { meta: { title: "Day one!" }, slices: [], body: "" });
    expect(await actions.renamePage("event/1", "event/day-one")).toEqual({ ok: true, slug: "event/day-one" });
    expect(lastCommit()[0]).toBe("content: rename event/1 to event/day-one");
    expect(lastCommit().slice(1).sort()).toEqual(["A\tcontent/event/day-one.md", "D\tcontent/event/1.md"]);
    expect(sh("status", "--porcelain")).toBe("");
    expect(fs.existsSync(file("content/.drafts/event/day-one.md"))).toBe(true);

    sh("checkout", "-q", "--detach");
    await expect(actions.renamePage("event/day-one", "event/two")).rejects.toThrow(/branch/);
    expect(fs.existsSync(file("content/event/day-one.md"))).toBe(true);
    expect(fs.existsSync(file("content/event/two.md"))).toBe(false);
  });

  it("moves a renamed page back when its commit fails", async () => {
    write("content/about.md", page("About"));
    initRepo();
    blockCommits();
    await expect(makeActions(config()).renamePage("about", "team")).rejects.toThrow("A check in your repository stopped the commit: blocked");
    expect(fs.existsSync(file("content/about.md"))).toBe(true);
    expect(fs.existsSync(file("content/team.md"))).toBe(false);
  });
});

describe("local site page writes in a git checkout", () => {
  beforeEach(() => {
    write("typren.config.json", JSON.stringify({ locales: ["en", "de"], defaultLocale: "en" }));
    write("content/de/home.md", page("Start"));
    initRepo();
  });

  it("commits a published create, but not a draft one", async () => {
    const actions = makeActions(config());
    await actions.createPage("About", undefined, { slug: "about" });
    expect(lastCommit()).toEqual(["content: create about", "A\tcontent/about.md"]);
    await actions.createPage("Über", "de", { slug: "about" });
    expect(lastCommit()).toEqual(["content: create about (de)", "A\tcontent/de/about.md"]);
    await actions.createPage("Later", undefined, { slug: "later", draft: true });
    expect(sh("log", "-1", "--format=%s")).toBe("content: create about (de)");
  });

  it("commits a duplicate's published copy, leaving its draft uncommitted", async () => {
    const actions = makeActions(config());
    await actions.saveDraft("home", { meta: { title: "Home draft" }, slices: [], body: "" });
    expect(await actions.duplicatePage("home")).toBe("home-copy");
    expect(lastCommit()).toEqual(["content: duplicate home", "A\tcontent/home-copy.md"]);
    expect(fs.existsSync(file("content/.drafts/home-copy.md"))).toBe(true);
  });

  it("commits a page delete in every locale, and a translation delete in one", async () => {
    const actions = makeActions(config());
    await actions.deleteTranslation("home", "de");
    expect(lastCommit()).toEqual(["content: delete home (de)", "D\tcontent/de/home.md"]);
    write("content/about.md", page("About"));
    sh("add", "content/about.md");
    sh("commit", "-qm", "about");
    await actions.deletePage("about");
    expect(lastCommit()).toEqual(["content: delete about", "D\tcontent/about.md"]);
    expect(sh("status", "--porcelain")).toBe("");
  });

  it("commits the menu with a page delete, and in a commit of its own after a rename", async () => {
    write("content/site.md", "---\nnav:\n  - label: Team\n    href: /team\n  - label: Crew\n    href: /crew\n---\n");
    write("content/team.md", page("Team"));
    write("content/crew.md", page("Crew"));
    sh("add", "content");
    sh("commit", "-qm", "menu");
    const actions = makeActions(config());
    await actions.deletePage("crew");
    expect(lastCommit()).toEqual(["content: delete crew", "D\tcontent/crew.md", "M\tcontent/site.md"]);
    await actions.renamePage("team", "people");
    expect(lastCommit()).toEqual(["content: update menu links to people", "M\tcontent/site.md"]);
    expect(sh("log", "-1", "--skip=1", "--format=%s")).toBe("content: rename team to people");
    expect(read("content/site.md")).toContain("href: /people");
    expect(sh("status", "--porcelain")).toBe("");
  });

  it("refuses on a detached HEAD before writing, and puts every file back when the commit fails", async () => {
    write("content/team.md", page("Team"));
    write("content/de/team.md", page("Mannschaft"));
    sh("add", "content");
    sh("commit", "-qm", "team");
    const actions = makeActions(config());
    await actions.saveDraft("team", { meta: { title: "Draft" }, slices: [], body: "" });
    sh("checkout", "-q", "--detach");
    await expect(actions.deletePage("team")).rejects.toThrow(/branch/);
    expect(fs.existsSync(file("content/team.md"))).toBe(true);
    sh("checkout", "-q", "main");
    blockCommits();
    await expect(actions.deletePage("team")).rejects.toThrow(/blocked/);
    expect(read("content/team.md")).toBe(page("Team"));
    expect(read("content/de/team.md")).toBe(page("Mannschaft"));
    expect(read("content/.drafts/team.md")).toContain("Draft");
    await expect(actions.createPage("About", undefined, { slug: "about" })).rejects.toThrow(/blocked/);
    expect(fs.existsSync(file("content/about.md"))).toBe(false);
  });

  it("leaves the files and the index as they were when a Save, create or rename commit fails", async () => {
    const actions = makeActions(config());
    await actions.createPage("Later", undefined, { slug: "later", draft: true });
    blockCommits();
    const home = read("content/home.md");
    const draft = { meta: { title: "Edited" }, slices: [], body: "" };
    await expect(actions.commitPage("home", draft)).rejects.toThrow(/blocked/);
    expect(read("content/home.md")).toBe(home);
    expect(read("content/.drafts/home.md")).toContain("Edited");
    await expect(actions.commitPage("later")).rejects.toThrow(/blocked/);
    expect(fs.existsSync(file("content/later.md"))).toBe(false);
    expect(fs.existsSync(file("content/.drafts/later.md"))).toBe(true);
    await expect(actions.createPage("About", undefined, { slug: "about" })).rejects.toThrow(/blocked/);
    await expect(actions.renamePage("home", "start")).rejects.toThrow(/home page/);
    write("content/team.md", page("Team"));
    sh("add", "content/team.md");
    sh("commit", "-qm", "team", "--no-verify");
    await expect(actions.renamePage("team", "crew")).rejects.toThrow(/blocked/);
    expect(read("content/team.md")).toBe(page("Team"));
    expect(sh("status", "--porcelain")).toBe("");
  });
});

describe("local site media writes in a git checkout", () => {
  const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: "#f00" } }).png().toBuffer();
  // A stub form, as in media.test.ts: jsdom's File isn't undici's.
  const upload = async (name = "Photo.png", folder?: string) => {
    const fields: Record<string, unknown> = { file: new File([await png()], name), folder };
    const req = { headers: new Headers(), formData: async () => ({ get: (k: string) => fields[k] ?? null }) };
    return handleMediaUpload(config(), req as unknown as Request);
  };

  beforeEach(() => {
    write("public/img/a.webp", "a");
    write("app/page.tsx", 'src="/img/a.webp"');
    write("content/home.md", page("Home") + "![](/img/a.webp)\n");
    initRepo();
  });

  it("commits an upload and a delete", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(lastCommit()).toEqual([`media: upload photo.webp`, `A\tpublic/img/${id}`]);
    await makeActions(config()).deleteMedia(id);
    expect(lastCommit()).toEqual([`media: delete ${id}`, `D\tpublic/img/${id}`]);
  });

  it("answers a failed upload commit with its reason and removes the file", async () => {
    blockCommits();
    const res = await upload();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "A check in your repository stopped the commit: blocked" });
    expect(fs.readdirSync(file("public/img"))).toEqual(["a.webp"]);
    expect(sh("status", "--porcelain")).toBe("");
  });

  it("leaves an ignored media dir out of the commit", async () => {
    write(".gitignore", "content/.drafts/\npublic/img/uploads/\n");
    sh("commit", "-qam", "ignore uploads");
    const res = await upload("x.png", "uploads");
    expect(res.status).toBe(200);
    expect(sh("log", "-1", "--format=%s")).toBe("ignore uploads");
  });

  it("commits a move with the page and site files it rewrote, leaving drafts out", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const actions = makeActions(config());
    await actions.saveDraft("home", { meta: { title: "Home" }, slices: [], body: "![](/img/a.webp)\n" });
    await actions.moveMedia("a.webp", "pics");
    expect(lastCommit()[0]).toBe("media: move a.webp");
    expect(lastCommit().slice(1).sort()).toEqual([
      "A\tpublic/img/pics/a.webp",
      "D\tpublic/img/a.webp",
      "M\tapp/page.tsx",
      "M\tcontent/home.md",
    ]);
    expect(read("content/.drafts/home.md")).toContain("/img/pics/a.webp");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("page.tsx"));
    await actions.renameMediaFolder("pics", "photos");
    expect(lastCommit()[0]).toBe("media: move folder pics to photos");
    expect(read("app/page.tsx")).toBe('src="/img/photos/a.webp"');
    expect(sh("status", "--porcelain")).toBe("");
    info.mockRestore();
  });

  it("puts a move and its rewrites back when the commit fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    blockCommits();
    const actions = makeActions(config());
    await expect(actions.moveMedia("a.webp", "pics")).rejects.toThrow(/blocked/);
    await expect(actions.deleteMedia("a.webp", { force: true })).rejects.toThrow(/blocked/);
    expect(read("public/img/a.webp")).toBe("a");
    expect(fs.existsSync(file("public/img/pics/a.webp"))).toBe(false);
    expect(read("app/page.tsx")).toBe('src="/img/a.webp"');
    expect(read("content/home.md")).toContain("/img/a.webp");
    await expect(config().mediaAdapter!.delete("../x")).rejects.toThrow(/unsafe/);
    vi.restoreAllMocks();
  });
});

describe("rewriteSiteFiles", () => {
  it("rewrites source files, skips excluded dirs and non-source files, and lists what changed", () => {
    const ref = 'src="/img/a.webp" alt="/img/a.webp2"';
    write("app/page.tsx", ref);
    write("docs/note.md", ref);
    write("app/data.txt", ref);
    write("node_modules/dep/index.js", ref);
    write("public/robots.json", ref);
    write(".next/x.js", ref);
    write("app/untouched.ts", "nothing here");
    const changed = rewriteSiteFiles(site, [{ from: "/img/a.webp", to: "/img/b/a.webp" }]).sort();
    expect(changed).toEqual([path.join("app", "page.tsx"), path.join("docs", "note.md")]);
    expect(read("app/page.tsx")).toBe('src="/img/b/a.webp" alt="/img/a.webp2"');
    for (const f of ["app/data.txt", "node_modules/dep/index.js", "public/robots.json", ".next/x.js"]) expect(read(f)).toBe(ref);
  });

  it("never writes through a symlinked source file", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "typren-outside-"));
    fs.writeFileSync(path.join(outside, "x.ts"), 'src="/img/a.webp"');
    fs.mkdirSync(file("app"), { recursive: true });
    fs.symlinkSync(path.join(outside, "x.ts"), file("app/link.ts"));
    expect(rewriteSiteFiles(site, [{ from: "/img/a.webp", to: "/img/b.webp" }])).toEqual([]);
    expect(fs.readFileSync(path.join(outside, "x.ts"), "utf8")).toBe('src="/img/a.webp"');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("is the local site's onMediaMove hook", () => {
    write("app/page.tsx", "/img/a.webp");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const c = config();
    void c.onMediaMove!([{ from: "/img/a.webp", to: "/img/z.webp" }]);
    expect(read("app/page.tsx")).toBe("/img/z.webp");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("page.tsx"));
    info.mockClear();
    void c.onMediaMove!([{ from: "/img/none.webp", to: "/img/y.webp" }]);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
