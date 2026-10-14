import { describe, expect, it } from "vitest";

/**
 * Minimal shape this suite needs from a `ContentAdapter` (packages/core/src/
 * types.ts), restated here rather than imported so this package stays
 * dependency-free of `@typren/core` (core itself is the FIRST consumer of
 * this suite, see core's package.json devDependency on `@typren/contract-tests`,
 * and a cycle the other way would be awkward). Any real `ContentAdapter`
 * satisfies this structurally.
 */
export interface ContentAdapterLike {
  readonly locales: string[];
  readonly defaultLocale: string;
  listSlugs(locale?: string): Promise<string[]>;
  listLocales(slug: string): Promise<string[]>;
  exists(slug: string, locale?: string): Promise<boolean>;
  readRaw(slug: string, locale?: string): Promise<string>;
  writeRaw(slug: string, raw: string, locale?: string): Promise<void>;
  deletePublished(slug: string, locale?: string): Promise<void>;
  readDraftRaw(slug: string, locale?: string): Promise<string | null>;
  writeDraftRaw(slug: string, raw: string, locale?: string): Promise<void>;
  deleteDraft(slug: string, locale?: string): Promise<void>;
  hasDraft(slug: string, locale?: string): Promise<boolean>;
  // `parse`/`serialize` are pure/sync per the real `ContentAdapter` interface.
  // The contract suite writes/reads through THESE, not raw string literals:
  // "raw" is an adapter-owned encoding (gray-matter markdown for the fs/
  // GitHub adapters, a JSON envelope for the Notion adapter), never a format
  // every adapter shares.
  parse(raw: string): { meta: Record<string, unknown>; slices: unknown[]; body: string };
  serialize(page: { meta: Record<string, unknown>; slices: unknown[]; body: string }): string;
}

export type ContentAdapterContractSeed = {
  /** A slug this suite is free to write/delete at will, not used by anything
   *  else the adapter under test might hold. Default "typren-contract-test". */
  slug?: string;
  /** A second slug, same requirement, for the two-slug ordering check.
   *  Default "typren-contract-test-2". */
  secondSlug?: string;
  /** Set for an adapter with no separate draft tier, where `writeDraftRaw`
   *  aliases straight through to the published write (the Notion adapter,
   *  see notion-adapter.ts's own doc comment on why: Notion has no API-level
   *  draft/publish distinction). The draft-lifecycle sub-test then asserts
   *  THAT contract instead of a real draft's: `hasDraft`/`readDraftRaw`
   *  report "no draft" even right after a `writeDraftRaw`, and the published
   *  read reflects it immediately. Default false (a real separate draft). */
  draftsWriteThrough?: boolean;
};

/**
 * Runnable conformance suite for any `ContentAdapter` implementation: a
 * round-trip of published/draft content, the draft lifecycle, exists/hasDraft
 * reporting, sorted listSlugs, idempotent delete, and that an unsafe slug or
 * locale rejects (a rejected promise, not a synchronous throw, since every
 * `ContentAdapter` method returns a promise, see types.ts). `makeAdapter` is
 * called once per `it()` so adapters that can't be reused across tests (a
 * fresh temp dir, say) still work; it may return the SAME instance every
 * time for one that can.
 *
 * Every real adapter in this repo (markdown, github, notion) runs this suite
 * against itself (markdown-adapter.test.ts, github-adapter.test.ts,
 * notion-adapter.test.ts) in addition to its own adapter-specific tests, so a
 * behavior this suite checks can never silently diverge between them.
 */
