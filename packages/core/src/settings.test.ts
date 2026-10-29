import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitRepo } from "./git";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createFsSettingsAdapter, createSettingsStore, validateBootstrap } from "./settings";
import type { CmsConfig } from "./types";
import type { AuthAdapter, AuthAction, AuthContext } from "./auth-adapter";
import type { SiteSettingsBootstrap } from "./settings";

let dir: string;
let contentDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-settings-"));
  contentDir = path.join(dir, "content");
  fs.mkdirSync(contentDir, { recursive: true });
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const alwaysAllow: AuthAdapter = { authorize: async () => true };

function makeConfig(auth: AuthAdapter = alwaysAllow): CmsConfig {
  return {
    registry: {},
    defaults: {},
    adapter: createMarkdownAdapter({ contentDir }),
    previewPath: "/studio/preview",
    auth,
  };
}

describe("createFsSettingsAdapter", () => {
  it("round-trips bootstrap fields atomically (no leftover tmp file)", () => {
    const file = path.join(dir, "typren.config.json");
    const adapter = createFsSettingsAdapter({ file });

    expect(adapter.readBootstrap()).toMatchObject({ adminRoute: "studio", onboarded: false });

    adapter.writeBootstrap({ adminRoute: "backoffice", onboarded: true });

    expect(adapter.readBootstrap()).toMatchObject({ adminRoute: "backoffice", onboarded: true });
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("merges partial patches over defaults across writes", () => {
    const file = path.join(dir, "typren.config.json");
    const adapter = createFsSettingsAdapter({ file });
    adapter.writeBootstrap({ adminRoute: "cms" });
    adapter.writeBootstrap({ onboarded: true });
    expect(adapter.readBootstrap()).toMatchObject({
      adminRoute: "cms",
      onboarded: true,
      locales: ["en"],
      defaultLocale: "en",
    });
  });
});

describe("createSettingsStore", () => {
  it("sites its adapter in a private .typren/ dir beside the Pages content dir", () => {
    createSettingsStore(makeConfig());
    expect(fs.existsSync(path.join(dir, ".typren"))).toBe(false); // not created until first write
  });

  it("get() returns the empty default before any settings doc exists", async () => {
    const store = createSettingsStore(makeConfig());
    expect(await store.get()).toEqual({ brand: { name: "" }, seo: {} });
  });

  it("saveDraft then publish round-trips runtime settings, never touching the Pages dir", async () => {
    const store = createSettingsStore(makeConfig());
    const draft = { brand: { name: "Acme" }, seo: { description: "A site" } };

    const saved = await store.saveDraft(draft);
    expect(saved.ok).toBe(true);

    const published = await store.publish();
    expect(published.ok).toBe(true);

    expect(await store.get()).toMatchObject(draft);
    expect(fs.readdirSync(contentDir)).toEqual([]); // Pages dir untouched
    expect(fs.existsSync(path.join(dir, ".typren", "settings.md"))).toBe(true);
  });

  it("reports the draft's version before the first publish, so the next save can conflict-detect", async () => {
    const store = createSettingsStore(makeConfig());
    expect(await store.currentVersion()).toBeNull();

    const saved = await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    expect(saved.ok).toBe(true);
    expect(await store.currentVersion()).toBe((saved as { version: string }).version);
  });

  it("falls back to the default locale's settings for a locale with no translation", async () => {
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: createMarkdownAdapter({ contentDir, locales: ["en", "fr"], defaultLocale: "en" }),
      previewPath: "/studio/preview",
      auth: alwaysAllow,
    };
    const store = createSettingsStore(config);
    await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    await store.publish();

    expect(await store.get("fr")).toMatchObject({ brand: { name: "Acme" } });
    expect(await store.get("fr")).not.toEqual({ brand: { name: "" }, seo: {} });
  });

  it("throws a clear error when the Pages adapter has no root and no settingsContentAdapter is given", () => {
    const noRootAdapter = { ...createMarkdownAdapter({ contentDir }) };
    delete (noRootAdapter as { root?: string }).root;
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: noRootAdapter,
      previewPath: "/studio/preview",
      auth: alwaysAllow,
    };
    expect(() => createSettingsStore(config)).toThrow(/settingsContentAdapter/);
  });

  it("uses the explicit settingsContentAdapter when the Pages adapter has no root", async () => {
    const noRootAdapter = { ...createMarkdownAdapter({ contentDir }) };
    delete (noRootAdapter as { root?: string }).root;
    const settingsDir = path.join(dir, "settings-content");
    fs.mkdirSync(settingsDir, { recursive: true });
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: noRootAdapter,
      previewPath: "/studio/preview",
      auth: alwaysAllow,
      settingsContentAdapter: createMarkdownAdapter({ contentDir: settingsDir }),
    };
    const store = createSettingsStore(config);
    expect(await store.get()).toEqual({ brand: { name: "" }, seo: {} });
    const saved = await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    expect(saved.ok).toBe(true);
    expect(fs.existsSync(path.join(settingsDir, ".drafts", "settings.md"))).toBe(true);
  });

  it("throws when settingsContentAdapter is the SAME instance as config.adapter", () => {
    const sharedAdapter = createMarkdownAdapter({ contentDir });
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: sharedAdapter,
      previewPath: "/studio/preview",
      auth: alwaysAllow,
      settingsContentAdapter: sharedAdapter,
    };
    expect(() => createSettingsStore(config)).toThrow(/same adapter instance/);
  });

  it("throws when settingsContentAdapter's root is the same directory as config.adapter's root", () => {
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: createMarkdownAdapter({ contentDir }),
      previewPath: "/studio/preview",
      auth: alwaysAllow,
      settingsContentAdapter: createMarkdownAdapter({ contentDir }), // a second instance, same dir
    };
    expect(() => createSettingsStore(config)).toThrow(/overlap|same as/);
  });

  it("throws when settingsContentAdapter's root is NESTED inside config.adapter's root", () => {
    const nestedDir = path.join(contentDir, "settings");
    fs.mkdirSync(nestedDir, { recursive: true });
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: createMarkdownAdapter({ contentDir }),
      previewPath: "/studio/preview",
      auth: alwaysAllow,
      settingsContentAdapter: createMarkdownAdapter({ contentDir: nestedDir }),
    };
    expect(() => createSettingsStore(config)).toThrow(/overlap|same as/);
  });

  it("does not throw for a distinct, non-overlapping settingsContentAdapter root", () => {
    const settingsDir = path.join(dir, "settings-content");
    fs.mkdirSync(settingsDir, { recursive: true });
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter: createMarkdownAdapter({ contentDir }),
      previewPath: "/studio/preview",
      auth: alwaysAllow,
      settingsContentAdapter: createMarkdownAdapter({ contentDir: settingsDir }),
    };
    expect(() => createSettingsStore(config)).not.toThrow();
  });

  // Regression: a hosted/multi-tenant config (siteId set) with no explicit
  // settingsAdapter used to silently fall through to the single-process
  // default (one typren.config.json at process.cwd()), so every tenant's
  // bootstrap read/write hit the SAME file -- a structural tenant-isolation
  // break, not a mere misconfiguration.
  it("throws when siteId is set but no settingsAdapter is given", () => {
    const config: CmsConfig = { ...makeConfig(), siteId: "tenant-a" };
    expect(() => createSettingsStore(config)).toThrow(/settingsAdapter/);
  });

  it("does not throw when siteId is set AND an explicit settingsAdapter is given", () => {
    const config: CmsConfig = {
      ...makeConfig(),
      siteId: "tenant-a",
      settingsAdapter: createFsSettingsAdapter({ file: path.join(dir, "tenant-a.json") }),
    };
    expect(() => createSettingsStore(config)).not.toThrow();
  });

  it("gates writes on the distinct 'admin' auth action, not the content-write action", async () => {
    const actions: AuthAction[] = [];
    const denyAdmin: AuthAdapter = {
      authorize: async (ctx) => {
        actions.push(ctx.action);
        return ctx.action !== "admin";
      },
    };
    const store = createSettingsStore(makeConfig(denyAdmin));
    await expect(store.saveDraft({ brand: { name: "X" }, seo: {} })).rejects.toThrow(/unauthorized/);
    expect(actions).toContain("admin");
  });

  // The admin gate must see the locale it writes, as every content write
  // does, or a per-locale settings policy is bypassed by the admin check.
  it("passes the target locale to the admin gate, and a policy denying it denies", async () => {
    const seen: AuthContext[] = [];
    const denyDeAdmin: AuthAdapter = {
      authorize: async (ctx) => {
        seen.push(ctx);
        return !(ctx.action === "admin" && ctx.locale === "de");
      },
    };
    const store = createSettingsStore(makeConfig(denyDeAdmin));
    await expect(store.saveDraft({ brand: { name: "X" }, seo: {} }, undefined, "de")).rejects.toThrow(/unauthorized/);
    await expect(store.publish(undefined, "de")).rejects.toThrow(/unauthorized/);
    expect(seen.filter((c) => c.action === "admin").map((c) => c.locale)).toEqual(["de", "de"]);
    await expect(store.saveDraft({ brand: { name: "X" }, seo: {} }, undefined, "en")).resolves.toMatchObject({ ok: true });
  });
});

