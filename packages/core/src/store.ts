import type { ContentAdapter, LocalizedPage, PageContent, PageInfo } from "./types";
import { versionOf, ConflictError, SlugExistsError } from "./version";
import { mergeLocalized } from "./localize";

/** Normalize free text into a URL-safe slug: lowercase, alnum-and-dash only, no
 *  leading/trailing dashes. Shared by `createPage` (from a title) and
 *  `duplicatePage` (from a source slug + "-copy" suffix) so slug derivation
 *  can't drift between the two call sites. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Read/draft/publish operations over an adapter. Storage-agnostic. Every read
 *  and mutation takes an optional `locale` (defaults to the default locale, so
 *  single-locale callers are unchanged); the store composes the default-locale
 *  fallback that the dumb per-locale adapter doesn't know about. */
export interface ContentStore {
  listPages(locale?: string): PageInfo[];
  /** Published content for a locale, with default-locale fallback applied. */
  getPublished(slug: string, locale?: string): LocalizedPage;
  getDraft(slug: string, locale?: string): PageContent | null;
  /** Version of the content the editor would load (draft if present, else
   *  published, else null when the slug has no content yet) for a locale. */
  currentVersion(slug: string, locale?: string): string | null;
  /** Write a draft. When `baseVersion` is given, throws `ConflictError` if the
   *  current version has moved since (optimistic lock). Returns the new version. */
  saveDraft(slug: string, page: PageContent, baseVersion?: string, locale?: string): string;
  discardDraft(slug: string, locale?: string): void;
  /** Promote the draft to published (via the adapter), clear it, run onPublish.
   *  With `baseVersion`, throws `ConflictError` if the draft moved since. */
  publish(slug: string, baseVersion?: string, locale?: string): Promise<void>;
  /** Create a new published page in a locale. Throws if it already exists. */
  createPage(slug: string, page: PageContent, locale?: string): void;
  /** Seed a draft translation of an existing page from `fromLocale`'s content
   *  (copies structure + text as a starting point). No-op if `toLocale` already
   *  has content or a draft. */
  createTranslation(slug: string, fromLocale: string, toLocale: string): void;
  /** Delete a page in ALL locales (+ their drafts). */
  deletePage(slug: string): void;
  /** Delete a single translation (one locale) + its draft. */
  deleteTranslation(slug: string, locale: string): void;
  /** Move a page from `slug` to `newSlug` — published AND any draft, in every
   *  locale the source occupies (see markdown-adapter's per-locale layout).
   *  All-locales, unlike most ops' single optional `locale` param: a page's
   *  slug is the key tying its translations together (`listPages` derives the
   *  canonical page set from the default locale's slugs), so moving only one
   *  locale's file would strand the rest under the old name. Throws
   *  `SlugExistsError` (not `ConflictError` — a destination collision, not a
   *  stale-version race) if `newSlug` already has content anywhere the move
   *  would touch. No-op if `newSlug === slug`. */
  renamePage(slug: string, newSlug: string): void;
  /** Copy `slug`'s content — published AND draft, whichever exist — to a new,
   *  auto-derived non-colliding slug (see `slugify`) and return it. Single-
   *  locale (defaults to the default locale), matching `createPage`'s own
   *  scope; other translations of the source are not duplicated. Throws if
   *  `slug` has neither published nor draft content to copy. */
  duplicatePage(slug: string, locale?: string): string;
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
  const readVersion = (slug: string, locale = defaultLocale): string | null => {
    const raw =
      adapter.readDraftRaw(slug, locale) ??
      (adapter.exists(slug, locale) ? adapter.readRaw(slug, locale) : null);
    return raw === null ? null : versionOf(raw);
  };

