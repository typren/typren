import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { scanContentStore } from "./content-scan";

describe("scanContentStore", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("lists slugs and reads frontmatter for markdown files with a slices array", () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\nbody');
    writeFileSync(path.join(dir, "not-a-page.md"), "no frontmatter here");

    const store = scanContentStore(dir);
    expect(store.listPages().map((p) => p.slug)).toEqual(["about"]);
    expect(store.getPublished("about").meta.aliases).toEqual(["/old-about"]);
  });

  it("returns an empty store for a missing content directory", () => {
    const store = scanContentStore(path.join(tmpdir(), "typren-does-not-exist"));
    expect(store.listPages()).toEqual([]);
  });

  it("has no draft/current-version concept (always null)", () => {
    const store = scanContentStore(path.join(tmpdir(), "typren-does-not-exist"));
    expect(store.getDraft("about")).toBeNull();
    expect(store.currentVersion("about")).toBeNull();
  });

  it("is read-only: every mutating method refuses", async () => {
    const store = scanContentStore(path.join(tmpdir(), "typren-does-not-exist"));
    const message = /read-only/;
    expect(() => store.saveDraft("about", { meta: {}, slices: [], body: "" })).toThrow(message);
    expect(() => store.discardDraft("about")).toThrow(message);
    await expect(store.publish("about")).rejects.toThrow(message);
    expect(() => store.createPage("about", { meta: {}, slices: [], body: "" })).toThrow(message);
    expect(() => store.renamePage("about", "new-about")).toThrow(message);
    expect(() => store.duplicatePage("about")).toThrow(message);
    expect(() => store.createTranslation("about", "en", "es")).toThrow(message);
    expect(() => store.deletePage("about")).toThrow(message);
    expect(() => store.deleteTranslation("about", "en")).toThrow(message);
  });
});
