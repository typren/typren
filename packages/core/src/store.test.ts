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

  it("lists nav/navOrder/system from front matter on a site doc without a menu, dropping wrongly typed values", async () => {
    fs.writeFileSync(path.join(contentDir, "site.md"), "---\ntitle: Site settings\n---\n");
    fs.writeFileSync(
      path.join(contentDir, "about.md"),
      "---\ntitle: About\nnav: true\nnavOrder: 2\nsystem: false\nslices: []\n---\n"
    );
    fs.writeFileSync(
      path.join(contentDir, "odd.md"),
      "---\ntitle: Odd\nnav: yes please\nnavOrder: first\nsystem: 1\nslices: []\n---\n"
    );
    const { store } = makeStore();
    const pages = await store.listPages();
    expect(pages.find((p) => p.slug === "about")).toEqual({
      slug: "about",
      title: "About",
      hasDraft: false,
      locales: ["en"],
      nav: true,
      navOrder: 2,
      system: false,
    });
    const odd = pages.find((p) => p.slug === "odd")!;
    expect(["nav", "navOrder", "system"].filter((k) => k in odd)).toEqual([]);
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

  it("createPage with draft writes a draft-only page that lists unpublished until its first publish", async () => {
    const { store } = makeStore();
    await store.createPage("event/1", { meta: { title: "Day one", noindex: true }, slices: [], body: "" }, undefined, {
      draft: true,
    });
    expect(await store.exists("event/1")).toBe(false);
    expect((await store.listPages()).find((p) => p.slug === "event/1")).toEqual({
      slug: "event/1",
      title: "Day one",
      hasDraft: true,
      locales: [],
      noindex: true,
      published: false,
    });
    // A draft holds the slug: neither kind of create may clobber it.
    await expect(store.createPage("event/1", { meta: {}, slices: [], body: "" })).rejects.toThrow(/already exists/);
    await store.publish("event/1");
    expect((await store.listPages()).find((p) => p.slug === "event/1")).toEqual({
      slug: "event/1",
      title: "Day one",
      hasDraft: false,
      locales: ["en"],
      noindex: true,
    });
  });

  it("reads nav and its order from the site doc's header links, over page front matter", async () => {
    for (const slug of ["about", "banks", "contact", "hidden"])
      fs.writeFileSync(path.join(contentDir, `${slug}.md`), `---\ntitle: ${slug}\nslices: []\n---\n`);
    fs.writeFileSync(
      path.join(contentDir, "hidden.md"),
      "---\ntitle: hidden\nnav: false\nslices: []\n---\n"
    );
    fs.writeFileSync(
      path.join(contentDir, "site.md"),
      [
        "---",
        "nav:",
        "  - { label: Home, href: / }",
        "  - label: Products",
        '    href: "#"',
        "    children:",
        "      - { label: Banks, href: /banks/ }",
        "      - { label: Elsewhere, href: https://example.com/x, external: true }",
        "      - { label: Protocol relative, href: //example.com }",
        "  - { label: About, href: /about?ref=nav }",
        "  - { label: Hidden, href: /hidden }",
        "  - not an item",
        "cta: { label: Contact, href: /contact }",
        "---",
        "",
      ].join("\n")
    );
    const { store } = makeStore();
    const nav = Object.fromEntries((await store.listPages()).map((p) => [p.slug, [p.nav, p.navOrder]]));
    expect(nav).toEqual({
      about: [true, 1],
      banks: [true, 0],
      contact: [true, 3],
      hidden: [true, 2],
      home: [undefined, undefined],
    });
  });

  it("never lists the site doc as a page, even once it carries a slice array", async () => {
    const { store } = makeStore();
    await store.saveDraft("site", { meta: { nav: [] }, slices: [], body: "" });
    expect((await store.listPages()).map((p) => p.slug)).toEqual(["home"]);
    await store.publish("site");
    expect((await store.listPages()).map((p) => p.slug)).toEqual(["home"]);
    expect(await store.listSlugs()).toEqual(["home"]);
  });

  it("refuses a site doc draft with an unsafe navigation link", async () => {
    const { store } = makeStore();
    const page = { meta: { nav: [{ label: "x", href: "javascript:alert(1)" }] }, slices: [], body: "" };
    await expect(store.saveDraft("site", page)).rejects.toThrow(/refused/);
    expect(await store.getDraft("site")).toBeNull();
    // Only the site doc carries the menu; a page's own `nav` is not checked.
    await expect(store.saveDraft("home", page)).resolves.toBeTypeOf("string");
  });

  it("treats a site doc of the wrong shape as no navigation", async () => {
    fs.writeFileSync(path.join(contentDir, "site.md"), "---\nnav: { href: /home }\ncta: 3\n---\n");
    const { store } = makeStore();
    expect((await store.listPages())[0].nav).toBeUndefined();
  });

  it("lists a published page with a pending draft once, as published", async () => {
    const { store } = makeStore();
    await store.saveDraft("home", await store.getPublished("home"));
    expect(await store.listPages()).toEqual([{ slug: "home", title: "Home", hasDraft: true, locales: ["en"] }]);
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
