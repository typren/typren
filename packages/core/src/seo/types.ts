import type { MetadataRoute } from "next";
import type { PageContent } from "../types";

/** Per-page SEO frontmatter fields. All optional. A page with none of
 *  these still gets the site defaults from SeoConfig. Lives inside a
 *  page's existing `meta` (frontmatter minus `slices:`), no new file format. */
export type PageSeoMeta = {
  title?: string;
  description?: string;
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
  keywords?: string[];
  /** Per-page sitemap overrides; omitted fields fall back to SeoConfig defaults. */
  sitemap?: {
    priority?: number;
    changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
  };
};

/** A slice declares structured data for its own props. Returns one JSON-LD
 *  object, several (e.g. one per FAQ-like item group), or null to emit
 *  nothing for that slice instance. Never throws on missing/malformed props.
 *  Returns null instead, since a bad content edit shouldn't break the page. */
export type SliceJsonLd<P = Record<string, unknown>> = (props: P) => object | object[] | null;

export type OrganizationConfig = {
  logo?: string;
  /** Optional short/brand alternate name, e.g. Organization.alternateName. */
  alternateName?: string;
  parentOrganization?: string;
  sameAs?: string[];
};

/** One object wires the SEO/AIO module into a project, same spirit as
 *  CmsConfig, kept separate from it: this governs public rendering
 *  (metadata/sitemap/robots/JSON-LD), CmsConfig governs the editor. */
export type SeoConfig = {
  siteUrl: string;
  siteName: string;
  /** Longer canonical "what is this org" statement. JSON-LD Organization.description
   *  and llms.txt/llms-full.txt are not SERP-length-constrained like <meta description>,
   *  so this is deliberately allowed to be longer than defaultDescription. */
  entityDescription: string;
  defaultTitle: string;
  defaultDescription: string;
  /** e.g. "%s | Acme Inc". Omit for no template (title used as-is). */
  titleTemplate?: string;
  /** Slugs whose <title> opts out of titleTemplate (rendered via {absolute}). */
  bareTitleSlugs?: readonly string[];
  /** e.g. "/opengraph-image" (Next file-convention route) or an absolute URL. */
  defaultOgImage?: string;
  organization?: OrganizationConfig;
  /** Defaults to DEFAULT_AI_CRAWLERS (robots.ts) if omitted. */
  aiCrawlers?: readonly string[];
  /** Schema-per-slice registry, keyed by slice name, same key shape as
   *  CmsConfig.registry / fieldSchema. Optional: slices with no entry
   *  simply emit no JSON-LD. */
  sliceJsonLd?: Record<string, SliceJsonLd>;
};

export type { PageContent };
