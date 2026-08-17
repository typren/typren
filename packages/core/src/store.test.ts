import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createStore } from "./store";
import { ConflictError } from "./version";

let dir: string;
let contentDir: string;
let draftDir: string;

const seed = `---
title: Home
slices:
  - slice: hero
    heading: Original
---
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-"));
  contentDir = path.join(dir, "content");
  draftDir = path.join(contentDir, ".drafts");
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, "home.md"), seed);
  // A non-sliced file must be ignored by listSlugs.
  fs.writeFileSync(path.join(contentDir, "site.md"), "---\nnav: []\n---\n");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const makeStore = () => {
  let published = 0;
  const store = createStore(createMarkdownAdapter({ contentDir, draftDir }), {
    onPublish: () => {
      published++;
    },
  });
  return { store, publishedCount: () => published };
};

describe("typren LocalStore round-trip", () => {
  it("lists only sliced pages", () => {
    const { store } = makeStore();
    expect(store.listPages()).toEqual([{ slug: "home", title: "Home", hasDraft: false, locales: ["en"] }]);
  });

  it("reads published slices", () => {
    const { store } = makeStore();
    expect(store.getPublished("home").slices[0]).toMatchObject({ slice: "hero", heading: "Original" });
    expect(store.getDraft("home")).toBeNull();
  });

  it("saves and reads back a draft without touching published", () => {
    const { store } = makeStore();
    const page = store.getPublished("home");
    page.slices[0].heading = "Edited";
    store.saveDraft("home", page);

    expect(store.getDraft("home")!.slices[0].heading).toBe("Edited");
    expect(store.getPublished("home").slices[0].heading).toBe("Original"); // untouched
    expect(store.listPages()[0].hasDraft).toBe(true);
  });

  it("publish promotes the draft, clears it, and runs onPublish", async () => {
    const { store, publishedCount } = makeStore();
    const page = store.getPublished("home");
    page.slices.push({ slice: "ctaBand", heading: "New" });
    store.saveDraft("home", page);

    await store.publish("home");

    expect(store.getPublished("home").slices).toHaveLength(2);
    expect(store.getDraft("home")).toBeNull();
    expect(publishedCount()).toBe(1);
    // the on-disk file really changed
    expect(fs.readFileSync(path.join(contentDir, "home.md"), "utf8")).toContain("ctaBand");
  });

  it("publish is a no-op when there is no draft", async () => {
    const { store, publishedCount } = makeStore();
    await store.publish("home");
    expect(publishedCount()).toBe(0);
    expect(store.getPublished("home").slices).toHaveLength(1);
  });

  it("createPage writes a new page and refuses to clobber an existing one", () => {
    const { store } = makeStore();
    store.createPage("about", { meta: { title: "About" }, slices: [], body: "" });
    expect(store.getPublished("about").meta.title).toBe("About");
    expect(() => store.createPage("about", { meta: {}, slices: [], body: "" })).toThrow();
  });

  it("deletePage removes the published file and any draft", () => {
    const { store } = makeStore();
    store.saveDraft("home", store.getPublished("home"));
    store.deletePage("home");
    expect(store.listPages()).toHaveLength(0);
    expect(store.getDraft("home")).toBeNull();
  });

  it("discardDraft removes the draft, published unchanged", () => {
    const { store } = makeStore();
    const page = store.getPublished("home");
    page.slices[0].heading = "Edited";
    store.saveDraft("home", page);
    store.discardDraft("home");
    expect(store.getDraft("home")).toBeNull();
    expect(store.getPublished("home").slices[0].heading).toBe("Original");
  });
});

describe("typren optimistic locking", () => {
  it("rejects a stale save and leaves the draft untouched", () => {
    const { store } = makeStore();
    const base = store.currentVersion("home")!;
    const a = store.getPublished("home");
    a.slices[0].heading = "A wins";
    const v1 = store.saveDraft("home", a, base); // A writes on top of base
    expect(v1).not.toBe(base);

    const b = store.getPublished("home");
    b.slices[0].heading = "B loses";
    expect(() => store.saveDraft("home", b, base)).toThrow(ConflictError); // B is stale
    // on-disk draft is still A's write, and the version has not moved
    expect(store.getDraft("home")!.slices[0].heading).toBe("A wins");
    expect(store.currentVersion("home")).toBe(v1);
  });

  it("accepts a save at the current version and returns the new version", () => {
    const { store } = makeStore();
    const base = store.currentVersion("home")!;
    const page = store.getPublished("home");
    page.slices[0].heading = "Edited";
    const v1 = store.saveDraft("home", page, base);
    expect(v1).toBe(store.currentVersion("home"));
    expect(store.getDraft("home")!.slices[0].heading).toBe("Edited");
  });

  it("chains sequential saves via returned versions without a false conflict", () => {
    const { store } = makeStore();
    let v = store.currentVersion("home")!;
    const page = store.getPublished("home");
    page.slices[0].heading = "First";
    v = store.saveDraft("home", page, v);
    page.slices[0].heading = "Second";
    v = store.saveDraft("home", page, v); // uses the version the previous save returned
    expect(store.getDraft("home")!.slices[0].heading).toBe("Second");
    expect(store.currentVersion("home")).toBe(v);
  });

  it("rejects a stale publish and leaves the published file untouched", async () => {
    const { store } = makeStore();
    const base = store.currentVersion("home")!; // version before any draft
    const page = store.getPublished("home");
    page.slices[0].heading = "Draft edit";
    store.saveDraft("home", page); // draft now differs from `base`
    await expect(store.publish("home", base)).rejects.toThrow(ConflictError);
    expect(store.getPublished("home").slices[0].heading).toBe("Original");
  });
});
