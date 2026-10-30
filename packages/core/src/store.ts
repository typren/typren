import type { ContentAdapter, LocalizedPage, PageContent, PageInfo } from "./types";
import { versionOf, ConflictError, SlugExistsError } from "./version";
import { mergeLocalized } from "./localize";
import { mapLimit } from "./concurrency";
import { SITE_SLUG, assertSafeNav } from "./nav";

/** Fan-out concurrency cap for store/SEO operations that loop over every slug
 *  (or slug x locale) in a site: bounds concurrent adapter calls against
 *  GitHub/Notion rate limits and fs file-descriptor limits. */
const FANOUT_LIMIT = 8;

/** Normalize free text into a URL-safe slug: lowercase, alnum-and-dash only, no
 *  leading/trailing dashes. Shared by `createPage` (from a title) and
 *  `duplicatePage` (from a source slug + "-copy" suffix) so slug derivation
 *  can't drift between the two call sites. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Page slugs linked from the site doc's header navigation, in depth-first
 *  order: `nav` items (and their `children`), then the `cta`. Only internal
 *  hrefs count ("/about", "/about/"); "#", "/" and external links don't.
 *  Null when the site doc has no `nav` list (the menu lives in the site's
 *  code), so pages fall back to their own front matter. Anything shaped
 *  otherwise means no navigation, never a throw.
 *  ponytail: "/" is skipped because the store doesn't know the home slug;
 *  the editor pins home on its own. */
