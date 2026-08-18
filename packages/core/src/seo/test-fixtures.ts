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
    listPages: () =>
      pages.map((p) => ({
        slug: p.slug,
        title: (p.meta?.title as string) ?? p.slug,
        hasDraft: false,
        locales: ["en"],
      })),
    getPublished: (slug) => ({ ...byId.get(slug)!, locale: "en", isFallback: false }),
    getDraft: () => null,
    currentVersion: () => null,
    saveDraft: () => "",
    discardDraft: () => {},
    publish: async () => {},
    createPage: () => {},
    renamePage: () => {},
    duplicatePage: () => "",
    createTranslation: () => {},
    deletePage: () => {},
    deleteTranslation: () => {},
  };
}
