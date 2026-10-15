import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createFsSettingsAdapter, createSettingsStore, validateBootstrap } from "./settings";
import type { CmsConfig } from "./types";
import type { AuthAdapter, AuthAction } from "./auth-adapter";
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
    previewPath: "/editor/preview",
    auth,
  };
}

describe("createFsSettingsAdapter", () => {
  it("round-trips bootstrap fields atomically (no leftover tmp file)", () => {
    const file = path.join(dir, "typren.config.json");
    const adapter = createFsSettingsAdapter({ file });

    expect(adapter.readBootstrap()).toMatchObject({ adminRoute: "editor", onboarded: false });

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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
      previewPath: "/editor/preview",
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
});

describe("validateBootstrap", () => {
  const valid: SiteSettingsBootstrap = {
    adminRoute: "editor",
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