async function siteNav(adapter: ContentAdapter, locale: string): Promise<string[] | null> {
  try {
    if (!(await adapter.exists(SITE_SLUG, locale))) return null;
    const { nav, cta } = adapter.parse(await adapter.readRaw(SITE_SLUG, locale)).meta;
    if (!Array.isArray(nav)) return null;
    const out: string[] = [];
    const visit = (item: unknown) => {
      if (!item || typeof item !== "object") return;
      const { href, external, children } = item as Record<string, unknown>;
      if (typeof href === "string" && external !== true && /^\/[^/]/.test(href)) {
        const slug = href.split(/[?#]/)[0].replace(/^\/|\/$/g, "");
        if (slug && !out.includes(slug)) out.push(slug);
      }
      if (Array.isArray(children)) children.forEach(visit);
    };
    nav.forEach(visit);
    visit(cta);
    return out;
  } catch {
    return null;
  }
}

/** Read/draft/publish operations over an adapter. Storage-agnostic. Every read
 *  and mutation takes an optional `locale` (defaults to the default locale, so
 *  single-locale callers are unchanged); the store composes the default-locale
 *  fallback that the dumb per-locale adapter doesn't know about. */
export interface ContentStore {
  listPages(locale?: string): Promise<PageInfo[]>;
  /** Slugs of every page, cheap (adapter.listSlugs, no per-page read). Use
   *  this instead of `listPages` for builders that only need the slug set
   *  (sitemap, llms.txt, redirects), not each page's hasDraft/locales. */
  listSlugs(locale?: string): Promise<string[]>;
  /** Whether `slug` has published content for a locale. A cheap existence
   *  check, unlike `listPages`, which fans out over every slug in the store;
   *  callers that only need to know "does this one page exist" (e.g. the
   *  markdown mirror route) should use this instead of scanning the list. */
  exists(slug: string, locale?: string): Promise<boolean>;
  /** Published content for a locale, with default-locale fallback applied. */
  getPublished(slug: string, locale?: string): Promise<LocalizedPage>;
  getDraft(slug: string, locale?: string): Promise<PageContent | null>;
  /** Version of the content the editor would load (draft if present, else
   *  published, else null when the slug has no content yet) for a locale. */
  currentVersion(slug: string, locale?: string): Promise<string | null>;
  /** Write a draft. When `baseVersion` is given, throws `ConflictError` if the
   *  current version has moved since (optimistic lock). Returns the new version. */
  saveDraft(slug: string, page: PageContent, baseVersion?: string, locale?: string): Promise<string>;
  discardDraft(slug: string, locale?: string): Promise<void>;
  /** Promote the draft to published (via the adapter), clear it, run onPublish.
   *  With `baseVersion`, throws `ConflictError` if the draft moved since. */
  publish(slug: string, baseVersion?: string, locale?: string): Promise<void>;
  /** Create a new page in a locale, published, or with `opts.draft` as a draft
   *  only (it lists with `published: false` until its first publish). Throws
   *  if the slug already has published content or a draft. */
  createPage(slug: string, page: PageContent, locale?: string, opts?: { draft?: boolean }): Promise<void>;
  /** Seed a draft translation of an existing page from `fromLocale`'s content
   *  (copies structure + text as a starting point). No-op if `toLocale` already
   *  has content or a draft. */
  createTranslation(slug: string, fromLocale: string, toLocale: string): Promise<void>;
  /** Delete a page in ALL locales (+ their drafts). */
  deletePage(slug: string): Promise<void>;
  /** Delete a single translation (one locale) + its draft. */
  deleteTranslation(slug: string, locale: string): Promise<void>;
  /** Move a page from `slug` to `newSlug`: published AND any draft, in every
   *  locale the source occupies (see markdown-adapter's per-locale layout).
   *  All-locales, unlike most ops' single optional `locale` param: a page's
   *  slug is the key tying its translations together (`listPages` derives the
   *  canonical page set from the default locale's slugs), so moving only one
   *  locale's file would strand the rest under the old name. Throws
   *  `SlugExistsError` (not `ConflictError`, a destination collision, not a
   *  stale-version race) if `newSlug` already has content anywhere the move
   *  would touch. No-op if `newSlug === slug`. */
  renamePage(slug: string, newSlug: string): Promise<void>;
  /** Copy `slug`'s content (published AND draft, whichever exist) to a new,
   *  auto-derived non-colliding slug (see `slugify`) and return it. Single-
   *  locale (defaults to the default locale), matching `createPage`'s own
   *  scope; other translations of the source are not duplicated. Throws if
   *  `slug` has neither published nor draft content to copy. `beforeWrite`
   *  runs on the derived slug before anything is written, so a caller can
   *  authorize the destination (it throws to abort). */
  duplicatePage(slug: string, locale?: string, beforeWrite?: (newSlug: string) => Promise<void>): Promise<string>;
}

export function createStore(
  adapter: ContentAdapter,
  opts: {
    onPublish?: (slug: string, locale: string) => void | Promise<void>;
    onSaveDraft?: (slug: string, locale: string, version: string) => void;
    /** Default locale for fallback. Defaults to the adapter's. */
    defaultLocale?: string;
  } = {}
): ContentStore {
  const defaultLocale = opts.defaultLocale ?? adapter.defaultLocale;

  // Version of what the editor would load for a locale: draft, else published.
  const readVersion = async (slug: string, locale = defaultLocale): Promise<string | null> => {
    const draft = await adapter.readDraftRaw(slug, locale);
    const raw = draft ?? (await adapter.exists(slug, locale) ? await adapter.readRaw(slug, locale) : null);
    return raw === null ? null : versionOf(raw);
  };

  return {
    async listPages(locale = defaultLocale) {
      // Canonical page set = the default locale's slugs (a translation is always
      // of an existing default page). Independent reads, bounded to FANOUT_LIMIT
      // concurrent adapter calls (unbounded Promise.all over every slug can open
      // hundreds of requests against a rate-limited GitHub/Notion adapter).
      // Draft-only pages (never published) join the set from the adapter's
      // draft listing, read from their draft since they have no published file.
      const [slugs, draftSlugs, nav] = await Promise.all([
        adapter.listSlugs(defaultLocale),
        adapter.listDraftSlugs?.(defaultLocale) ?? [],
        siteNav(adapter, defaultLocale),
      ]);
      const published = new Set(slugs);
      // The site doc is never a page, even once a write gave it a slice array.
      const all = [...slugs, ...draftSlugs.filter((s) => !published.has(s))].filter((s) => s !== SITE_SLUG);
      return mapLimit(all, FANOUT_LIMIT, async (slug) => {
        const [raw, hasDraft, pageLocales] = await Promise.all([
          published.has(slug) ? adapter.readRaw(slug, defaultLocale) : adapter.readDraftRaw(slug, defaultLocale).then((r) => r ?? ""),
          adapter.hasDraft(slug, locale),
          adapter.listLocales(slug),
        ]);
        const meta = adapter.parse(raw).meta;
        const title = typeof meta.title === "string" ? meta.title : slug;
        // Front matter is author-written: a wrongly typed value is dropped, not
        // coerced. The site doc's menu decides `nav`/`navOrder` when it has
        // one; a page's own front matter only counts on a site without it.
        const inNav = nav?.indexOf(slug) ?? -1;
        return {
          slug,
          title,
          hasDraft,
          locales: pageLocales,
          ...(inNav >= 0 && { nav: true, navOrder: inNav }),
          ...(!nav && typeof meta.nav === "boolean" && { nav: meta.nav }),
          ...(!nav && Number.isFinite(meta.navOrder) && { navOrder: meta.navOrder as number }),
          ...(typeof meta.system === "boolean" && { system: meta.system }),
          ...(typeof meta.noindex === "boolean" && { noindex: meta.noindex }),
          ...(!published.has(slug) && { published: false }),
        };
      });
    },

    listSlugs: async (locale) => (await adapter.listSlugs(locale ?? defaultLocale)).filter((s) => s !== SITE_SLUG),

    exists: (slug, locale = defaultLocale) => adapter.exists(slug, locale),

    async getPublished(slug, locale = defaultLocale): Promise<LocalizedPage> {
      const base = adapter.parse(await adapter.readRaw(slug, defaultLocale));
      if (locale === defaultLocale) return { ...base, locale, isFallback: false };
      if (!(await adapter.exists(slug, locale))) return { ...base, locale, isFallback: true };
      const localized = adapter.parse(await adapter.readRaw(slug, locale));
      return { ...mergeLocalized(base, localized), locale, isFallback: false };
    },

    async getDraft(slug, locale = defaultLocale) {
      const raw = await adapter.readDraftRaw(slug, locale);
      return raw === null ? null : adapter.parse(raw);
    },

    currentVersion: (slug, locale) => readVersion(slug, locale),

    async saveDraft(slug, page, baseVersion, locale = defaultLocale) {
      if (slug === SITE_SLUG) assertSafeNav(page.meta);
      if (baseVersion !== undefined) {
        // Draft-precedence: compare against what the editor actually loaded.
        // ponytail: this pre-check is still a read-then-write with a TOCTOU
        // window on its own (fine for a single-node fs CMS, which has nothing
        // else to CAS against). For an atomic adapter, `baseVersion` is also
        // passed through as `writeDraftRaw`'s `expectedVersion`, so the real
        // compare-and-swap happens at write time against the adapter's own
        // server-side check (e.g. github-adapter's cached blob sha), closing
        // the window this pre-check alone can't.
        const cur = await readVersion(slug, locale);
        if (cur !== baseVersion) throw new ConflictError(slug, cur, baseVersion);
      }
      const raw = adapter.serialize(page);
      await adapter.writeDraftRaw(slug, raw, locale, baseVersion !== undefined ? { expectedVersion: baseVersion } : undefined);
      const version = versionOf(raw);
      opts.onSaveDraft?.(slug, locale, version);
      return version;
    },

    discardDraft: (slug, locale) => adapter.deleteDraft(slug, locale),

    async publish(slug, baseVersion, locale = defaultLocale) {
      const raw = await adapter.readDraftRaw(slug, locale);
      // No draft = nothing to publish. Don't rewrite the published file.
      if (raw === null) return;
      if (baseVersion !== undefined && versionOf(raw) !== baseVersion)
        throw new ConflictError(slug, versionOf(raw), baseVersion);
      await adapter.writeRaw(slug, raw, locale);
      await adapter.deleteDraft(slug, locale);
      await opts.onPublish?.(slug, locale);
    },

    async createPage(slug, page, locale = defaultLocale, opts = {}) {
      if ((await adapter.exists(slug, locale)) || (await adapter.hasDraft(slug, locale)))
        throw new Error(`typren: page "${slug}" already exists`);
      const raw = adapter.serialize(page);
      await (opts.draft ? adapter.writeDraftRaw(slug, raw, locale) : adapter.writeRaw(slug, raw, locale));
    },

    async createTranslation(slug, fromLocale, toLocale) {
      const [exists, hasDraft] = await Promise.all([adapter.exists(slug, toLocale), adapter.hasDraft(slug, toLocale)]);
      if (exists || hasDraft) return;
      // Read of `fromLocale` throws if the source page is absent. A translation
      // is always of an existing page.
      const src = adapter.parse(await adapter.readRaw(slug, fromLocale));
      await adapter.writeDraftRaw(slug, adapter.serialize(src), toLocale); // draft, not published
    },

    async deletePage(slug) {
      // Every locale (allowlist), so draft-only translations are cleaned too;
      // the adapter no-ops when a file is absent. Independent per-locale deletes.
      await Promise.all(
        adapter.locales.map((l) => Promise.all([adapter.deletePublished(slug, l), adapter.deleteDraft(slug, l)]))
      );
    },

    async deleteTranslation(slug, locale) {
      await Promise.all([adapter.deletePublished(slug, locale), adapter.deleteDraft(slug, locale)]);
    },

    async renamePage(slug, newSlug) {
      if (slug === newSlug) return; // ponytail: nothing to move, not a conflict on yourself
      // Check every locale before mutating any of them, so a collision found
      // on locale 2 of N can't leave a half-moved page on disk. Checks are
      // independent reads; the mutation pass below still runs one locale at a
      // time (each iteration's writes/deletes depend on that locale's reads).
      const collisions = await Promise.all(
        adapter.locales.map(async (l) => (await adapter.exists(newSlug, l)) || (await adapter.hasDraft(newSlug, l)))
      );
      if (collisions.some(Boolean)) throw new SlugExistsError(newSlug);

      for (const l of adapter.locales) {
        if (await adapter.exists(slug, l)) {
          await adapter.writeRaw(newSlug, await adapter.readRaw(slug, l), l);
          await adapter.deletePublished(slug, l);
        }
        const draft = await adapter.readDraftRaw(slug, l);
        if (draft !== null) {
          await adapter.writeDraftRaw(newSlug, draft, l);
          await adapter.deleteDraft(slug, l);
        }
      }
    },

    async duplicatePage(slug, locale = defaultLocale, beforeWrite) {
      const [publishedExists, draft] = await Promise.all([adapter.exists(slug, locale), adapter.readDraftRaw(slug, locale)]);
      const published = publishedExists ? await adapter.readRaw(slug, locale) : null;
      if (published === null && draft === null) throw new Error(`typren: page "${slug}" does not exist`);

      // Same derive-and-bump scheme as the example in the task: "about" ->
      // "about-copy" -> "about-copy-2" -> ... First free slug wins.
      const base = slugify(`${slug}-copy`);
      let newSlug = base;
      for (let n = 2; (await adapter.exists(newSlug, locale)) || (await adapter.hasDraft(newSlug, locale)); n++)
        newSlug = `${base}-${n}`;
      await beforeWrite?.(newSlug);

      // Copy BOTH tiers that exist: a duplicate is meant to be a faithful
      // clone of the source's current state, not just its last published
      // snapshot: dropping an in-progress draft silently would surprise
      // whoever is mid-edit on the source.
      if (published !== null) await adapter.writeRaw(newSlug, published, locale);
      if (draft !== null) await adapter.writeDraftRaw(newSlug, draft, locale);
      return newSlug;
    },
  };
}
