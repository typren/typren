import type { ContentStore } from "./store";
import { mapLimit } from "./concurrency";
import type { RedirectStatus } from "./static-host";

const FANOUT_LIMIT = 8;

/** Per-page redirect frontmatter. Lives inside a page's existing `meta`
 *  (frontmatter minus `slices:`), no new file format, same convention as
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
  /** HTTP status this redirect should be served with. `undefined` means the
   *  default, 301. Frontmatter aliases never set this (always 301); only a
   *  `--map` entry (see redirect-sources.ts's loadRedirectMap) can. */
  status?: RedirectStatus;
};

export type BuildRedirectsOptions = {
  /** Slug that maps to the site root ("/") instead of "/<slug>", e.g. "home"
   *  (mirrors seo/sitemap.ts's homeSlug). */
  homeSlug?: string;
  /** Hard ceiling on total alias entries across the site (default 1000): a
   *  safety valve against a runaway or malicious frontmatter edit, not a
   *  realistic target. */
  maxEntries?: number;
  /** Path prefixes an alias must never claim beyond this store's own pages:
   *  another locale's URL prefix (e.g. "/es"), a collection's public base
   *  (e.g. "/blog"), or any other route the host owns outside this
   *  ContentStore. This module reads one store and has no i18n/collection
   *  config of its own, so the host passes whatever it knows is reserved. */
  reservedPrefixes?: string[];
};

const DEFAULT_MAX_ENTRIES = 1000;
// Generic URL-length sanity bound, not any one host's own hard cap.
// @typren/adapter-cloudfront's KVS 512B-key/1024B-value limits are stricter
// and checked separately at emit time, that constraint belongs to the
// vendor target, not this framework-agnostic core.
const MAX_PATH_LENGTH = 2048;

const normalize = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

const WELL_KNOWN_PREFIX = "/.well-known";
const hasFileExtension = (p: string): boolean => /\.[a-zA-Z0-9]+$/.test(p.slice(p.lastIndexOf("/") + 1));

/** Reason an alias target must never become a redirect, or null when it's
 *  fine. These are never "claimed" by a page the way a shadowed canonical
 *  path is (no page owns "/" without `homeSlug`, a static asset isn't in the
 *  ContentStore at all, /.well-known belongs to other protocols, and a
 *  locale prefix or collection base lives outside this single store), so
 *  they need their own check rather than falling out of the shadow check
 *  above. Warned and skipped, not thrown: unlike a malformed alias (always
 *  invalid, any build), these categories are newly restricted and an
 *  existing site's content may already declare one, so a patch that
 *  tightens them must not turn into a hard build break. */
function restrictedAliasReason(from: string, reservedPrefixes: string[]): string | null {
  if (from === "/") return `"/" is reserved for the site root`;
  if (from === WELL_KNOWN_PREFIX || from.startsWith(`${WELL_KNOWN_PREFIX}/`)) return "/.well-known paths are reserved";
  if (hasFileExtension(from)) return "paths with a file extension are reserved for static assets";
  for (const raw of reservedPrefixes) {
    const prefix = normalize(raw);
    if (from === prefix || from.startsWith(`${prefix}/`)) return `"${prefix}" is a reserved prefix (another locale or collection)`;
  }
  return null;
}

/** Canonical public path for a slug, the same slug->URL mapping buildSitemap
 *  uses, kept in sync so an alias can never quietly diverge from where the
 *  sitemap says the page actually lives. */
const canonicalPath = (slug: string, homeSlug?: string): string => (slug === homeSlug ? "/" : `/${slug}`);

/**
 * One entry per page-declared alias (frontmatter `aliases: string[]`),
 * validated and de-duplicated across the whole site. Framework-agnostic:
 * hosts turn this into whatever their infra wants (Next `redirects()`,
 * a Netlify/Cloudflare `_redirects` file, `vercel.json`, an nginx map, a
 * CloudFront KeyValueStore, see `@typren/adapter-cloudfront`) instead of
 * hand-maintaining a redirect config.
 *
 * ponytail: single-locale only (reads the default-locale published page, no
 * `i18n` option). A translation declaring its own old URLs isn't a need
 * that's shown up yet; add it the way buildSitemap loops `i18n.locales` if
 * it does.
 *
 * Throws (fail loud at build/config time, never silently drops a bad entry)
 * on: a malformed alias (not an absolute path), an alias that shadows a real
 * page's own canonical path (including a page aliasing itself, which would
 * be a redirect loop), a duplicate alias claimed by two pages, or more total
 * aliases than `maxEntries`.
 *
 * Warns and SKIPS (does not throw) an alias that claims a path this store
 * can't see as already owned but that must never become a permanent edge
 * redirect regardless: "/" (when no page's canonical path is already "/"),
 * anything under `/.well-known/`, a path with a file extension (a static
 * asset route), or a `reservedPrefixes` entry (another locale/collection).
 * These are newly restricted, so an existing site's frontmatter may already
 * declare one; skipping keeps this fix from turning into a build break.
 */
export async function buildRedirects(store: ContentStore, opts: BuildRedirectsOptions = {}): Promise<RedirectEntry[]> {
  const { homeSlug, maxEntries = DEFAULT_MAX_ENTRIES, reservedPrefixes = [] } = opts;
  const slugs = await store.listSlugs();

  // Every real route on the site, so an alias can never shadow one of them.
  const canonicalPaths = new Map(slugs.map((slug) => [canonicalPath(slug, homeSlug), slug]));

  // Reads are independent (bounded concurrency), but validation below must
  // run in `slugs` order so a duplicate-alias error always names the same
  // "first" owner regardless of which read happened to finish first.
  const metas = await mapLimit(slugs, FANOUT_LIMIT, async (slug) => (await store.getPublished(slug)).meta as PageRedirectMeta);

  const entries: RedirectEntry[] = [];
  const claimedBy = new Map<string, string>(); // normalized `from` -> owning slug

  for (const [i, slug] of slugs.entries()) {
    const aliases = metas[i].aliases;
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
      const restricted = restrictedAliasReason(from, reservedPrefixes);
      if (restricted !== null) {
        console.warn(`typren: skipping "${slug}" alias "${from}": ${restricted}`);
        continue;
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
