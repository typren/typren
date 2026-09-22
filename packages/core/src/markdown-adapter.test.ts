import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  it("skips files whose names aren't valid slugs instead of throwing", () => {
    fs.writeFileSync(path.join(dir, "about.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "site_backup.md"), "---\nslices: []\n---\n");
    fs.writeFileSync(path.join(dir, "About Us.md"), "---\nslices: []\n---\n");

    const withSlices = createMarkdownAdapter({ contentDir: dir });
    expect(withSlices.listSlugs()).toEqual(["about"]);

    // The collection mode (requireSliceArray: false) reads every .md as a
    // record, so it hits the same guard on a different path.
    const collection = createMarkdownAdapter({ contentDir: dir, requireSliceArray: false });
    expect(collection.listSlugs()).toEqual(["about"]);
  });
});