export function createContentAdapterContractSuite(
  makeAdapter: () => ContentAdapterLike,
  seed: ContentAdapterContractSeed = {}
) {
  const slug = seed.slug ?? "typren-contract-test";
  const secondSlug = seed.secondSlug ?? "typren-contract-test-2";
  const draftsWriteThrough = seed.draftsWriteThrough ?? false;

  const page = (body: string) => ({ meta: { title: body }, slices: [], body });
  // Markdown's gray-matter round trip adds a trailing newline to the body;
  // trimmed comparison keeps this suite about CONTENT, not an adapter's own
  // serialization whitespace convention.
  const bodyOf = (raw: string, adapter: ContentAdapterLike) => adapter.parse(raw).body.trim();

  describe("ContentAdapter contract", () => {
    it("round-trips a published write/read", async () => {
      const adapter = makeAdapter();
      await adapter.writeRaw(slug, adapter.serialize(page("published content")));
      expect(await adapter.exists(slug)).toBe(true);
      expect(bodyOf(await adapter.readRaw(slug), adapter)).toBe("published content");
    });

    if (draftsWriteThrough) {
      it("writeDraftRaw aliases straight through to published; there is no separate draft tier", async () => {
        const adapter = makeAdapter();
        await adapter.writeDraftRaw(slug, adapter.serialize(page("write-through content")));
        expect(await adapter.hasDraft(slug)).toBe(false);
        expect(await adapter.readDraftRaw(slug)).toBeNull();
        expect(await adapter.exists(slug)).toBe(true);
        expect(bodyOf(await adapter.readRaw(slug), adapter)).toBe("write-through content");

        // No-op, must not throw or touch the published write it aliases.
        await expect(adapter.deleteDraft(slug)).resolves.toBeUndefined();
        expect(await adapter.exists(slug)).toBe(true);
      });
    } else {
      it("runs the draft lifecycle: write, read, hasDraft, discard", async () => {
        const adapter = makeAdapter();
        expect(await adapter.readDraftRaw(slug)).toBeNull();
        expect(await adapter.hasDraft(slug)).toBe(false);

        await adapter.writeDraftRaw(slug, adapter.serialize(page("draft content")));
        expect(await adapter.hasDraft(slug)).toBe(true);
        expect(bodyOf((await adapter.readDraftRaw(slug))!, adapter)).toBe("draft content");

        await adapter.deleteDraft(slug);
        expect(await adapter.hasDraft(slug)).toBe(false);
        expect(await adapter.readDraftRaw(slug)).toBeNull();
      });
    }

    if (!draftsWriteThrough) {
      it("exists/hasDraft report independently of each other", async () => {
        const adapter = makeAdapter();
        await adapter.writeRaw(slug, adapter.serialize(page("published only")));
        expect(await adapter.exists(slug)).toBe(true);
        expect(await adapter.hasDraft(slug)).toBe(false);

        await adapter.writeDraftRaw(slug, adapter.serialize(page("now also drafted")));
        expect(await adapter.exists(slug)).toBe(true);
        expect(await adapter.hasDraft(slug)).toBe(true);
      });
    }

    it("listSlugs returns every written slug, sorted", async () => {
      const adapter = makeAdapter();
      await adapter.writeRaw(secondSlug, adapter.serialize(page("z")));
      await adapter.writeRaw(slug, adapter.serialize(page("a")));
      const slugs = await adapter.listSlugs();
      expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
      expect(slugs).toEqual(expect.arrayContaining([slug, secondSlug]));
    });

    it("listLocales reports the default locale once published there", async () => {
      const adapter = makeAdapter();
      await adapter.writeRaw(slug, adapter.serialize(page("content")));
      expect(await adapter.listLocales(slug)).toContain(adapter.defaultLocale);
    });

    it("delete is idempotent: deleting twice is not an error", async () => {
      const adapter = makeAdapter();
      await adapter.writeRaw(slug, adapter.serialize(page("content")));
      await adapter.deletePublished(slug);
      await expect(adapter.deletePublished(slug)).resolves.toBeUndefined();
      expect(await adapter.exists(slug)).toBe(false);
    });

    it("rejects (not throws synchronously) on an unsafe slug", async () => {
      const adapter = makeAdapter();
      const call = adapter.readRaw("../../etc/passwd");
      expect(call).toBeInstanceOf(Promise);
      await expect(call).rejects.toThrow();
    });

    it("rejects (not throws synchronously) on an unconfigured locale", async () => {
      const adapter = makeAdapter();
      const call = adapter.exists(slug, "zz-not-configured");
      expect(call).toBeInstanceOf(Promise);
      await expect(call).rejects.toThrow();
    });
  });
}
