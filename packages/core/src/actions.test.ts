import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeActions } from "./actions";
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
    previewPath: "/editor/preview",
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
      { action: "saveDraft", slug: "home", locale: "de" },
      { action: "saveDraft", slug: "home", locale: "de" },
      { action: "publish", slug: "home", locale: "de" },
      { action: "discardDraft", slug: "home", locale: "de" },
      { action: "deletePage", slug: "home", locale: "de" },
      { action: "createPage", slug: "about-us", locale: "de" },
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
    expect(seen.map((c) => c.action)).toEqual(["publish", "publish"]);
  });
});
