import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ContentStore } from "@typren/core";

/**
 * Minimal read-only `ContentStore` built by scanning a content directory's
 * flat `*.md` files directly, rather than importing the host's `cms.config.ts`
 * (which imports "server-only" and throws outside a React Server Component
 * build — the same constraint `typren review`'s `listCmsPageSlugs`/`parsePage`
 * in packages/cli work around, mirrored here). Only `listPages`/`getPublished`
 * are real; `buildRedirects` (this CLI's only caller) needs nothing else.
 *
 * ponytail: default-locale, flat-file layout only, same scope `typren review`
 * already covers. No draft/i18n/collection support — a redirects sync doesn't
 * need it, and buildRedirects itself is single-locale (see core/redirects.ts).
 */
export function scanContentStore(contentDir: string): ContentStore {
  const slugs = fs.existsSync(contentDir)
    ? fs
        .readdirSync(contentDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        .filter((slug: string) => Array.isArray(matter(fs.readFileSync(path.join(contentDir, `${slug}.md`), "utf8")).data.slices))
    : [];

  const notSupported = (op: string) => (): never => {
    throw new Error(`typren-cloudfront: scanContentStore is read-only, "${op}" is not supported`);
  };

  return {
    listPages: () => slugs.map((slug) => ({ slug, title: slug, hasDraft: false, locales: ["default"] })),
    getPublished: (slug: string) => {
      const { data } = matter(fs.readFileSync(path.join(contentDir, `${slug}.md`), "utf8"));
      // The `slices` key is left in `meta` here (unlike packages/cli's parsePage,
      // which splits it out for its own diffing needs) — buildRedirects only
      // ever reads `meta.aliases`, so there's nothing to gain from stripping it.
      return { meta: data as Record<string, unknown>, slices: [], body: "", locale: "default", isFallback: false };
    },
    getDraft: () => null,
    currentVersion: () => null,
    saveDraft: notSupported("saveDraft"),
    discardDraft: notSupported("discardDraft"),
    publish: async () => notSupported("publish")(),
    createPage: notSupported("createPage"),
    renamePage: notSupported("renamePage"),
    duplicatePage: notSupported("duplicatePage"),
    createTranslation: notSupported("createTranslation"),
    deletePage: notSupported("deletePage"),
    deleteTranslation: notSupported("deleteTranslation"),
  };
}