describe("settings in a local git checkout", () => {
  // Under the pre-push hook GIT_DIR points at the typren checkout; strip it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const gitStore = () =>
    createSettingsStore({
      ...makeConfig(),
      adapter: createMarkdownAdapter({ contentDir, locales: ["en", "de"], defaultLocale: "en" }),
      git: createGitRepo({ dir }),
    });
  beforeEach(() => {
    sh("init", "-q", "-b", "main");
    sh("config", "user.name", "Test");
    sh("config", "user.email", "test@example.test");
    sh("commit", "-q", "--allow-empty", "-m", "init");
  });

  it("commits the settings doc on publish, so Push sends it", async () => {
    const store = gitStore();
    await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    expect((await store.publish()).ok).toBe(true);
    expect(sh("show", "--name-only", "--format=%s", "HEAD")).toBe("content: update settings\n\n.typren/settings.md");
    await store.saveDraft({ brand: { name: "Acme DE" }, seo: {} }, undefined, "de");
    await store.publish(undefined, "de");
    expect(sh("show", "--name-only", "--format=%s", "HEAD")).toBe("content: update settings (de)\n\n.typren/de/settings.md");
    expect(sh("status", "--porcelain", "--", ".typren")).toBe("");
  });

  it("opens the draft over the published doc, discards it, and reads the doc's history", async () => {
    const store = gitStore();
    expect(await store.history()).toEqual([]);
    await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    await store.publish();
    const saved = await store.saveDraft({ brand: { name: "Acme 2" }, seo: {} });
    const opened = await store.open();
    expect(opened).toEqual({ settings: { brand: { name: "Acme 2" }, seo: {} }, version: (saved as { version: string }).version, hasDraft: true });
    await store.discardDraft();
    expect(await store.open()).toMatchObject({ settings: { brand: { name: "Acme" } }, hasDraft: false });
    expect((await store.history()).map((e) => e.subject)).toEqual(["content: update settings"]);
    expect(await createSettingsStore(makeConfig()).history()).toEqual([]);
  });

  it("refuses on a detached HEAD, and keeps the draft pending when the commit fails", async () => {
    const store = gitStore();
    await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    sh("checkout", "-q", "--detach");
    await expect(store.publish()).rejects.toThrow(/branch/);
    expect(fs.existsSync(path.join(dir, ".typren", "settings.md"))).toBe(false);
    sh("checkout", "-q", "main");
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho nope\nexit 1\n", { mode: 0o755 });
    await expect(store.publish()).rejects.toThrow(/nope/);
    expect(fs.existsSync(path.join(dir, ".typren", ".drafts", "settings.md"))).toBe(true);
  });

  it("puts the published settings file back after a failed commit", async () => {
    const store = gitStore();
    const file = path.join(dir, ".typren", "settings.md");
    await store.saveDraft({ brand: { name: "Acme" }, seo: {} });
    await store.publish();
    const committed = fs.readFileSync(file, "utf8");
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho nope\nexit 1\n", { mode: 0o755 });
    await store.saveDraft({ brand: { name: "Changed" }, seo: {} });
    await expect(store.publish()).rejects.toThrow(/nope/);
    expect(fs.readFileSync(file, "utf8")).toBe(committed);
    // A first publish that fails leaves no published file at all.
    fs.rmSync(file);
    sh("commit", "-q", "--no-verify", "-am", "drop settings");
    await store.saveDraft({ brand: { name: "Again" }, seo: {} });
    await expect(store.publish()).rejects.toThrow(/nope/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("writeBootstrap", () => {
  const file = () => path.join(dir, "typren.config.json");
  const store = (auth: AuthAdapter = alwaysAllow) =>
    createSettingsStore({ ...makeConfig(auth), settingsAdapter: createFsSettingsAdapter({ file: file() }) });

  it("writes a valid patch, merged over the current bootstrap", async () => {
    expect(await store().writeBootstrap({ adminRoute: "backoffice" })).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ adminRoute: "backoffice", locales: ["en"] });
  });

  it("refuses an unknown key or an invalid merged result as data, writing nothing", async () => {
    expect(await store().writeBootstrap({ evil: "x" } as never)).toEqual({ ok: false, error: 'unknown bootstrap key "evil"' });
    expect(await store().writeBootstrap({ locales: ["fr"] })).toMatchObject({ ok: false, error: expect.stringMatching(/defaultLocale/) });
    expect(fs.existsSync(file())).toBe(false);
  });

  it("needs the admin action", async () => {
    const denyAdmin: AuthAdapter = { authorize: async ({ action }) => action !== "admin" };
    await expect(store(denyAdmin).writeBootstrap({ onboarded: true })).rejects.toThrow(/unauthorized/);
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("validateBootstrap", () => {
  const valid: SiteSettingsBootstrap = {
    adminRoute: "studio",
    locales: ["en"],
    defaultLocale: "en",
    routing: "prefix-except-default",
    onboarded: false,
  };

  it("accepts a well-formed bootstrap", () => {
    expect(validateBootstrap(valid)).toBeNull();
  });

  it("rejects an unsafe-shaped adminRoute", () => {
    expect(validateBootstrap({ ...valid, adminRoute: "../etc" })).toMatch(/adminRoute/);
  });

  it("rejects a reserved adminRoute", () => {
    expect(validateBootstrap({ ...valid, adminRoute: "api" })).toMatch(/reserved/);
  });

  it("rejects a non-BCP-47-ish locale", () => {
    expect(validateBootstrap({ ...valid, locales: ["en", "../x"] })).toMatch(/locales/);
  });

  it("rejects an empty locales array", () => {
    expect(validateBootstrap({ ...valid, locales: [] })).toMatch(/locales/);
  });

  it("rejects an unknown routing mode", () => {
    expect(validateBootstrap({ ...valid, routing: "bogus" as never })).toMatch(/routing/);
  });

  it("rejects a defaultLocale not present in locales", () => {
    expect(validateBootstrap({ ...valid, locales: ["en", "fr"], defaultLocale: "de" })).toMatch(/defaultLocale/);
  });

  it("rejects a non-boolean onboarded", () => {
    expect(validateBootstrap({ ...valid, onboarded: "true" as unknown as boolean })).toMatch(/onboarded/);
  });
});
