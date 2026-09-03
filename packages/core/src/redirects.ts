import type { ContentStore } from "./store";

/** Per-page redirect frontmatter. Lives inside a page's existing `meta`
 *  (frontmatter minus `slices:`), no new file format — same convention as
 *  seo/types.ts's PageSeoMeta. Each alias is an absolute, on-site path that
 *  should permanently redirect to this page, e.g. `aliases: ["/old-path"]`. */
export type PageRedirectMeta = {
  aliases?: string[];
};

export type RedirectEntry = {
  /** Absolute, trailing-slash-normalized incoming path. */
  from: string;
  /** Absolute, trailing-slash-normalized canonical path this alias resolves to. */
  to: string;
  /** Slug that declared the alias, for a host's own error/log messages. */
  slug: string;
};

export type BuildRedirectsOptions = {
  /** Slug that maps to the site root ("/") instead of "/<slug>", e.g. "home"
   *  (mirrors seo/sitemap.ts's homeSlug). */
  homeSlug?: string;
  /** Hard ceiling on total alias entries across the site (default 1000): a
   *  safety valve against a runaway or malicious frontmatter edit, not a
   *  realistic target. */
  maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 1000;
// Generic URL-length sanity bound, not any one host's own hard cap.
// @typren/adapter-cloudfront's KVS 512B-key/1024B-value limits are stricter
// and checked separately at emit time — that constraint belongs to the
// vendor target, not this framework-agnostic core.
const MAX_PATH_LENGTH = 2048;

const normalize = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

/** Canonical public path for a slug — the same slug->URL mapping buildSitemap
 *  uses, kept in sync so an alias can never quietly diverge from where the
 *  sitemap says the page actually lives. */
const canonicalPath = (slug: string, homeSlug?: string): string => (slug === homeSlug ? "/" : `/${slug}`);

/**
 * One entry per page-declared alias (frontmatter `aliases: string[]`),
 * validated and de-duplicated across the whole site. Framework-agnostic:
 * hosts turn this into whatever their infra wants (Next `redirects()`,
 * a Netlify/Cloudflare `_redirects` file, `vercel.json`, an nginx map, a
 * CloudFront KeyValueStore — see `@typren/adapter-cloudfront`) instead of
 * hand-maintaining a redirect config.
 *
 * ponytail: single-locale only (reads the default-locale published page, no
 * `i18n` option). A translation declaring its own old URLs isn't a need
 * that's shown up yet; add it the way buildSitemap loops `i18n.locales` if
 * it does.
 *
 * Throws (fail loud at build/config time, never silently drops a bad entry)
 * on: a malformed alias (not an absolute path), an alias that shadows a real
 * page's own canonical path — including a page aliasing itself, which would
 * be a redirect loop — a duplicate alias claimed by two pages, or more total
 * aliases than `maxEntries`.
 */
export function buildRedirects(store: ContentStore, opts: BuildRedirectsOptions = {}): RedirectEntry[] {
  const { homeSlug, maxEntries = DEFAULT_MAX_ENTRIES } = opts;
  const pages = store.listPages();

  // Every real route on the site, so an alias can never shadow one of them.
  const canonicalPaths = new Map(pages.map(({ slug }) => [canonicalPath(slug, homeSlug), slug]));

  const entries: RedirectEntry[] = [];
  const claimedBy = new Map<string, string>(); // normalized `from` -> owning slug

  for (const { slug } of pages) {
    const meta = store.getPublished(slug).meta as PageRedirectMeta;
    const aliases = meta.aliases;
    if (aliases === undefined) continue;
    if (!Array.isArray(aliases)) {
      throw new Error(`typren: "${slug}" frontmatter "aliases" must be an array of paths`);
    }

    for (const raw of aliases) {
      if (typeof raw !== "string" || !raw.startsWith("/") || raw.trim() === "" || /\s/.test(raw)) {
        throw new Error(
          `typren: "${slug}" has an invalid alias ${JSON.stringify(raw)} (must be an absolute path, e.g. "/old-path")`
        );
      }
      if (raw.length > MAX_PATH_LENGTH) {
        throw new Error(`typren: "${slug}" alias "${raw}" exceeds ${MAX_PATH_LENGTH} characters`);
      }
      const from = normalize(raw);

      const shadowed = canonicalPaths.get(from);
      if (shadowed !== undefined) {
        throw new Error(
          shadowed === slug
            ? `typren: "${slug}" aliases its own canonical path "${from}" (redirect loop)`
            : `typren: "${slug}" alias "${from}" shadows page "${shadowed}"'s own canonical path`
        );
      }
      const owner = claimedBy.get(from);
      if (owner !== undefined) {
        throw new Error(`typren: duplicate alias "${from}" claimed by both "${owner}" and "${slug}"`);
      }
      claimedBy.set(from, slug);

      if (entries.length >= maxEntries) {
        throw new Error(`typren: redirect count exceeds maxEntries (${maxEntries})`);
      }
      entries.push({ from, to: canonicalPath(slug, homeSlug), slug });
    }
  }

  return entries;
}