  return {
    listPages(locale = defaultLocale) {
      // Canonical page set = the default locale's slugs (a translation is always
      // of an existing default page).
      return adapter.listSlugs(defaultLocale).map((slug) => {
        const meta = adapter.parse(adapter.readRaw(slug, defaultLocale)).meta;
        const title = typeof meta.title === "string" ? meta.title : slug;
        return { slug, title, hasDraft: adapter.hasDraft(slug, locale), locales: adapter.listLocales(slug) };
      });
    },

    getPublished(slug, locale = defaultLocale): LocalizedPage {
      const base = adapter.parse(adapter.readRaw(slug, defaultLocale));
      if (locale === defaultLocale) return { ...base, locale, isFallback: false };
      if (!adapter.exists(slug, locale)) return { ...base, locale, isFallback: true };
      return { ...mergeLocalized(base, adapter.parse(adapter.readRaw(slug, locale))), locale, isFallback: false };
    },

    getDraft(slug, locale = defaultLocale) {
      const raw = adapter.readDraftRaw(slug, locale);
      return raw === null ? null : adapter.parse(raw);
    },

    currentVersion: (slug, locale) => readVersion(slug, locale),

    saveDraft(slug, page, baseVersion, locale = defaultLocale) {
      if (baseVersion !== undefined) {
        // Draft-precedence: compare against what the editor actually loaded.
        // ponytail: read-then-write has a TOCTOU window — fine for a single-node
        // fs CMS. Upgrade path: an atomic adapter (git blob-sha / KV CAS) moves
        // the compare into the adapter via an optional `expectedVersion` hook.
        const cur = readVersion(slug, locale);
        if (cur !== baseVersion) throw new ConflictError(slug, cur, baseVersion);
      }
      const raw = adapter.serialize(page);
      adapter.writeDraftRaw(slug, raw, locale);
      const version = versionOf(raw);
      opts.onSaveDraft?.(slug, locale, version);
      return version;
    },

    discardDraft: (slug, locale) => adapter.deleteDraft(slug, locale),

    async publish(slug, baseVersion, locale = defaultLocale) {
      const raw = adapter.readDraftRaw(slug, locale);
      // No draft = nothing to publish. Don't rewrite the published file.
      if (raw === null) return;
      if (baseVersion !== undefined && versionOf(raw) !== baseVersion)
        throw new ConflictError(slug, versionOf(raw), baseVersion);
      adapter.writeRaw(slug, raw, locale);
      adapter.deleteDraft(slug, locale);
      await opts.onPublish?.(slug, locale);
    },

    createPage(slug, page, locale = defaultLocale) {
      if (adapter.exists(slug, locale)) throw new Error(`typren: page "${slug}" already exists`);
      adapter.writeRaw(slug, adapter.serialize(page), locale);
    },

    createTranslation(slug, fromLocale, toLocale) {
      if (adapter.exists(slug, toLocale) || adapter.hasDraft(slug, toLocale)) return;
      // Read of `fromLocale` throws if the source page is absent — a translation
      // is always of an existing page.
      const src = adapter.parse(adapter.readRaw(slug, fromLocale));
      adapter.writeDraftRaw(slug, adapter.serialize(src), toLocale); // draft, not published
    },

    deletePage(slug) {
      // Every locale (allowlist), so draft-only translations are cleaned too;
      // the adapter no-ops when a file is absent.
      for (const l of adapter.locales) {
        adapter.deletePublished(slug, l);
        adapter.deleteDraft(slug, l);
      }
    },

    deleteTranslation(slug, locale) {
      adapter.deletePublished(slug, locale);
      adapter.deleteDraft(slug, locale);
    },

    renamePage(slug, newSlug) {
      if (slug === newSlug) return; // ponytail: nothing to move, not a conflict on yourself
      // Check every locale before mutating any of them, so a collision found
      // on locale 2 of N can't leave a half-moved page on disk.
      for (const l of adapter.locales) {
        if (adapter.exists(newSlug, l) || adapter.hasDraft(newSlug, l)) throw new SlugExistsError(newSlug);
      }
      for (const l of adapter.locales) {
        if (adapter.exists(slug, l)) {
          adapter.writeRaw(newSlug, adapter.readRaw(slug, l), l);
          adapter.deletePublished(slug, l);
        }
        const draft = adapter.readDraftRaw(slug, l);
        if (draft !== null) {
          adapter.writeDraftRaw(newSlug, draft, l);
          adapter.deleteDraft(slug, l);
        }
      }
    },

    duplicatePage(slug, locale = defaultLocale) {
      const published = adapter.exists(slug, locale) ? adapter.readRaw(slug, locale) : null;
      const draft = adapter.readDraftRaw(slug, locale);
      if (published === null && draft === null) throw new Error(`typren: page "${slug}" does not exist`);

      // Same derive-and-bump scheme as the example in the task: "about" ->
      // "about-copy" -> "about-copy-2" -> ... First free slug wins.
      const base = slugify(`${slug}-copy`);
      let newSlug = base;
      for (let n = 2; adapter.exists(newSlug, locale) || adapter.hasDraft(newSlug, locale); n++) newSlug = `${base}-${n}`;

      // Copy BOTH tiers that exist: a duplicate is meant to be a faithful
      // clone of the source's current state, not just its last published
      // snapshot — dropping an in-progress draft silently would surprise
      // whoever is mid-edit on the source.
      if (published !== null) adapter.writeRaw(newSlug, published, locale);
      if (draft !== null) adapter.writeDraftRaw(newSlug, draft, locale);
      return newSlug;
    },
  };
}
