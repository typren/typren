import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import { parseMatter, stringifyMatter } from "./safe-matter";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createGithubAdapter } from "./github-adapter";

const sentinel = "__typrenFrontMatterRan";
const payload = (lang: string) => `---${lang}\n{ x: (globalThis.${sentinel} = true) }\n---\nbody\n`;

describe("parseMatter", () => {
  for (const lang of ["js", "javascript"]) {
    it(`refuses ---${lang} front matter without evaluating it`, () => {
      delete (globalThis as Record<string, unknown>)[sentinel];
      expect(() => parseMatter(payload(lang))).toThrow(/JavaScript front matter is not allowed/);
      expect((globalThis as Record<string, unknown>)[sentinel]).toBeUndefined();
    });
  }

  it("still parses YAML front matter", () => {
    expect(parseMatter("---\ntitle: Hi\n---\nbody\n").data).toEqual({ title: "Hi" });
  });

  it("keeps gray-matter's YAML semantics: timestamps as Date, merge keys, yes as a string", () => {
    const { data } = parseMatter("---\nd: 2024-01-02\nb: yes\nm:\n  <<: {a: 1}\n---\n");
    expect(data).toEqual({ d: new Date("2024-01-02T00:00:00Z"), b: "yes", m: { a: 1 } });
  });

  it("refuses YAML aliases, so a billion-laughs block fails fast instead of expanding", () => {
    const levels = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i < 10; i++) {
      const prev = String.fromCharCode(96 + i);
      const cur = String.fromCharCode(97 + i);
      levels.push(`${cur}: &${cur} [${Array(9).fill(`*${prev}`).join(", ")}]`);
    }
    const started = performance.now();
    expect(() => parseMatter(`---\n${levels.join("\n")}\n---\n`)).toThrow();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("refuses front matter over 256 KB", () => {
    expect(() => parseMatter(`---\nt: "${"x".repeat(256 * 1024)}"\n---\n`)).toThrow(/front matter exceeds 256 KB/);
  });

  it("markdown and github adapters refuse JavaScript front matter in parse()", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-safe-matter-"));
    const adapters = [
      createMarkdownAdapter({ contentDir: dir }),
      createGithubAdapter({ owner: "o", repo: "r", token: "t", fetchImpl: (async () => new Response(null)) as typeof fetch }),
    ];
    for (const adapter of adapters) {
      delete (globalThis as Record<string, unknown>)[sentinel];
      expect(() => adapter.parse(payload("js"))).toThrow(/JavaScript front matter is not allowed/);
      expect((globalThis as Record<string, unknown>)[sentinel]).toBeUndefined();
    }
  });
});

describe("stringifyMatter", () => {
  it("round-trips a shared object reference instead of emitting a YAML alias parseMatter refuses", () => {
    // What a shallow-copy "duplicate" (e.g. `{...slice}`) produces: two array
    // entries pointing at the very same nested object. gray-matter's default
    // dump would alias the second occurrence; parseMatter refuses aliases.
    const cta = { label: "Buy now", href: "/buy" };
    const data = { slices: [{ slice: "hero", cta }, { slice: "hero", cta }] };

    // Baseline: without noRefs, this is exactly the file that corrupts a page.
    const unsafeRaw = matter.stringify("", data);
    expect(() => parseMatter(unsafeRaw)).toThrow(/alias/i);

    const raw = stringifyMatter("", data);
    const { data: roundTripped } = parseMatter(raw);
    expect(roundTripped).toEqual(data);
  });

  it("refuses front matter over the parser's size cap, before any caller can write it", () => {
    const data = { title: "x".repeat(256 * 1024) };
    expect(() => stringifyMatter("", data)).toThrow(/front matter exceeds 256 KB/);
  });

  // Regression: noRefs expanded a tiny DAG of shared references exponentially
  // before the byte cap ran, so a ~1 KB saveDraft payload exhausted memory.
  it("refuses an exponentially shared DAG fast instead of expanding it", () => {
    let node: object = { v: "x" };
    for (let i = 0; i < 25; i++) node = { l: node, r: node };
    const adapter = createMarkdownAdapter({ contentDir: fs.mkdtempSync(path.join(os.tmpdir(), "typren-safe-matter-")) });
    const start = Date.now();
    expect(() => stringifyMatter("", { slices: [{ slice: "hero", p: node }] })).toThrow(/front matter too large/);
    expect(() => adapter.serialize({ meta: {}, slices: [{ slice: "hero", p: node } as never], body: "" })).toThrow(
      /front matter too large/
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("refuses a circular reference instead of recursing forever", () => {
    const loop: Record<string, unknown> = { v: "x" };
    loop.self = loop;
    expect(() => stringifyMatter("", { loop })).toThrow(/circular reference/);
  });
});
