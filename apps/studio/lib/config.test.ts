import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStudio, previewBase, readManifest, sectionRouteUrl, siteTrailingSlash, studioConfig, type StudioManifest } from "./config";

let site: string;
let manifest: StudioManifest;

beforeEach(() => {
  site = fs.mkdtempSync(path.join(os.tmpdir(), "typren-studio-"));
  const contentDir = path.join(site, "content");
  fs.mkdirSync(contentDir);
  fs.writeFileSync(path.join(contentDir, "home.md"), "---\ntitle: Home\nslices:\n  - slice: hero\n    heading: Hi\n---\n");
  manifest = { siteDir: site, contentDir, siteUrl: "http://127.0.0.1:3000", defaults: { hero: { heading: "" } } };
});

afterEach(() => fs.rmSync(site, { recursive: true, force: true }));

const allow = (m: StudioManifest) => ({ ...studioConfig(m), auth: { authorize: async () => true } });

describe("readManifest", () => {
  it("parses the env JSON", () => {
    expect(readManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("explains how to start the studio when the env var is missing", () => {
    expect(() => readManifest("")).toThrow(/typren studio/);
  });
});

describe("studio block facts", () => {
  it("frames previews under the previewPath prefix and the section route under the site origin", () => {
    expect(previewBase(manifest)).toBe("http://127.0.0.1:3000");
    expect(previewBase({ ...manifest, previewPath: "/draft/" })).toBe("http://127.0.0.1:3000/draft");
    expect(sectionRouteUrl(manifest)).toBe("http://127.0.0.1:3000/typren/section");
    expect(sectionRouteUrl({ ...manifest, sectionRoute: "/x/section" })).toBe("http://127.0.0.1:3000/x/section");
    expect(sectionRouteUrl({ ...manifest, sectionRoute: false })).toBeUndefined();
  });

  it("stores uploads under media.dir and links them at media.publicPath, public/img at /img by default", async () => {
    const upload = async (m: StudioManifest) =>
      (await studioConfig(m).mediaAdapter!.upload({ name: "a.webp", buffer: Buffer.from([1]), mime: "image/webp" } as never)).url;
    expect(await upload(manifest)).toMatch(/^\/img\/a-\w+\.webp$/);
    expect(fs.readdirSync(path.join(site, "public", "img"))).toHaveLength(1);
    expect(await upload({ ...manifest, media: { dir: "static/up", publicPath: "/up" } })).toMatch(/^\/up\/a-\w+\.webp$/);
    expect(fs.readdirSync(path.join(site, "static", "up"))).toHaveLength(1);
  });
});

describe("studioConfig", () => {
  it("points preview at the site origin and reads locales from the site's typren.config.json", () => {
    fs.writeFileSync(path.join(site, "typren.config.json"), JSON.stringify({ locales: ["en", "de"], defaultLocale: "de" }));
    const config = studioConfig(manifest);
    expect(config.previewPath).toBe("http://127.0.0.1:3000");
    expect(config.adapter.locales).toEqual(["en", "de"]);
    expect(config.adapter.defaultLocale).toBe("de");
    expect(config.settingsAdapter?.readBootstrap().defaultLocale).toBe("de");
  });

  it("gates with localAuth, which denies outside a loopback-bound dev server", async () => {
    expect(await studioConfig(manifest).auth!.authorize({ action: "read" })).toBe(false);
  });
});

describe("loadStudio", () => {
  it("returns null when read is denied", async () => {
    expect(await loadStudio(studioConfig(manifest), null)).toBeNull();
  });

  it("lists pages with no page open for the picker", async () => {
    fs.mkdirSync(path.join(manifest.contentDir, "event"));
    fs.writeFileSync(path.join(manifest.contentDir, "event", ".typren-folder"), "");
    const data = await loadStudio(allow(manifest), null);
    expect(data).toMatchObject({ slug: null, version: null, pages: [{ slug: "home", title: "Home" }], folders: ["event"] });
    expect(data?.page).toBeUndefined();
  });

  it("falls back to the picker for a slug that doesn't exist", async () => {
    expect(await loadStudio(allow(manifest), "missing")).toMatchObject({ slug: null, version: null });
    expect(await loadStudio(allow(manifest), "favicon.ico")).toMatchObject({ slug: null, version: null });
  });

  it("prefers the draft over the published page", async () => {
    fs.mkdirSync(path.join(manifest.contentDir, ".drafts"));
    fs.writeFileSync(
      path.join(manifest.contentDir, ".drafts", "home.md"),
      "---\ntitle: Draft\nslices:\n  - slice: hero\n    heading: Draft\n---\n"
    );
    const data = await loadStudio(allow(manifest), "home");
    expect(data?.slug).toBe("home");
    expect(data?.page?.meta.title).toBe("Draft");
    expect(data?.version).toEqual(expect.any(String));
  });

  it("opens a draft-only page at a nested slug from its draft", async () => {
    fs.mkdirSync(path.join(manifest.contentDir, ".drafts", "event"), { recursive: true });
    fs.writeFileSync(path.join(manifest.contentDir, ".drafts", "event", "1.md"), "---\ntitle: Day one\nslices: []\n---\n");
    const data = await loadStudio(allow(manifest), "event/1");
    expect(data?.slug).toBe("event/1");
    expect(data?.page?.meta.title).toBe("Day one");
    expect(data?.pages.find((p) => p.slug === "event/1")).toMatchObject({ published: false });
  });

  it("hands the studio only the editable bootstrap keys, never the studio block", async () => {
    fs.writeFileSync(path.join(site, "typren.config.json"), JSON.stringify({ adminRoute: "admin", studio: { previewCommand: "npm run dev" } }));
    const { bootstrap } = (await loadStudio(allow(manifest), null))!.settings;
    expect(bootstrap.adminRoute).toBe("admin");
    expect(bootstrap).not.toHaveProperty("studio");
  });

  it("returns the published page when there is no draft", async () => {
    const data = await loadStudio(allow(manifest), "home");
    expect(data?.page?.slices).toEqual([{ slice: "hero", heading: "Hi" }]);
  });
});

describe("siteTrailingSlash", () => {
  afterEach(() => vi.unstubAllGlobals());

  // One sequence, since the answer is cached module-wide once the site replies.
  it("assumes no slash until the site answers, then reads and caches its redirect", async () => {
    expect(await siteTrailingSlash("http://site", undefined)).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await siteTrailingSlash("http://site", "banks")).toBe(false);

    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 308, headers: { location: "/banks/" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await siteTrailingSlash("http://site", "banks")).toBe(true);
    expect(await siteTrailingSlash("http://site", "banks")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
