import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { scanContentStore, loadRedirectMap, mergeRedirectEntries, toRedirectPairs } from "./redirect-sources";
import type { RedirectEntry } from "./redirects";

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

  it("refuses javascript front-matter instead of eval()ing it", () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    // gray-matter's default `javascript` engine would eval() this block inside
    // the process scanning the content directory; the scan must throw, not
    // execute.
    writeFileSync(path.join(dir, "evil.md"), "---javascript\n({ slices: [] })\n---\nbody");

    expect(() => scanContentStore(dir as string)).toThrow(/javascript front-matter is not supported/);
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

describe("loadRedirectMap", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-map-"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, contents: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    return file;
  };

  it("loads a JSON map, normalizing trailing slashes on both sides", async () => {
    const file = write(
      "map.json",
      JSON.stringify([
        { from: "/old-page/", to: "/new-page/" },
        { from: "/press", to: "https://example.com/press-release" },
      ])
    );
    expect(await loadRedirectMap(dir, file)).toEqual([
      { from: "/old-page", to: "/new-page", slug: "map:map.json" },
      { from: "/press", to: "https://example.com/press-release", slug: "map:map.json" },
    ]);
  });

  // The .mjs cases import committed fixtures rather than tmpdir-generated
  // files: vitest's runner rewrites dynamic imports and refuses file URLs
  // outside the project root, while in production this runs under plain
  // Node where any absolute path imports fine.
  it("loads an .mjs module via its default export", async () => {
    const file = path.join(import.meta.dirname, "__fixtures__", "map-default.mjs");
    expect(await loadRedirectMap(dir, file)).toEqual([{ from: "/a", to: "/b", slug: "map:map-default.mjs" }]);
  });

  it("falls back to a named REDIRECTS export", async () => {
    const file = path.join(import.meta.dirname, "__fixtures__", "map-named.mjs");
    expect(await loadRedirectMap(dir, file)).toHaveLength(1);
  });

  it("rejects a relative or missing 'from'", async () => {
    const file = write("bad-from.json", JSON.stringify([{ from: "old", to: "/new" }]));
    await expect(loadRedirectMap(dir, file)).rejects.toThrow(/'from' must be an absolute on-site path/);
  });

  it("rejects a 'to' that is neither an absolute path nor an http(s) URL", async () => {
    const file = write("bad-to.json", JSON.stringify([{ from: "/old", to: "ftp://example.com" }]));
    await expect(loadRedirectMap(dir, file)).rejects.toThrow(/'to' must be an absolute path or http\(s\) URL/);
  });

  it("rejects protocol-relative, backslash and control-char targets", async () => {
    for (const to of ["//evil.example", "/x\\evil", "/x\r\ninjected", "https://e.com/a b"]) {
      const file = write("unsafe.json", JSON.stringify([{ from: "/old", to }]));
      await expect(loadRedirectMap(dir, file)).rejects.toThrow(/'to' must|protocol-relative/);
    }
  });

  it("rejects a self-redirect, which would 301-loop at the edge", async () => {
    const file = write("loop.json", JSON.stringify([{ from: "/x", to: "/x/" }]));
    await expect(loadRedirectMap(dir, file)).rejects.toThrow(/redirects to itself/);
  });

  it("rejects a duplicate 'from' after normalization", async () => {
    const file = write(
      "dupe.json",
      JSON.stringify([
        { from: "/x", to: "/a" },
        { from: "/x/", to: "/b" },
      ])
    );
    await expect(loadRedirectMap(dir, file)).rejects.toThrow(/declares \/x twice/);
  });

  it("rejects a missing file and an unsupported extension", async () => {
    await expect(loadRedirectMap(dir, path.join(dir, "nope.json"))).rejects.toThrow(/map file not found/);
    const file = write("map.yaml", "from: /a");
    await expect(loadRedirectMap(dir, file)).rejects.toThrow(/unsupported map format/);
  });
});

describe("mergeRedirectEntries", () => {
  const content: RedirectEntry[] = [{ from: "/old-about", to: "/about", slug: "about" }];

  it("concatenates disjoint sources", () => {
    const map: RedirectEntry[] = [{ from: "/legacy", to: "/about", slug: "map:m.json" }];
    expect(mergeRedirectEntries(content, map)).toHaveLength(2);
  });

  it("refuses a 'from' claimed by both sources, naming them", () => {
    const map: RedirectEntry[] = [{ from: "/old-about", to: "/elsewhere", slug: "map:m.json" }];
    expect(() => mergeRedirectEntries(content, map)).toThrow(/"about" \(frontmatter\) and "map:m\.json"/);
  });

  it("refuses a map entry that shadows a live page's canonical path", () => {
    const map: RedirectEntry[] = [{ from: "/pricing", to: "/plans", slug: "map:m.json" }];
    expect(() => mergeRedirectEntries(content, map, ["/pricing", "/about"])).toThrow(/live page's own path/);
    expect(mergeRedirectEntries(content, map, ["/about"])).toHaveLength(2);
  });
});

describe("toRedirectPairs", () => {
  it("maps from/to into key/value pairs, emitting the canonical trailing-slash target", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "new" }];
    expect(toRedirectPairs(entries)).toEqual([{ key: "/old", value: "/new/" }]);
  });

  it("emits the site root as a bare '/'", () => {
    const entries: RedirectEntry[] = [{ from: "/old-home", to: "/", slug: "home" }];
    expect(toRedirectPairs(entries)).toEqual([{ key: "/old-home", value: "/" }]);
  });

  it("passes external URL targets through verbatim, no slash appended", () => {
    const entries: RedirectEntry[] = [{ from: "/press", to: "https://example.com/story", slug: "map:m.json" }];
    expect(toRedirectPairs(entries)).toEqual([{ key: "/press", value: "https://example.com/story" }]);
  });

  it("carries a query or fragment through the slash canonicalization intact", () => {
    const entries: RedirectEntry[] = [
      { from: "/old", to: "/new?utm=1", slug: "map:m.json" },
      { from: "/old2", to: "/new/?keep=1", slug: "map:m.json" },
      { from: "/old3", to: "/new#section", slug: "map:m.json" },
    ];
    expect(toRedirectPairs(entries).map((e) => e.value)).toEqual(["/new/?utm=1", "/new/?keep=1", "/new/#section"]);
  });

  it("appendSlash: false emits on-site targets verbatim (bare-URL-canonical sites)", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "map:m.json" }];
    expect(toRedirectPairs(entries, { appendSlash: false })).toEqual([{ key: "/old", value: "/new" }]);
  });

  it("stores the key percent-encoded, the form an edge sees a request path in", () => {
    const entries: RedirectEntry[] = [{ from: "/café page", to: "/new", slug: "map:m.json" }];
    expect(toRedirectPairs(entries)[0].key).toBe("/caf%C3%A9%20page");
  });

  it("leaves on-site file targets and already-slashed targets untouched", () => {
    const entries: RedirectEntry[] = [
      { from: "/old-report", to: "/docs/report.pdf", slug: "map:m.json" },
      { from: "/old-hub", to: "/hub/", slug: "map:m.json" },
    ];
    expect(toRedirectPairs(entries)).toEqual([
      { key: "/old-report", value: "/docs/report.pdf" },
      { key: "/old-hub", value: "/hub/" },
    ]);
  });
});
