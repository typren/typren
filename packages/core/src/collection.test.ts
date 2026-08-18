import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeCollectionActions, buildCollectionActions, listCollectionRecords } from "./collection";
import type { CmsConfig } from "./types";
import type { CollectionSection, Section } from "./sections";

let dir: string;
let pagesContentDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-collection-"));
  pagesContentDir = path.join(dir, "content");
  fs.mkdirSync(pagesContentDir, { recursive: true });
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function makeConfig(sections: Section[] = []): CmsConfig {
  return {
    registry: {},
    defaults: {},
    adapter: createMarkdownAdapter({ contentDir: pagesContentDir }),
    previewPath: "/editor/preview",
    auth: { authorize: async () => true },
    sections,
  };
}

const authorsSection: CollectionSection = {
  kind: "collection",
  id: "authors",
  label: "Authors",
  dir: path.join("__placeholder__"), // overwritten per-test with an absolute tmp path
  schema: { name: { type: "text" }, role: { type: "text" } },
};

describe("dir-overlap guard", () => {
  it("throws when the collection dir equals the Pages content dir", () => {
    const config = makeConfig();
    const section = { ...authorsSection, dir: pagesContentDir };
    expect(() => makeCollectionActions(config, section)).toThrow(/overlaps the Pages content dir/);
  });

  it("throws when the collection dir is nested inside the Pages content dir", () => {
    const config = makeConfig();
    const section = { ...authorsSection, dir: path.join(pagesContentDir, "authors") };
    expect(() => makeCollectionActions(config, section)).toThrow(/overlaps the Pages content dir/);
  });

  it("throws when the Pages content dir is nested inside the collection dir", () => {
    const config = makeConfig();
    const section = { ...authorsSection, dir: dir }; // parent of pagesContentDir
    expect(() => makeCollectionActions(config, section)).toThrow(/overlaps the Pages content dir/);
  });

  it("allows a sibling dir", () => {
    const config = makeConfig();
    const section = { ...authorsSection, dir: path.join(dir, "authors") };
    expect(() => makeCollectionActions(config, section)).not.toThrow();
  });
});

describe("makeCollectionActions round-trip", () => {
  it("creates, saves, publishes and lists a record without leaking into Pages listSlugs", async () => {
    const authorsDir = path.join(dir, "authors");
    const config = makeConfig();
    const section = { ...authorsSection, dir: authorsDir };
    const actions = makeCollectionActions(config, section);

    const slug = await actions.createPage("Gabriel Lam");
    expect(slug).toBe("gabriel-lam");

    const saveResult = await actions.saveDraft(slug, { meta: { name: "Gabriel Lam", role: "Editor" }, slices: [], body: "" });
    expect(saveResult.ok).toBe(true);
    await actions.publish(slug);

    const collectionAdapter = createMarkdownAdapter({ contentDir: authorsDir });
    expect(collectionAdapter.listSlugs()).toEqual(["gabriel-lam"]);
    expect(config.adapter.listSlugs()).toEqual([]); // Pages dir never sees the record
  });
});

describe("buildCollectionActions", () => {
  it("builds one PageActions per declared collection section, keyed by id", () => {
    const authorsDir = path.join(dir, "authors");
    const config = makeConfig([
      { kind: "pages", label: "Pages" },
      { ...authorsSection, dir: authorsDir },
    ]);
    const built = buildCollectionActions(config);
    expect(Object.keys(built)).toEqual(["authors"]);
  });
});

describe("listCollectionRecords", () => {
  it("returns slug/meta/body/hasDraft for every published record", async () => {
    const authorsDir = path.join(dir, "authors");
    const config = makeConfig();
    const section = { ...authorsSection, dir: authorsDir };
    const actions = makeCollectionActions(config, section);

    const slug = await actions.createPage("Gabriel Lam");
    await actions.saveDraft(slug, {
      meta: { name: "Gabriel Lam", role: "Editor" },
      slices: [],
      body: "Gabriel writes about markdown editors.",
    });
    await actions.publish(slug);

    const second = await actions.createPage("Ada Lovelace");
    // Draft only, never published: the row still reflects the last PUBLISHED
    // content (same draft/published split store.listPages already makes).
    // hasDraft is the separate signal that unpublished work is pending.
    await actions.saveDraft(second, { meta: { name: "Ada Lovelace" }, slices: [], body: "Draft bio." });

    const records = listCollectionRecords(config, section);
    expect(records).toEqual([
      { slug: "ada-lovelace", meta: { title: "Ada Lovelace" }, body: "\n", hasDraft: true, locale: undefined },
      {
        slug: "gabriel-lam",
        meta: { name: "Gabriel Lam", role: "Editor" },
        body: "Gabriel writes about markdown editors.\n",
        hasDraft: false,
        locale: undefined,
      },
    ]);
  });

  // Records authored outside the CMS, an existing content directory adopted
  // by a collection, carry no `slices:` key at all. The Pages listSlugs filter
  // treats "carries a slice array" as "is a page", which would hide every one
  // of them and report the collection as empty.
  it("lists hand-authored records that carry no slices key", () => {
    const authorsDir = path.join(dir, "authors");
    fs.mkdirSync(authorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(authorsDir, "ada-lovelace.md"),
      '---\nname: "Ada Lovelace"\nrole: "Mathematician"\n---\n\nWrote the first algorithm.\n'
    );

    const config = makeConfig();
    const section = { ...authorsSection, dir: authorsDir };

    expect(listCollectionRecords(config, section)).toEqual([
      {
        slug: "ada-lovelace",
        meta: { name: "Ada Lovelace", role: "Mathematician" },
        body: "\nWrote the first algorithm.\n",
        hasDraft: false,
        locale: undefined,
      },
    ]);
  });

  it("returns an empty list for a collection with no records yet", () => {
    const config = makeConfig();
    const section = { ...authorsSection, dir: path.join(dir, "authors") };
    expect(listCollectionRecords(config, section)).toEqual([]);
  });
});
