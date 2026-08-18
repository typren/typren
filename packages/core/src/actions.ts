import type { CmsConfig, PageContent } from "./types";
import { createStore, slugify } from "./store";
import { resolveAuth, type AuthAction } from "./auth-adapter";
import { ConflictError, SlugExistsError } from "./version";

/** Result of a version-checked write. A conflict is returned as data because Next
 *  redacts thrown error messages to an opaque digest in production, so a client
 *  couldn't read `e.message` to detect one. Auth denial still throws (fail loud). */
export type SaveResult =
  | { ok: true; version: string }
  | { ok: false; code: "conflict"; currentVersion: string | null };

/** Result of a rename. Same `{ok:false, code:"conflict"}` shape as `SaveResult`
 *  (reusing `saveResult()`'s 409 mapping in api/routes.ts) but no
 *  `currentVersion`: a rename conflict is a destination-slug collision, not a
 *  version race, so there is no version to report. */
export type RenameResult =
  | { ok: true; slug: string }
  | { ok: false; code: "conflict" };

/**
 * Build the mutation handlers for a config. Each guards on the resolved
 * `AuthAdapter` first, because a Server Action is a public POST endpoint, so the gate
 * lives here, not only in the UI (Next server-actions security model). The host
 * re-exports these from a `"use server"` module.
 *
 * Every handler takes an optional `locale` (defaults to the default locale, so
 * single-locale hosts are unchanged); it is threaded to the store alongside the
 * existing `baseVersion` optimistic lock. Locale does NOT displace baseVersion.
 */
export function makeActions(config: CmsConfig) {
  const store = createStore(config.adapter, {
    onPublish: config.onPublish,
    onSaveDraft: config.onSaveDraft,
    defaultLocale: config.adapter.defaultLocale,
  });
  const auth = resolveAuth(config); // throws early if the config is misconfigured
  const defaultLocale = config.adapter.defaultLocale;

  async function guard(action: AuthAction, slug?: string) {
    if (!(await auth.authorize({ action, slug }))) throw new Error("typren: unauthorized");
  }

  return {
    async saveDraft(
      slug: string,
      page: PageContent,
      baseVersion?: string,
      locale?: string
    ): Promise<SaveResult> {
      await guard("saveDraft", slug);
      try {
        return { ok: true, version: store.saveDraft(slug, page, baseVersion, locale) };
      } catch (e) {
        if (e instanceof ConflictError)
          return { ok: false, code: "conflict", currentVersion: e.currentVersion };
        throw e;
      }
    },
    async discardDraft(slug: string, locale?: string) {
      await guard("discardDraft", slug);
      store.discardDraft(slug, locale);
    },
    async publish(slug: string, baseVersion?: string, locale?: string): Promise<SaveResult> {
      await guard("publish", slug);
      try {
        await store.publish(slug, baseVersion, locale);
        return { ok: true, version: store.currentVersion(slug, locale) ?? "" };
      } catch (e) {
        if (e instanceof ConflictError)
          return { ok: false, code: "conflict", currentVersion: e.currentVersion };
        throw e;
      }
    },
    /** Create an empty page (in `locale`, default when omitted); returns the
     *  normalized slug for navigation. */
    async createPage(title: string, locale?: string): Promise<string> {
      await guard("createPage");
      const slug = slugify(title);
      if (!slug) throw new Error("typren: page name is required");
      store.createPage(slug, { meta: { title: title.trim() || slug }, slices: [], body: "" }, locale);
      return slug;
    },
    /** Rename (move) a page's slug across every locale it occupies. See
     *  `ContentStore.renamePage` for why this isn't locale-scoped like most
     *  actions here. `newSlug` is run through the same `slugify` as
     *  `createPage` so a caller passing free text still lands on a valid slug.
     *
     *  No `baseVersion` param: a rename doesn't race on CONTENT (it moves
     *  bytes, never edits them). It races on the DESTINATION SLUG, which
     *  `SlugExistsError` already guards (refuse rather than clobber). A
     *  client still holding the OLD slug's `baseVersion` after a rename lands
     *  gets a 404 on its next saveDraft/publish call (the file is gone) and
     *  has to reload: the same "your view is stale" outcome a version
     *  conflict gives, just via a different status than 409. */
    async renamePage(slug: string, newSlug: string): Promise<RenameResult> {
      await guard("renamePage", slug);
      const target = slugify(newSlug);
      if (!target) throw new Error("typren: new slug is required");
      try {
        store.renamePage(slug, target);
        return { ok: true, slug: target };
      } catch (e) {
        if (e instanceof SlugExistsError) return { ok: false, code: "conflict" };
        throw e;
      }
    },
    /** Duplicate a page under a new, auto-derived slug (`slugify`-based
     *  "-copy"/"-copy-2"/... suffix, same helper `createPage` uses, so
     *  derivation can't drift between the two). Copies BOTH the published
     *  content and any draft that exist on the source (see
     *  `ContentStore.duplicatePage` for the justification). Gated as a
     *  "createPage" action: a duplicate IS creating a new page, just seeded
     *  from an existing one, so it shares that permission rather than adding
     *  a distinct one. */
    async duplicatePage(slug: string, locale?: string): Promise<string> {
      await guard("createPage", slug);
      return store.duplicatePage(slug, locale);
    },
    /** Seed a draft translation of `slug` into `toLocale` from the default
     *  locale's published content. Gated as a draft write. */
    async createTranslation(slug: string, toLocale: string) {
      await guard("saveDraft", slug);
      store.createTranslation(slug, defaultLocale, toLocale);
    },
    async deletePage(slug: string) {
      await guard("deletePage", slug);
      store.deletePage(slug);
    },
    /** Delete a single translation (one locale) + its draft. */
    async deleteTranslation(slug: string, locale: string) {
      await guard("deletePage", slug);
      store.deleteTranslation(slug, locale);
    },
    async listMedia() {
      await guard("read");
      if (!config.mediaAdapter) throw new Error("typren: no mediaAdapter configured");
      return config.mediaAdapter.list();
    },
    async deleteMedia(id: string) {
      await guard("deleteMedia");
      if (!config.mediaAdapter) throw new Error("typren: no mediaAdapter configured");
      return config.mediaAdapter.delete(id);
    },
  };
}

export type CmsActions = ReturnType<typeof makeActions>;

/** The subset of `CmsActions` the page/site/media editor shells actually call
 *  (page CRUD + draft/publish, for PagesNav's create/delete-page controls and
 *  EditorShell's save flow). `listMedia`/`deleteMedia` are wired separately
 *  via each shell's `media` prop. Hosts pass a reconstructed literal here
 *  (see the scaffolded `app/editor/actions.ts`), not the real `makeActions()`
 *  object, so this must list only what's used, not the full action registry.
 *
 *  `renamePage`/`duplicatePage` are excluded for the same reason: no shipped
 *  UI shell calls them yet (this API landed ahead of its UI), so a required
 *  field here would force every host's hand-reconstructed literal to grow a
 *  stub before it typechecks. `TyprenClient` (see api/client.ts) still
 *  exposes both directly, the same way it already exposes reads/media/settings
 *  that also aren't part of this subset. Fold them into this Omit once a shell
 *  actually wires a rename/duplicate control. */
export type PageActions = Omit<CmsActions, "listMedia" | "deleteMedia" | "renamePage" | "duplicatePage">;
