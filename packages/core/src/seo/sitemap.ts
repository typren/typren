import type { MetadataRoute } from "next";
import type { ContentStore } from "../store";
import type { I18nConfig } from "../i18n";
import { localizedPath } from "../i18n";
import type { PageSeoMeta, SeoConfig } from "./types";

export type BuildSitemapOptions = {
  /** Slug that maps to the site root ("/") instead of "/<slug>" — e.g. "home". */
  homeSlug?: string;
  defaultChangeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
  defaultPriority?: number;
  /** When given with more than one locale, emits one entry per (locale, slug)
   *  with `alternates.languages` hreflang. Single locale (or omitted) is
   *  byte-identical to the non-i18n sitemap. */
  i18n?: I18nConfig;
};

/** One entry per page in the store, honoring per-page `noindex`/`sitemap`
 *  frontmatter overrides. Does NOT know about non-CMS collections (e.g. a
 *  separate hosted-resources collection) — the host concats those itself. */
export function buildSitemap(
  store: ContentStore,
  config: SeoConfig,
  opts: BuildSitemapOptions = {}
): MetadataRoute.Sitemap {
  const now = new Date();
  const { homeSlug, defaultChangeFrequency = "monthly", defaultPriority = 0.7, i18n } = opts;
  const multiLocale = !!i18n && i18n.locales.length > 1;

  return store.listPages().flatMap(({ slug }) => {
    const meta = store.getPublished(slug).meta as PageSeoMeta;
    if (meta.noindex) return [];
    const rest = {
      lastModified: now,
      changeFrequency: meta.sitemap?.changeFrequency ?? (slug === homeSlug ? "weekly" : defaultChangeFrequency),
      priority: meta.sitemap?.priority ?? (slug === homeSlug ? 1 : defaultPriority),
    } satisfies Partial<MetadataRoute.Sitemap[number]>;

    if (!multiLocale) {
      const url = slug === homeSlug ? config.siteUrl : `${config.siteUrl}/${slug}`;
      return [{ url, ...rest }];
    }
    const path = slug === homeSlug ? "/" : `/${slug}`;
    const languages = Object.fromEntries(
      i18n.locales.map((l) => [l, config.siteUrl + localizedPath(i18n, path, l)])
    );
    return i18n.locales.map((l) => ({
      url: config.siteUrl + localizedPath(i18n, path, l),
      alternates: { languages },
      ...rest,
    }));
  });
}
