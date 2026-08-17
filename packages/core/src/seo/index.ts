// Server-safe SEO/AIO core: metadata, structured data, sitemap/robots, and
// the raw-markdown/llms-full.txt AIO surfaces. Separate subpath (like
// "./editor") so a consumer who only wants the CMS core (registry/store/
// adapter, e.g. a non-Next consumer) doesn't pull in next/server or next's
// Metadata types.
export type { PageSeoMeta, SliceJsonLd, OrganizationConfig, SeoConfig } from "./types";
export { JsonLd, organizationJsonLd, websiteJsonLd, breadcrumbJsonLd } from "./json-ld";
export { collectSliceJsonLd } from "./slice-registry";
export { buildRootMetadata, buildMetadata } from "./metadata";
export { buildSitemap, type BuildSitemapOptions } from "./sitemap";
export { buildRobots, DEFAULT_AI_CRAWLERS } from "./robots";
export { renderSlicesAsMarkdown, type SliceMarkdownRegistry } from "./markdown-render";
export {
  createMarkdownRouteHandler,
  createMarkdownMirrorMiddleware,
  matchMarkdownMirrorSlug,
} from "./markdown-route";
export { generateLlmsFullTxt } from "./llms-txt";
