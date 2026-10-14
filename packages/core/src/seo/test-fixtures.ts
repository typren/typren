import type { ContentStore } from "../store";
import type { PageContent, Slice } from "../types";

type FixturePage = { slug: string; meta?: Record<string, unknown>; slices?: Slice[] };

/** Minimal in-memory ContentStore for the pure-function tests in this
 *  directory: no fs, no adapter. Only listPages/getPublished are real;
 *  the rest of the interface is stubbed since nothing under test calls it. */
export function fakeStore(pages: FixturePage[]): ContentStore {
  const byId = new Map<string, PageContent>(
    pages.map((p) => [p.slug, { meta: p.meta ?? {}, slices: p.slices ?? [], body: "" }])
  );
  return {
    listPages: async () =>
      pages.map((p) => ({
        slug: p.slug,
        title: (p.meta?.title as string) ?? p.slug,
        hasDraft: false,
        locales: ["en"],
      })),
    getPublished: async (slug) => ({ ...byId.get(slug)!, locale: "en", isFallback: false }),
    getDraft: async () => null,
    currentVersion: async () => null,
    saveDraft: async () => "",
    discardDraft: async () => {},
    publish: async () => {},
    createPage: async () => {},
    renamePage: async () => {},
    duplicatePage: async () => "",
    createTranslation: async () => {},
    deletePage: async () => {},
    deleteTranslation: async () => {},
  };
}
