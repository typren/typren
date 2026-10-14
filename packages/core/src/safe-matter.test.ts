import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMatter } from "./safe-matter";
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
