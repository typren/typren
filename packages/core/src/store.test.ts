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
  it("lists only sliced pages", async () => {
    const { store } = makeStore();
    expect(await store.listPages()).toEqual([{ slug: "home", title: "Home", hasDraft: false, locales: ["en"] }]);
  });

  it("reads published slices", async () => {
    const { store } = makeStore();
    expect((await store.getPublished("home")).slices[0]).toMatchObject({ slice: "hero", heading: "Original" });
    expect(await store.getDraft("home")).toBeNull();
  });

  it("saves and reads back a draft without touching published", async () => {
    const { store } = makeStore();
    const page = await store.getPublished("home");
    page.slices[0].heading = "Edited";
    await store.saveDraft("home", page);

    expect((await store.getDraft("home"))!.slices[0].heading).toBe("Edited");
    expect((await store.getPublished("home")).slices[0].heading).toBe("Original"); // untouched
    expect((await store.listPages())[0].hasDraft).toBe(true);
  });

  it("publish promotes the draft, clears it, and runs onPublish", async () => {
    const { store, publishedCount } = makeStore();
    const page = await store.getPublished("home");
    page.slices.push({ slice: "ctaBand", heading: "New" });
    await store.saveDraft("home", page);

    await store.publish("home");

    expect((await store.getPublished("home")).slices).toHaveLength(2);
    expect(await store.getDraft("home")).toBeNull();
    expect(publishedCount()).toBe(1);
    // the on-disk file really changed
    expect(fs.readFileSync(path.join(contentDir, "home.md"), "utf8")).toContain("ctaBand");
  });

  it("publish is a no-op when there is no draft", async () => {
    const { store, publishedCount } = makeStore();
    await store.publish("home");
    expect(publishedCount()).toBe(0);
    expect((await store.getPublished("home")).slices).toHaveLength(1);
  });

  it("createPage writes a new page and refuses to clobber an existing one", async () => {
    const { store } = makeStore();
    await store.createPage("about", { meta: { title: "About" }, slices: [], body: "" });
    expect((await store.getPublished("about")).meta.title).toBe("About");
    await expect(store.createPage("about", { meta: {}, slices: [], body: "" })).rejects.toThrow();
  });

  it("deletePage removes the published file and any draft", async () => {
    const { store } = makeStore();
    await store.saveDraft("home", await store.getPublished("home"));
    await store.deletePage("home");
    expect(await store.listPages()).toHaveLength(0);
    expect(await store.getDraft("home")).toBeNull();
  });

  it("discardDraft removes the draft, published unchanged", async () => {
    const { store } = makeStore();
    const page = await store.getPublished("home");
    page.slices[0].heading = "Edited";
    await store.saveDraft("home", page);
    await store.discardDraft("home");
    expect(await store.getDraft("home")).toBeNull();
    expect((await store.getPublished("home")).slices[0].heading).toBe("Original");
  });
});

describe("typren optimistic locking", () => {
  it("rejects a stale save and leaves the draft untouched", async () => {
    const { store } = makeStore();
    const base = (await store.currentVersion("home"))!;
    const a = await store.getPublished("home");
    a.slices[0].heading = "A wins";
    const v1 = await store.saveDraft("home", a, base); // A writes on top of base
    expect(v1).not.toBe(base);

    const b = await store.getPublished("home");
    b.slices[0].heading = "B loses";
    await expect(store.saveDraft("home", b, base)).rejects.toThrow(ConflictError); // B is stale
    // on-disk draft is still A's write, and the version has not moved
    expect((await store.getDraft("home"))!.slices[0].heading).toBe("A wins");
    expect(await store.currentVersion("home")).toBe(v1);
  });

  it("accepts a save at the current version and returns the new version", async () => {
    const { store } = makeStore();
    const base = (await store.currentVersion("home"))!;
    const page = await store.getPublished("home");
    page.slices[0].heading = "Edited";
    const v1 = await store.saveDraft("home", page, base);
    expect(v1).toBe(await store.currentVersion("home"));
    expect((await store.getDraft("home"))!.slices[0].heading).toBe("Edited");
  });

  it("chains sequential saves via returned versions without a false conflict", async () => {
    const { store } = makeStore();
    let v = (await store.currentVersion("home"))!;
    const page = await store.getPublished("home");
    page.slices[0].heading = "First";
    v = await store.saveDraft("home", page, v);
    page.slices[0].heading = "Second";
    v = await store.saveDraft("home", page, v); // uses the version the previous save returned
    expect((await store.getDraft("home"))!.slices[0].heading).toBe("Second");
    expect(await store.currentVersion("home")).toBe(v);
  });

  it("rejects a stale publish and leaves the published file untouched", async () => {
    const { store } = makeStore();
    const base = (await store.currentVersion("home"))!; // version before any draft
    const page = await store.getPublished("home");
    page.slices[0].heading = "Draft edit";
    await store.saveDraft("home", page); // draft now differs from `base`
    await expect(store.publish("home", base)).rejects.toThrow(ConflictError);
    expect((await store.getPublished("home")).slices[0].heading).toBe("Original");
  });
});

// The dash-trim used to be `/^-+|-+$/g`, which CodeQL flags as polynomial
// backtracking on adversarial input. After the `[^a-z0-9]+` collapse a slug
// can never hold consecutive dashes, so single-dash anchors are equivalent;
// these pin the equivalence and that hostile input stays linear.
describe("slugify dash trimming", () => {
  it("trims a leading and trailing dash left by the collapse", async () => {
    const { slugify } = await import("./store");
    expect(slugify("!!!Hello World!!!")).toBe("hello-world");
    expect(slugify("---")).toBe("");
    expect(slugify("  ")).toBe("");
  });

  it("stays linear on adversarial input", async () => {
    const { slugify } = await import("./store");
    const hostile = "!".repeat(100_000) + "a" + "!".repeat(100_000);
    expect(slugify(hostile)).toBe("a");
  });
});
