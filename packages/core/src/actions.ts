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
 *
 * `scope.collectionId` marks these as a collection section's actions (see
 * collection.ts); every guard forwards it with the target slug and locale, so
 * a policy keyed on any of them gates writes exactly as it gates reads.
 */
export function makeActions(config: CmsConfig, scope: { collectionId?: string } = {}) {
  const store = createStore(config.adapter, {
    onPublish: config.onPublish,
    onSaveDraft: config.onSaveDraft,
    defaultLocale: config.adapter.defaultLocale,
  });
  const auth = resolveAuth(config); // throws early if the config is misconfigured
  const defaultLocale = config.adapter.defaultLocale;

  // An adapter whose draft write IS the live write (Notion) makes a draft
  // save a publish, so it must clear the publish tier, not just saveDraft.
  const draftAction: AuthAction = config.adapter.draftsWriteThrough ? "publish" : "saveDraft";

  async function guard(action: AuthAction, target: { slug?: string; locale?: string } = {}) {
    const ctx = { action, ...target, collectionId: scope.collectionId, siteId: config.siteId, accountId: config.accountId };
    if (!(await auth.authorize(ctx))) throw new Error("typren: unauthorized");
  }

  return {
    async saveDraft(
      slug: string,
      page: PageContent,
      baseVersion?: string,
      locale?: string
    ): Promise<SaveResult> {
      await guard(draftAction, { slug, locale });
      try {
        return { ok: true, version: await store.saveDraft(slug, page, baseVersion, locale) };
      } catch (e) {
        if (e instanceof ConflictError)
          return { ok: false, code: "conflict", currentVersion: e.currentVersion };
        throw e;
      }
    },
    async discardDraft(slug: string, locale?: string) {
      await guard("discardDraft", { slug, locale });
      await store.discardDraft(slug, locale);
    },
    async publish(slug: string, baseVersion?: string, locale?: string): Promise<SaveResult> {
      await guard("publish", { slug, locale });
      try {
        await store.publish(slug, baseVersion, locale);
        return { ok: true, version: (await store.currentVersion(slug, locale)) ?? "" };
      } catch (e) {
        if (e instanceof ConflictError)
          return { ok: false, code: "conflict", currentVersion: e.currentVersion };
        throw e;
      }
    },
    /** Create an empty page (in `locale`, default when omitted); returns the
     *  normalized slug for navigation. */
    async createPage(title: string, locale?: string): Promise<string> {
      const slug = slugify(title);
      await guard("createPage", { slug, locale });
      if (!slug) throw new Error("typren: page name is required");
      await store.createPage(slug, { meta: { title: title.trim() || slug }, slices: [], body: "" }, locale);
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
     *  conflict gives, just via a different status than 409.
     *
     *  Authorized on both ends: a per-slug policy must be able to protect
     *  the page being moved and a reserved destination slug. */
    async renamePage(slug: string, newSlug: string): Promise<RenameResult> {
      await guard("renamePage", { slug });
      const target = slugify(newSlug);
      if (!target) throw new Error("typren: new slug is required");
      await guard("renamePage", { slug: target });
      try {
        await store.renamePage(slug, target);
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
     *  a distinct one. Both the source and the derived destination slug are
     *  authorized, the destination before anything is written. */
    async duplicatePage(slug: string, locale?: string): Promise<string> {
      await guard("createPage", { slug, locale });
      return store.duplicatePage(slug, locale, (newSlug) => guard("createPage", { slug: newSlug, locale }));
    },
    /** Seed a draft translation of `slug` into `toLocale` from the default
     *  locale's published content. Gated as a draft write to `toLocale`. */
    async createTranslation(slug: string, toLocale: string) {
      await guard(draftAction, { slug, locale: toLocale });
      await store.createTranslation(slug, defaultLocale, toLocale);
    },
    async deletePage(slug: string) {
      await guard("deletePage", { slug });
      await store.deletePage(slug);
    },
    /** Delete a single translation (one locale) + its draft. */
    async deleteTranslation(slug: string, locale: string) {
      await guard("deletePage", { slug, locale });
      await store.deleteTranslation(slug, locale);
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
 *  via each shell's `media` prop. Hosts mounting `@typren/editor` pass a
 *  reconstructed literal here, assembled in their own editor wiring (the CLI
 *  scaffold no longer emits one), not the real `makeActions()` object, so
 *  this must list only what's used, not the full action registry.
 *
 *  `renamePage`/`duplicatePage` are excluded for the same reason: no shipped
 *  UI shell calls them yet (this API landed ahead of its UI), so a required
 *  field here would force every host's hand-reconstructed literal to grow a
 *  stub before it typechecks. `TyprenClient` (see api/client.ts) still
 *  exposes both directly, the same way it already exposes reads/media/settings
 *  that also aren't part of this subset. Fold them into this Omit once a shell
 *  actually wires a rename/duplicate control. */
export type PageActions = Omit<CmsActions, "listMedia" | "deleteMedia" | "renamePage" | "duplicatePage">;
