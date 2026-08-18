import type { Metadata, ResolvingMetadata } from "next";
import type { PageContent } from "../types";
import type { I18nConfig } from "../i18n";
import { localizedPath } from "../i18n";
import type { PageSeoMeta, SeoConfig } from "./types";

/** Root-layout `metadata` object defaults: everything a Next app's
 *  layout.tsx hand-writes today, parameterized. Host still adds anything
 *  fully site-specific (e.g. Search Console `verification`) by spreading
 *  the result and adding keys. */
export function buildRootMetadata(config: SeoConfig): Metadata {
  return {
    metadataBase: new URL(config.siteUrl),
    title: config.titleTemplate
      ? { default: config.defaultTitle, template: config.titleTemplate }
      : config.defaultTitle,
    description: config.defaultDescription,
    openGraph: {
      type: "website",
      siteName: config.siteName,
      title: config.defaultTitle,
      description: config.defaultDescription,
      ...(config.defaultOgImage ? { images: [config.defaultOgImage] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: config.defaultTitle,
      description: config.defaultDescription,
    },
  };
}

/** Per-page Metadata for a slug-routed page, reading the page's frontmatter
 *  (PageSeoMeta fields live directly in PageContent.meta, no new file
 *  format). The caller is responsible for resolving `slug` to a `PageContent`
 *  first (e.g. via a ContentStore) and handling an unknown slug itself.
 *  This function never throws, so it never needs fs-mocking to test. */
export async function buildMetadata(
  page: PageContent,
  slug: string,
  config: SeoConfig,
  parent: ResolvingMetadata,
  /** When given with more than one locale, adds hreflang `alternates.languages`
   *  (+ x-default) and localizes the canonical for `locale`. With a single
   *  locale (or omitted) the output is byte-identical to the non-i18n build. */
  i18n?: I18nConfig,
  locale?: string
): Promise<Metadata> {
  const meta = page.meta as PageSeoMeta;
  const path = `/${slug}`;
  const loc = locale ?? i18n?.defaultLocale;
  const multiLocale = !!i18n && i18n.locales.length > 1 && !!loc;
  const url = meta.canonical ?? (multiLocale ? localizedPath(i18n, path, loc) : path);
  const languages = multiLocale
    ? {
        ...Object.fromEntries(i18n.locales.map((l) => [l, localizedPath(i18n, path, l)])),
        "x-default": localizedPath(i18n, path, i18n.defaultLocale),
      }
    : undefined;
  const previous = await parent;

  let resolvedTitle: Metadata["title"];
  if (meta.title) {
    resolvedTitle = config.bareTitleSlugs?.includes(slug) ? { absolute: meta.title } : meta.title;
  }

  return {
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.keywords?.length ? { keywords: meta.keywords } : {}),
    ...(meta.noindex ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    openGraph: {
      ...(previous.openGraph ?? {}),
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.ogImage ? { images: [meta.ogImage] } : {}),
      url,
    },
    twitter: {
      ...(previous.twitter ?? {}),
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.description ? { description: meta.description } : {}),
    },
  };
}
