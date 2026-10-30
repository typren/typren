import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTyprenApi } from "./api/routes";
import { createTyprenClient } from "./api/client";
import { createGitRepo, GIT_NO_BRANCH } from "./git";
import { ActionRefusedError } from "./actions";
import { createSliceLibrary } from "./library";
import { libraryFolderError } from "./names";
import { createMarkdownAdapter } from "./markdown-adapter";
import type { AuthAdapter } from "./auth-adapter";
import type { CmsConfig } from "./types";

let dir: string;
let allowed: Set<string>;

const auth: AuthAdapter = { authorize: async ({ action }) => allowed.has(action) };
const config = (): CmsConfig => ({
  registry: {},
  defaults: {},
  adapter: createMarkdownAdapter({ contentDir: path.join(dir, "content") }),
  previewPath: "/preview",
  auth,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-library-"));
  fs.mkdirSync(path.join(dir, "content"));
  allowed = new Set(["read", "saveDraft"]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("createSliceLibrary", () => {
  it("starts empty, then saves, lists and removes in the private .typren dir", async () => {
    const library = createSliceLibrary(config());
    expect(await library.list()).toEqual([]);

    const hero = await library.save("  Big hero ", { slice: "hero", title: "Hi" });
    const cta = await library.save("", { slice: "cta" });
    expect(hero).toMatchObject({ name: "Big hero", slice: { slice: "hero", title: "Hi" } });
    expect(cta.name).toBe("cta");
    expect(Date.parse(hero.savedAt)).not.toBeNaN();
    expect(fs.existsSync(path.join(dir, ".typren", "library.md"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, "content"))).toEqual([]);

    expect((await createSliceLibrary(config()).list()).map((s) => s.name)).toEqual(["Big hero", "cta"]);
    await library.remove(hero.id);
    expect((await library.list()).map((s) => s.id)).toEqual([cta.id]);
  });

  it("refuses a save with no slice type", async () => {
    await expect(createSliceLibrary(config()).save("x", { slice: "" })).rejects.toThrow(/needs a slice/);
  });

  it("reads a doc without a saved list as empty", async () => {
    fs.mkdirSync(path.join(dir, ".typren"));
    fs.writeFileSync(path.join(dir, ".typren", "library.md"), "---\ntitle: x\n---\n");
    expect(await createSliceLibrary(config()).list()).toEqual([]);
  });

  it("fails closed: reads need read, writes need saveDraft", async () => {
    allowed = new Set(["read"]);
    const library = createSliceLibrary(config());
    await expect(library.save("x", { slice: "hero" })).rejects.toThrow(/unauthorized/);
    await expect(library.remove("x")).rejects.toThrow(/unauthorized/);
    allowed = new Set();
    await expect(library.list()).rejects.toThrow(/unauthorized/);
  });
});

describe("library over HTTP", () => {
  const BASE = "https://example.test/api/typren";
  const client = () => {
    const api = createTyprenApi(config(), { basePath: "/api/typren" });
    return createTyprenClient({ baseUrl: BASE, fetch: (input, init) => api.handler(new Request(input as string, init)) });
  };

  it("round-trips list, save and delete through the client", async () => {
    const { library } = client();
    const saved = await library.save("Hero", { slice: "hero" });
    expect(await library.list()).toEqual([saved]);
    await library.remove(saved.id);
    expect(await library.list()).toEqual([]);
  });

  it("rejects a body without a slice, unknown routes, and unauthorized writes", async () => {
    const api = createTyprenApi(config(), { basePath: "/api/typren" });
    const post = (body: unknown) => api.handler(new Request(`${BASE}/library`, { method: "POST", body: JSON.stringify(body) }));
    expect((await post({ name: "x" })).status).toBe(400);
    expect((await api.handler(new Request(`${BASE}/library/x`, { method: "PATCH" }))).status).toBe(404);
    allowed = new Set(["read"]);
    expect((await post({ slice: { slice: "hero" } })).status).toBe(403);
  });
});

describe("updating a saved section", () => {
  it("replaces its slice while unchanged, else reports a conflict or a deleted section", async () => {
    const library = createSliceLibrary(config());
    const hero = await library.save("Hero", { slice: "hero", title: "A" });
    await new Promise((r) => setTimeout(r, 2));
    const done = await library.update(hero.id, { slice: "hero", title: "B" }, hero.savedAt);
    expect(done).toMatchObject({ ok: true, saved: { id: hero.id, name: "Hero", slice: { title: "B" } } });
    expect(done.ok && done.saved.savedAt).not.toBe(hero.savedAt);
    expect(await library.update(hero.id, { slice: "hero" }, hero.savedAt)).toEqual({ ok: false, code: "conflict" });
    expect(await library.update("gone", { slice: "hero" }, hero.savedAt)).toEqual({ ok: false, code: "missing" });
    expect((await library.list())[0]!.slice.title).toBe("B");
    const latest = (await library.list())[0]!;
    expect(await library.update(hero.id, latest.slice, latest.savedAt, "  ")).toMatchObject({ ok: true, saved: { name: "Hero" } });
    await library.remove("gone");
    expect(await library.list()).toHaveLength(1);
  });

  it("goes over HTTP: 200, 409 on a conflict, 404 when gone, 400 without a base", async () => {
    const api = createTyprenApi(config(), { basePath: "/api/typren" });
    const base = "https://example.test/api/typren";
    const { library } = createTyprenClient({ baseUrl: base, fetch: (input, init) => api.handler(new Request(input as string, init)) });
    const hero = await library.save("Hero", { slice: "hero" });
    await new Promise((r) => setTimeout(r, 2));
    expect(await library.update(hero.id, { slice: "hero", x: 1 }, hero.savedAt, " Big hero ")).toMatchObject({ ok: true, saved: { name: "Big hero" } });
    expect(await library.update(hero.id, { slice: "hero" }, hero.savedAt)).toEqual({ ok: false, code: "conflict" });
    const put = (id: string, b: unknown) => api.handler(new Request(`${base}/library/${id}`, { method: "PUT", body: JSON.stringify(b) }));
    expect((await put("gone", { slice: { slice: "hero" }, baseSavedAt: "x" })).status).toBe(404);
    expect((await put(hero.id, { slice: { slice: "hero" } })).status).toBe(400);
  });
});

describe("library in a local git checkout", () => {
  // Under the pre-push hook GIT_DIR points at the typren checkout; strip it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const gitConfig = (): CmsConfig => ({ ...config(), git: createGitRepo({ dir }) });
  beforeEach(() => {
    sh("init", "-q", "-b", "main");
    sh("config", "user.name", "Test");
    sh("config", "user.email", "test@example.test");
    fs.writeFileSync(path.join(dir, "content", "home.md"), "---\nslices: []\n---\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "init");
  });

  it("commits each save, update and delete of .typren/library.md", async () => {
    const library = createSliceLibrary(gitConfig());
    const hero = await library.save("Hero", { slice: "hero" });
    await new Promise((r) => setTimeout(r, 2));
    await library.update(hero.id, { slice: "hero", title: "B" }, hero.savedAt);
    await library.remove(hero.id);
    expect(sh("log", "--format=%s", "-3").split("\n")).toEqual([
      "content: delete section Hero",
      "content: update section Hero",
      "content: save section Hero",
    ]);
    expect(sh("show", "--name-only", "--format=", "HEAD")).toBe(".typren/library.md");
    expect(sh("status", "--porcelain")).toBe("");
  });

  it("refuses on a detached HEAD before writing anything", async () => {
    sh("checkout", "-q", "--detach");
    await expect(createSliceLibrary(gitConfig()).save("Hero", { slice: "hero" })).rejects.toThrow(GIT_NO_BRANCH);
    expect(fs.existsSync(path.join(dir, ".typren", "library.md"))).toBe(false);
  });

  it("puts the doc back when the commit fails", async () => {
    const library = createSliceLibrary(gitConfig());
    await library.save("Hero", { slice: "hero" });
    const before = fs.readFileSync(path.join(dir, ".typren", "library.md"), "utf8");
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho nope >&2\nexit 1\n", { mode: 0o755 });
    await expect(library.save("Cta", { slice: "cta" })).rejects.toThrow(/nope/);
    expect(fs.readFileSync(path.join(dir, ".typren", "library.md"), "utf8")).toBe(before);

    fs.rmSync(path.join(dir, ".typren"), { recursive: true });
    sh("rm", "-q", "--cached", "-r", ".typren");
    await expect(library.save("Cta", { slice: "cta" })).rejects.toThrow(/nope/);
    expect(fs.existsSync(path.join(dir, ".typren", "library.md"))).toBe(false);
  });
});

describe("page templates", () => {
  it("live beside saved sections in the same doc, each write keeping the other", async () => {
    const library = createSliceLibrary(config());
    expect(await library.templates.list()).toEqual([]);
    const hero = await library.save("Hero", { slice: "hero" });
    const landing = await library.templates.save("  Landing ", [{ slice: "hero" }, { slice: "cta" }]);
    expect(landing).toMatchObject({ name: "Landing", slices: [{ slice: "hero" }, { slice: "cta" }] });
    expect((await library.templates.save("", [])).name).toBe("Untitled template");
    await library.save("Cta", { slice: "cta" });
    expect((await library.list()).map((s) => s.name)).toEqual(["Hero", "Cta"]);
    expect((await library.templates.list()).map((t) => t.name)).toEqual(["Landing", "Untitled template"]);
    await library.remove(hero.id);
    await library.templates.remove(landing.id);
    await library.templates.remove("gone");
    expect((await library.list()).map((s) => s.name)).toEqual(["Cta"]);
    expect((await library.templates.list()).map((t) => t.name)).toEqual(["Untitled template"]);
  });

  it("refuses slices that are not a list of typed slices", async () => {
    const { templates } = createSliceLibrary(config());
    await expect(templates.save("x", [{ slice: "" }])).rejects.toThrow(/list of slices/);
    await expect(templates.save("x", "hero" as never)).rejects.toThrow(/list of slices/);
  });

  it("updates while unchanged, else reports a conflict or a deleted template", async () => {
    const { templates } = createSliceLibrary(config());
    const t = await templates.save("Landing", [{ slice: "hero" }]);
    await new Promise((r) => setTimeout(r, 2));
    const done = await templates.update(t.id, [{ slice: "cta" }, { slice: "hero" }], t.savedAt, " Home ");
    expect(done).toMatchObject({ ok: true, saved: { id: t.id, name: "Home", slices: [{ slice: "cta" }, { slice: "hero" }] } });
    expect(done.ok && (await templates.update(t.id, [], done.saved.savedAt))).toMatchObject({ ok: true, saved: { name: "Home" } });
    expect(await templates.update(t.id, [], t.savedAt)).toEqual({ ok: false, code: "conflict" });
    expect(await templates.update("gone", [], t.savedAt)).toEqual({ ok: false, code: "missing" });
  });

  it("fails closed: reads need read, writes need saveDraft", async () => {
    allowed = new Set(["read"]);
    const { templates } = createSliceLibrary(config());
    await expect(templates.save("x", [])).rejects.toThrow(/unauthorized/);
    await expect(templates.update("x", [], "x")).rejects.toThrow(/unauthorized/);
    await expect(templates.remove("x")).rejects.toThrow(/unauthorized/);
    allowed = new Set();
    await expect(templates.list()).rejects.toThrow(/unauthorized/);
  });

  it("go over HTTP: round trip, 409 on a conflict, 404 when gone, 400 on a bad body", async () => {
    const api = createTyprenApi(config(), { basePath: "/api/typren" });
    const base = "https://example.test/api/typren";
    const { library } = createTyprenClient({ baseUrl: base, fetch: (input, init) => api.handler(new Request(input as string, init)) });
    const t = await library.templates.save("Landing", [{ slice: "hero" }]);
    expect(await library.templates.list()).toEqual([t]);
    await new Promise((r) => setTimeout(r, 2));
    expect(await library.templates.update(t.id, [{ slice: "cta" }], t.savedAt, "Home")).toMatchObject({ ok: true, saved: { name: "Home" } });
    expect(await library.templates.update(t.id, [], t.savedAt)).toEqual({ ok: false, code: "conflict" });
    const req = (method: string, path: string, b?: unknown) =>
      api.handler(new Request(`${base}/library/templates${path}`, { method, body: b === undefined ? undefined : JSON.stringify(b) }));
    expect((await req("PUT", "/gone", { slices: [], baseSavedAt: "x" })).status).toBe(404);
    expect((await req("PUT", `/${t.id}`, { slices: [] })).status).toBe(400);
    expect((await req("POST", "", { name: "x", slices: [{}] })).status).toBe(400);
    expect((await req("PATCH", "")).status).toBe(404);
    await library.templates.remove(t.id);
    expect(await library.templates.list()).toEqual([]);
    expect(await library.list()).toEqual([]);
  });
});

describe("page templates in a local git checkout", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  beforeEach(() => {
    sh("init", "-q", "-b", "main");
    sh("config", "user.name", "Test");
    sh("config", "user.email", "test@example.test");
    fs.writeFileSync(path.join(dir, "content", "home.md"), "---\nslices: []\n---\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "init");
  });

  it("commits each save, update and delete, and refuses on a detached HEAD", async () => {
    const { templates } = createSliceLibrary({ ...config(), git: createGitRepo({ dir }) });
    const t = await templates.save("Landing", [{ slice: "hero" }]);
    await new Promise((r) => setTimeout(r, 2));
    await templates.update(t.id, [], t.savedAt);
    await templates.remove(t.id);
    expect(sh("log", "--format=%s", "-3").split("\n")).toEqual([
      "content: delete page template Landing",
      "content: update page template Landing",
      "content: save page template Landing",
    ]);
    expect(sh("status", "--porcelain")).toBe("");
    sh("checkout", "-q", "--detach");
    await expect(templates.save("X", [])).rejects.toThrow(GIT_NO_BRANCH);
  });
});

describe("library folders", () => {
  it("keeps empty folders, moves entries, renames subtrees and refuses non-empty deletes", async () => {
    const library = createSliceLibrary(config());
    const hero = await library.save("Hero", { slice: "hero" });
    await library.folders.create("marketing/heroes");
    expect(await library.folders.list()).toEqual(["marketing", "marketing/heroes"]);

    const moved = await library.move(hero.id, "marketing/heroes", hero.savedAt);
    expect(moved).toMatchObject({ ok: true, saved: { folder: "marketing/heroes", savedAt: hero.savedAt } });
    expect(await library.move(hero.id, "marketing", "stale")).toEqual({ ok: false, code: "conflict" });
    expect(await library.move("nope", "marketing")).toEqual({ ok: false, code: "missing" });
    await expect(library.move(hero.id, "absent")).rejects.toThrow(/no section folder/);

    await expect(library.folders.delete("marketing")).rejects.toThrow(/not empty/);
    await library.folders.rename("marketing", "promo");
    expect(await library.folders.list()).toEqual(["promo", "promo/heroes"]);
    expect((await library.list())[0]!.folder).toBe("promo/heroes");
    await expect(library.folders.rename("promo", "promo/inner")).rejects.toThrow(/into itself/);

    await library.move(hero.id, "");
    expect((await library.list())[0]).not.toHaveProperty("folder");
    await library.folders.delete("promo/heroes");
    await library.folders.delete("promo");
    expect(await library.folders.list()).toEqual([]);
  });

  it("keeps section and template folders apart", async () => {
    const library = createSliceLibrary(config());
    await library.templates.folders.create("landing");
    expect(await library.folders.list()).toEqual([]);
    expect(await library.templates.folders.list()).toEqual(["landing"]);
    const tpl = await library.templates.save("Home", [{ slice: "hero" }]);
    expect(await library.templates.move(tpl.id, "landing")).toMatchObject({ ok: true, saved: { folder: "landing" } });
  });

  it("refuses traversal, bad names and the reserved built-in folder", async () => {
    const library = createSliceLibrary(config());
    for (const bad of ["..", "a/../b", "/a", "a//b", "A", "built-in", "built-in/x", "a\\b", ""])
      await expect(library.folders.create(bad), bad).rejects.toThrow(ActionRefusedError);
    expect(libraryFolderError("ok/built-in")).toBeNull();
  });

  it("fails closed: folder reads need read, folder writes and moves need saveDraft", async () => {
    allowed = new Set(["read"]);
    const library = createSliceLibrary(config());
    expect(await library.folders.list()).toEqual([]);
    await expect(library.folders.create("a")).rejects.toThrow("unauthorized");
    await expect(library.move("x", "")).rejects.toThrow("unauthorized");
    allowed = new Set();
    await expect(library.templates.folders.list()).rejects.toThrow("unauthorized");
  });

  it("go over HTTP for both lists: folders, move with 409 and 404, 422 on refusals", async () => {
    const api = createTyprenApi(config(), { basePath: "/api/typren" });
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => api.handler(new Request(input as string, init));
    const { library } = createTyprenClient({ baseUrl: "http://site.test/api/typren", fetch });
    for (const lib of [library, library.templates]) {
      await lib.folders.create("a/b");
      await lib.folders.rename("a", "c");
      expect(await lib.folders.list()).toEqual(["c", "c/b"]);
      await expect(lib.folders.create("..")).rejects.toMatchObject({ status: 422 });
      await lib.folders.delete("c/b");
      expect(await lib.folders.list()).toEqual(["c"]);
    }
    const s = await library.save("S", { slice: "hero" });
    expect(await library.move(s.id, "c", s.savedAt)).toMatchObject({ ok: true, saved: { folder: "c" } });
    expect(await library.move(s.id, "", "stale")).toEqual({ ok: false, code: "conflict" });
    await expect(library.folders.delete("c")).rejects.toMatchObject({ status: 422 });
    await expect(library.move("gone", "")).rejects.toMatchObject({ status: 404 });
    const bad = await fetch("http://site.test/api/typren/library/x/move", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
  });
});
