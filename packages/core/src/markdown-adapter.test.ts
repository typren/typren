import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createMarkdownAdapter } from "./markdown-adapter";

// parse/serialize are pure string transforms (no fs touched), so a throwaway
// contentDir (never read) is enough to construct the adapter.
const adapter = createMarkdownAdapter({ contentDir: "/unused" });

describe("markdown-adapter parse/serialize", () => {
  // Every other fixture in this repo pre-writes `slices: []`, so this gap
  // (a file with real frontmatter + a real body but no slices key at all)
  // has never been exercised. `parse` must still default slices to [] rather
  // than throw or drop the rest of the frontmatter/body.
  it("round-trips a file that has frontmatter + a body and no slices key", () => {
    const raw = "---\ntitle: Ada Lovelace\nrole: Mathematician\n---\nAda wrote the first published algorithm.\n";

    const parsed = adapter.parse(raw);
    expect(parsed).toEqual({
      meta: { title: "Ada Lovelace", role: "Mathematician" },
      slices: [],
      body: "Ada wrote the first published algorithm.\n",
    });

    const serialized = adapter.serialize(parsed);
    expect(adapter.parse(serialized)).toEqual(parsed);
  });

  // Regression: the editor's duplicate() shallow-copies a slice (`{...slice}`),
  // so a duplicated page can carry two slices pointing at the very same nested
  // object. Before noRefs, gray-matter dumped that as a YAML anchor/alias pair,
  // which parse() (via parseMatter) refuses, making the duplicated page, and
  // every site listing/build that parses it, permanently unreadable.
  it("round-trips a page whose slices share a nested object reference (the Duplicate path)", () => {
    const cta = { label: "Buy now", href: "/buy" };
    const page = { meta: {}, slices: [{ slice: "hero", cta }, { slice: "hero", cta }], body: "" };

    const serialized = adapter.serialize(page);
    // gray-matter's dump adds a trailing newline to an empty body; trimmed
    // comparison keeps this test about the slices surviving, not whitespace.
    expect({ ...adapter.parse(serialized), body: adapter.parse(serialized).body.trim() }).toEqual(page);
  });

  it("refuses to serialize front matter over the parser's size cap, so nothing is ever written", () => {
    const page = { meta: { title: "x".repeat(256 * 1024) }, slices: [], body: "" };
    expect(() => adapter.serialize(page)).toThrow(/front matter exceeds 256 KB/);
  });
});

describe("markdown-adapter listSlugs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A shared content dir can hold non-page files whose names aren't valid
  // slugs. They're unreachable through the slug guard, so the listing must
  // skip them, not throw "unsafe slug" and take the whole page list down.
  it("skips files whose names aren't valid slugs instead of throwing", async () => {
    fs.writeFileSync(path.join(dir, "about.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "site_backup.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "About Us.md"), "---\nslices: []\n---\n");

    const withSlices = createMarkdownAdapter({ contentDir: dir });
    expect(await withSlices.listSlugs()).toEqual(["about"]);

    // The collection mode (requireSliceArray: false) reads every .md as a
    // record, so it hits the same guard on a different path.
    const collection = createMarkdownAdapter({ contentDir: dir, requireSliceArray: false });
    expect(await collection.listSlugs()).toEqual(["about"]);
  });
});

describe("markdown-adapter locale validation", () => {
  // Regression: `locales` (and `defaultLocale`) become path segments
  // (localeDir/localeSubdir), so an unsafe entry in the allowlist ITSELF --
  // not just an unlisted locale passed at call time -- must be rejected at
  // construction, before any read/write can turn it into a traversal.
  it("rejects a path-traversal locale in the locales array", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["en", "../../etc"] })).toThrow(
      /unsafe locale/
    );
  });

  it("rejects a path-traversal defaultLocale", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", defaultLocale: "../escape" })).toThrow(
      /unsafe locale/
    );
  });

  it("rejects an absolute-path locale", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["/etc/passwd"] })).toThrow(/unsafe locale/);
  });

  it("accepts ordinary BCP-47-ish locales, including region subtags", () => {
    expect(() => createMarkdownAdapter({ contentDir: "/unused", locales: ["en", "en-US", "pt-BR"] })).not.toThrow();
  });
});

describe("markdown-adapter contract", () => {
  let contractDir: string;
  beforeEach(() => {
    contractDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-md-contract-"));
  });
  afterEach(() => fs.rmSync(contractDir, { recursive: true, force: true }));

  createContentAdapterContractSuite(() => createMarkdownAdapter({ contentDir: contractDir }));
});
