import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRedirectMap, mergeRedirectEntries } from "./map-source";
import type { RedirectEntry } from "@typren/core";

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

describe("loadRedirectMap", () => {
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
  // outside the project root, while in production the CLI runs under plain
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
});
