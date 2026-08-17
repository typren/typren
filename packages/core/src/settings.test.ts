import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createFsSettingsAdapter, createSettingsStore } from "./settings";
import type { CmsConfig } from "./types";
import type { AuthAdapter, AuthAction } from "./auth-adapter";

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

  it("get() returns the empty default before any settings doc exists", () => {
    const store = createSettingsStore(makeConfig());
    expect(store.get()).toEqual({ brand: { name: "" }, seo: {} });
  });

  it("saveDraft then publish round-trips runtime settings, never touching the Pages dir", async () => {
    const store = createSettingsStore(makeConfig());
    const draft = { brand: { name: "Acme" }, seo: { description: "A site" } };

    const saved = await store.saveDraft(draft);
    expect(saved.ok).toBe(true);

    const published = await store.publish();
    expect(published.ok).toBe(true);

    expect(store.get()).toMatchObject(draft);
    expect(fs.readdirSync(contentDir)).toEqual([]); // Pages dir untouched
    expect(fs.existsSync(path.join(dir, ".typren", "settings.md"))).toBe(true);
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
