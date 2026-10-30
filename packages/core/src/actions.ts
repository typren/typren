import type { CmsConfig, ContentAdapter, MediaAdapter, MediaAsset, MediaMove, MediaUse, PageContent, PageInfo, Slice } from "./types";
import { createStore, slugify } from "./store";
import { SITE_SLUG, linksTo, readMenu, relink, unlink } from "./nav";
import { resolveAuth, type AuthAction } from "./auth-adapter";
import { ConflictError, SlugExistsError } from "./version";
import { GIT_NO_BRANCH, GitError, type GitLogEntry, type GitPendingChange, type GitPushResult } from "./git";

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

/** A refusal written for the person who asked (a locked rename, a stale
 *  section insert), unlike the plain errors that carry internals. The HTTP
 *  API answers it as 422 with this message and no `typren:` prefix. */
export class ActionRefusedError extends Error {
  override name = "ActionRefusedError";
}

/** A page as the editor opens it: its draft, else its published content. */
export type OpenedPage = { page: PageContent; version: string | null; hasDraft: boolean };

/** Result of `uploadMedia`. A refused file (too large, an unsupported or
 *  disabled format) is data, its `error` written for the person uploading. */
export type UploadResult = { ok: true; asset: MediaAsset } | { ok: false; error: string };

/** What `updatePageMeta` can change. Text is trimmed; an empty description
 *  and a false `noindex` remove their keys. `nav` adds the page to, or
 *  removes it from, the site doc's menu draft. */
export type PageMetaPatch = { title?: string; nav?: boolean; noindex?: boolean; description?: string };

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
/** Rewrites each move's `from` URL to its `to` in every page's published and
 *  draft source, in every locale, plus the settings doc (a logo or share
 *  image), in one pass. A match must end at a URL boundary, so "/img/a.webp"
 *  leaves "/img/a.webp2" alone.
 *  ponytail: collections keep their own adapters and aren't rewritten; walk
 *  `config.sections` here once a collection field can hold media. */
export async function rewriteMediaRefs(adapter: ContentAdapter, moves: MediaMove[]): Promise<void> {
  if (!moves.length) return;
  const swap = mediaRefSwapper(moves);
  for (const locale of adapter.locales) {
    // "settings" is settings.ts's SETTINGS_SLUG; listSlugs leaves it out.
    for (const slug of new Set([...(await adapter.listSlugs(locale)), "settings"])) {
      if (await adapter.exists(slug, locale)) {
        const raw = await adapter.readRaw(slug, locale);
        const next = swap(raw);
        if (next !== raw) await adapter.writeRaw(slug, next, locale);
      }
      const draft = await adapter.readDraftRaw(slug, locale);
      const nextDraft = draft && swap(draft);
      if (draft && nextDraft !== draft) await adapter.writeDraftRaw(slug, nextDraft!, locale);
    }
  }
}

/** Every reference to each of `urls` in content, keyed by URL, matched on
 *  the same URL boundary as `rewriteMediaRefs`. A page counts its draft when
 *  it has one, since that is what the editor shows, else its published
 *  source.
 *  ponytail: reads every page per call; index on write once a site's page
 *  count makes the Assets list slow to open. */
export async function findMediaRefs(adapter: ContentAdapter, urls: string[]): Promise<Record<string, MediaUse[]>> {
  const uses: Record<string, MediaUse[]> = Object.fromEntries(urls.map((u) => [u, []]));
  if (!urls.length) return uses;
  const alternatives = urls.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?:${alternatives.join("|")})(?![\\w.-])`, "g");
  for (const locale of adapter.locales) {
    for (const slug of new Set([...(await adapter.listSlugs(locale)), "settings"])) {
      const raw =
        (await adapter.readDraftRaw(slug, locale)) ??
        ((await adapter.exists(slug, locale)) ? await adapter.readRaw(slug, locale) : "");
      const counts = new Map<string, number>();
      for (const [m] of raw.matchAll(pattern)) counts.set(m, (counts.get(m) ?? 0) + 1);
      for (const [url, count] of counts) uses[url]!.push({ slug, locale, count });
    }
  }
  return uses;
}

/** A function that applies every move to a source text. Exported for hosts
 *  that rewrite references outside content (the studio's site files). */
export function mediaRefSwapper(moves: MediaMove[]): (text: string) => string {
  const to = new Map(moves.map((m) => [m.from, m.to]));
  const alternatives = moves.map((m) => m.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?:${alternatives.join("|")})(?![\\w.-])`, "g");
  return (text) => text.replace(pattern, (m) => to.get(m) ?? m);
}

export function makeActions(config: CmsConfig, scope: { collectionId?: string } = {}) {
  const store = createStore(config.adapter, {
    onPublish: config.onPublish,
    onSaveDraft: config.onSaveDraft,
    defaultLocale: config.adapter.defaultLocale,
  });
  const auth = resolveAuth(config); // throws early if the config is misconfigured
  const defaultLocale = config.adapter.defaultLocale;
  // A collection has no home page, so a record slugged "home" is an ordinary one.
  const homeSlug = scope.collectionId === undefined ? (config.homeSlug ?? "home") : undefined;

  // An adapter whose draft write IS the live write (Notion) makes a draft
  // save a publish, so it must clear the publish tier, not just saveDraft.
  const draftAction: AuthAction = config.adapter.draftsWriteThrough ? "publish" : "saveDraft";

  async function guard(action: AuthAction, target: { slug?: string; locale?: string } = {}) {
    const ctx = { action, ...target, collectionId: scope.collectionId, siteId: config.siteId, accountId: config.accountId };
    if (!(await auth.authorize(ctx))) throw new Error("typren: unauthorized");
  }

  // A write the host may commit as one change (see `CmsConfig.withCommit`).
  const committed = <T>(message: string, write: () => Promise<T>) =>
    config.withCommit ? config.withCommit(message, write) : write();
  const where = (locale?: string) => (locale && locale !== defaultLocale ? ` (${locale})` : "");
  const gitOf = () => {
    if (!config.git) throw new Error("typren: this site isn't a git checkout, so there is nothing to push");
    return config.git;
  };

  // Unguarded: each caller guards for what it does with the page.
  async function readPage(slug: string, locale?: string): Promise<OpenedPage | null> {
    const published = await config.adapter.exists(slug, defaultLocale);
    // A draft-only page (never published) opens from its draft.
    if (!published && !(await config.adapter.hasDraft(slug, defaultLocale))) return null;
    const [draft, live, version] = await Promise.all([
      store.getDraft(slug, locale),
      published ? store.getPublished(slug, locale) : null,
      store.currentVersion(slug, locale),
    ]);
    return { page: (draft ?? live)!, version, hasDraft: Boolean(draft) };
  }

  async function save(slug: string, page: PageContent, baseVersion?: string, locale?: string): Promise<SaveResult> {
    try {
      return { ok: true, version: await store.saveDraft(slug, page, baseVersion, locale) };
    } catch (e) {
      if (e instanceof ConflictError) return { ok: false, code: "conflict", currentVersion: e.currentVersion };
      throw e;
    }
  }

  /** Points the site doc's menu, published and draft in every locale, away
   *  from page `from`: at `to` after a rename, or out of it after a delete.
   *  Guards each write and returns the writes to run (null: nothing links
   *  there), so a refusal comes before the page itself changes. */
  async function menuRepoint(from: string, to: string | null): Promise<(() => Promise<void>) | null> {
    if (scope.collectionId) return null;
    const { adapter } = config;
    const repoint = (raw: string) => {
      const doc = adapter.parse(raw);
      const menu = readMenu(doc.meta);
      if (!menu) return null;
      const nav = to ? relink(menu.nav, from, to) : unlink(menu.nav, from);
      const cta = menu.cta && (to ? relink([menu.cta], from, to)[0] : linksTo([menu.cta], from) ? undefined : menu.cta);
      if (JSON.stringify([nav, cta]) === JSON.stringify([menu.nav, menu.cta])) return null;
      const meta: Record<string, unknown> = { ...doc.meta, nav };
      if (cta) meta.cta = cta;
      else delete meta.cta;
      return adapter.serialize({ ...doc, meta });
    };
    const writes: (() => Promise<void>)[] = [];
    for (const locale of adapter.locales) {
      const live = (await adapter.exists(SITE_SLUG, locale)) ? repoint(await adapter.readRaw(SITE_SLUG, locale)) : null;
      if (live !== null) {
        await guard("publish", { slug: SITE_SLUG, locale });
        writes.push(() => adapter.writeRaw(SITE_SLUG, live, locale));
      }
      const draft = await adapter.readDraftRaw(SITE_SLUG, locale);
      const next = draft === null ? null : repoint(draft);
      if (next !== null) {
        await guard(draftAction, { slug: SITE_SLUG, locale });
        writes.push(() => adapter.writeDraftRaw(SITE_SLUG, next, locale));
      }
    }
    if (!writes.length) return null;
    return async () => {
      for (const write of writes) await write();
    };
  }

  async function rewriteAll(moves: MediaMove[]) {
    if (!moves.length) return;
    await rewriteMediaRefs(config.adapter, moves);
    await config.onMediaMove?.(moves);
  }

  const actions = {
    /** Every page in `locale` for the page list (see `ContentStore.listPages`). */
    async listPages(locale?: string): Promise<PageInfo[]> {
      await guard("read", { locale });
      return store.listPages(locale);
    },
    /** A page as the editor opens it, or null when it has neither published
     *  content nor a draft in the default locale. */
    async getPage(slug: string, locale?: string): Promise<OpenedPage | null> {
      await guard("read", { slug, locale });
      return readPage(slug, locale);
    },
    /** Page folders kept without pages (see `ContentAdapter.listFolders`). */
    async listPageFolders(locale?: string): Promise<string[]> {
      await guard("read", { locale });
      return (await config.adapter.listFolders?.(locale)) ?? [];
    },
    async saveDraft(
      slug: string,
      page: PageContent,
      baseVersion?: string,
      locale?: string
    ): Promise<SaveResult> {
      await guard(draftAction, { slug, locale });
      return save(slug, page, baseVersion, locale);
    },
    async discardDraft(slug: string, locale?: string) {
      await guard("discardDraft", { slug, locale });
      await store.discardDraft(slug, locale);
    },
    async publish(slug: string, baseVersion?: string, locale?: string): Promise<SaveResult> {
      await guard("publish", { slug, locale });
      // A git-backed publish commits from onPublish (collections and settings
      // clear it, so they skip this). With no branch that commit would land on
      // a detached HEAD, so refuse before the file move and keep the draft.
      if (config.git && config.onPublish && !(await config.git.outgoing()).branch) throw new GitError(GIT_NO_BRANCH);
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
     *  normalized slug for navigation. `opts.slug` places it at an explicit,
     *  possibly nested slug (`event/1`) instead of one derived from the title;
     *  it is passed through as-is, so the adapter's slug guard is what rejects
     *  a bad one. `opts.draft` creates it as a draft only. */
    async createPage(title: string, locale?: string, opts: { slug?: string; draft?: boolean } = {}): Promise<string> {
      const slug = opts.slug ?? slugify(title);
      await guard("createPage", { slug, locale });
      if (!slug) throw new Error("typren: page name is required");
      const create = () =>
        store.createPage(slug, { meta: { title: title.trim() || slug }, slices: [], body: "" }, locale, { draft: opts.draft });
      // A draft is working state; only a published page commits.
      await (opts.draft ? create() : committed(`content: create ${slug}${where(locale)}`, create));
      return slug;
    },
    /** Creates a draft page at `slug` holding `slices`: an empty draft first,
     *  then a save against the version it was made at, so a page changed in
     *  between is a conflict, not overwritten. Resolves to the stored slug. */
    async createPageFrom(title: string, slug: string, slices: Slice[], locale?: string): Promise<string> {
      const created = await actions.createPage(title, locale, { slug, draft: true });
      if (!slices.length) return created;
      await guard(draftAction, { slug: created, locale });
      const opened = await readPage(created, locale);
      const result = await save(created, { ...opened!.page, slices }, opened!.version ?? undefined, locale);
      if (!result.ok) throw new ActionRefusedError("The page changed before its sections were added. Open it and add them there.");
      return created;
    },
    /** Inserts `slice` into a page's draft at index `at` (clamped), or at the
     *  end; a conflict when the page moved on from `baseVersion`. */
    async insertSection(slug: string, slice: Slice, at: number | "end", baseVersion?: string, locale?: string): Promise<SaveResult> {
      await guard(draftAction, { slug, locale });
      const opened = await readPage(slug, locale);
      if (!opened) throw new ActionRefusedError(`The page "${slug}" does not exist.`);
      const slices = [...opened.page.slices];
      slices.splice(at === "end" ? slices.length : Math.min(at, slices.length), 0, slice);
      return save(slug, { ...opened.page, slices }, baseVersion, locale);
    },
    /** Changes a page's title, search visibility, description and place in
     *  the menu, as drafts: the page's own front matter at `baseVersion`, and
     *  the site doc's menu only when `nav` differs from it. A site whose menu
     *  lives in its code (no site doc menu) refuses `nav`. */
    async updatePageMeta(slug: string, patch: PageMetaPatch, baseVersion?: string, locale?: string): Promise<SaveResult> {
      await guard(draftAction, { slug, locale });
      const opened = await readPage(slug, locale);
      if (!opened) throw new ActionRefusedError(`The page "${slug}" does not exist.`);
      const meta = { ...opened.page.meta };
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new ActionRefusedError("A page needs a title.");
        meta.title = patch.title.trim();
      }
      if (patch.noindex) meta.noindex = true;
      else if (patch.noindex === false) delete meta.noindex;
      if (patch.description?.trim()) meta.description = patch.description.trim();
      else if (patch.description !== undefined) delete meta.description;
      let result: SaveResult = { ok: true, version: opened.version ?? "" };
      if (JSON.stringify(meta) !== JSON.stringify(opened.page.meta))
        result = await save(slug, { ...opened.page, meta }, baseVersion, locale);
      if (!result.ok || patch.nav === undefined) return result;

      await guard(draftAction, { slug: SITE_SLUG, locale });
      const site = await readPage(SITE_SLUG, locale);
      const menu = site && readMenu(site.page.meta);
      if (!site || !menu) throw new ActionRefusedError("This site's menu is built in its code, so pages can't be added to it here.");
      const path = slug === homeSlug ? "/" : `/${slug}`;
      if (linksTo(menu.nav, path) === patch.nav) return result;
      const label = typeof meta.title === "string" ? meta.title : slug;
      const nav = patch.nav ? [...menu.nav, { label, href: path }] : unlink(menu.nav, path);
      const saved = await save(SITE_SLUG, { ...site.page, meta: { ...site.page.meta, nav } }, site.version ?? undefined, locale);
      return saved.ok ? result : saved;
    },
    /** Save: writes `page` as the draft when given, then publishes it. With
     *  `config.git` the commit comes from `onPublish`. */
    async commitPage(slug: string, page?: PageContent, baseVersion?: string, locale?: string): Promise<SaveResult> {
      if (!page) return actions.publish(slug, baseVersion, locale);
      const saved = await actions.saveDraft(slug, page, baseVersion, locale);
      return saved.ok ? actions.publish(slug, saved.version, locale) : saved;
    },
    /** Publishes every page with a draft in `locale`, and the site doc's
     *  menu draft, each at its current draft (last write wins). Resolves to
     *  the slugs published. */
    async publishAll(locale?: string): Promise<string[]> {
      const drafted = (await actions.listPages(locale)).filter((p) => p.hasDraft).map((p) => p.slug);
      if (await config.adapter.hasDraft(SITE_SLUG, locale ?? defaultLocale)) drafted.push(SITE_SLUG);
      for (const slug of drafted) await actions.publish(slug, undefined, locale);
      return drafted;
    },
    /** Pushes the local checkout's commits to its upstream. A push ships
     *  every pending commit live, so it clears the publish tier. */
    async push(): Promise<GitPushResult> {
      await guard("publish");
      return gitOf().push();
    },
    /** Files with saved changes the upstream lacks: the Review list. */
    async pendingChanges(): Promise<GitPendingChange[]> {
      await guard("read");
      return gitOf().pending();
    },
    /** Pushes only these files' saved changes (see `GitRepo.pushPaths`),
     *  and these pages' drafts: each draft is published first, one local
     *  commit per page, so it goes out as one commit per page. A draft whose
     *  publish commits nothing (it matches the page) adds nothing. `more`
     *  publishes other drafts the same way (the settings doc's). */
    async pushChanges(
      paths: string[],
      slugs: string[] = [],
      locale?: string,
      more: (() => Promise<unknown>)[] = []
    ): Promise<GitPushResult> {
      await guard("publish");
      const git = gitOf();
      const files = new Set(paths);
      // No base version, so none of these can conflict.
      for (const publish of [...slugs.map((slug) => () => actions.publish(slug, undefined, locale)), ...more]) {
        const before = (await git.outgoing()).commits[0]?.hash;
        await publish();
        const [made] = (await git.outgoing()).commits;
        if (made && made.hash !== before) made.files.forEach((f) => files.add(f));
      }
      return files.size ? git.pushPaths([...files]) : { ok: true };
    },
    /** A page's version history: the commits that touched its file in
     *  `locale`, newest first. Needs `config.git` and an adapter that keeps
     *  pages in files (`pageFile`); the adapter checks the slug and the repo
     *  keeps the read inside the content roots. */
    async pageHistory(slug: string, locale?: string, limit?: number): Promise<GitLogEntry[]> {
      await guard("read", { slug, locale });
      const fileOf = (config.adapter as { pageFile?: (slug: string, locale?: string) => string }).pageFile;
      if (!fileOf) return [];
      return gitOf().history(fileOf(slug, locale), limit);
    },
    /** Undoes these files' saved changes in a new commit (see
     *  `GitRepo.discardPaths`). It changes what the next push ships, so it
     *  clears the publish tier. */
    async discardChanges(paths: string[]): Promise<void> {
      await guard("publish");
      await gitOf().discardPaths(paths);
    },
    /** Validates and web-optimizes an upload (see `processUpload`), then
     *  stores it in `folder`. */
    async uploadMedia(file: { name: string; buffer: Buffer }, folder?: string): Promise<UploadResult> {
      await guard("uploadMedia");
      const media = config.mediaAdapter;
      if (!media) throw new Error("typren: no mediaAdapter configured");
      // Loaded here, not at the top: sharp and jsdom stay out of the many
      // imports of this module that never upload (settings, SEO).
      const { processUpload } = await import("./media");
      const prepared = await processUpload(file, { allowSvg: config.allowSvg }).catch((e: unknown) =>
        e instanceof Error ? e : new Error(String(e))
      );
      // processUpload's own errors are written for the person uploading.
      if (prepared instanceof Error) return { ok: false, error: prepared.message };
      const upload = () => media.upload(prepared, folder);
      return { ok: true, asset: await committed(`media: upload ${prepared.name}`, upload) };
    },
    /** Keep a page folder with no page in it yet (see
     *  `ContentAdapter.createFolder`). Gated like creating a page there. */
    async createPageFolder(folder: string, locale?: string) {
      await guard("createPage", { slug: folder, locale });
      if (!config.adapter.createFolder) throw new Error("typren: this content adapter has no folders");
      await config.adapter.createFolder(folder, locale);
    },
    /** Remove an empty page folder; the adapter refuses one that holds pages.
     *  Gated like deleting a page there. */
    async deletePageFolder(folder: string, locale?: string) {
      await guard("deletePage", { slug: folder, locale });
      if (!config.adapter.deleteFolder) throw new Error("typren: this content adapter has no folders");
      await config.adapter.deleteFolder(folder, locale);
    },
    /** Rename (move) a page's slug across every locale it occupies. See
     *  `ContentStore.renamePage` for why this isn't locale-scoped like most
     *  actions here. Each "/" segment of `newSlug` is run through the same
     *  `slugify` as `createPage`, so a caller passing free text still lands on
     *  a valid slug and a nested page (`event/1`) keeps its folder.
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
      const target = newSlug.split("/").map(slugify).filter(Boolean).join("/");
      if (!target) throw new Error("typren: new slug is required");
      await guard("renamePage", { slug: target });
      if (target === slug) return { ok: true, slug };
      // The site links home at "/" and child pages by their full path.
      if (slug === homeSlug) throw new ActionRefusedError("The home page keeps its slug.");
      const slugs = [...(await config.adapter.listSlugs()), ...((await config.adapter.listDraftSlugs?.()) ?? [])];
      if (slugs.some((s) => s.startsWith(`${slug}/`)))
        throw new ActionRefusedError(`Move the pages under "${slug}" first, then rename it.`);
      // Same detached-HEAD refusal as publish, before any file moves.
      if (config.git && config.onRename && !(await config.git.outgoing()).branch) throw new GitError(GIT_NO_BRANCH);
      const relinkMenu = await menuRepoint(`/${slug}`, `/${target}`);
      try {
        await store.renamePage(slug, target);
        try {
          await config.onRename?.(slug, target);
        } catch (e) {
          // Move it back, so the files on disk match what the hook recorded.
          await store.renamePage(target, slug);
          throw e;
        }
        // ponytail: a commit of its own after the rename's, since onRename
        // commits only the moved files; fold it in if onRename ever takes extra paths.
        if (relinkMenu) await committed(`content: update menu links to ${target}`, relinkMenu);
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
     *  authorized, the destination before anything is written, and so is a
     *  read of the source, since the copy exposes it. */
    async duplicatePage(slug: string, locale?: string): Promise<string> {
      await guard("read", { slug, locale });
      await guard("createPage", { slug, locale });
      return committed(`content: duplicate ${slug}${where(locale)}`, () =>
        store.duplicatePage(slug, locale, (newSlug) => guard("createPage", { slug: newSlug, locale }))
      );
    },
    /** Seed a draft translation of `slug` into `toLocale` from the default
     *  locale's published content. Gated as a read of that source and a
     *  draft write to `toLocale`. */
    async createTranslation(slug: string, toLocale: string) {
      await guard("read", { slug, locale: defaultLocale });
      await guard(draftAction, { slug, locale: toLocale });
      await store.createTranslation(slug, defaultLocale, toLocale);
    },
    async deletePage(slug: string) {
      await guard("deletePage", { slug });
      // The site links home at "/", so it stays; rename refuses it the same way.
      if (slug === homeSlug) throw new ActionRefusedError("The home page can't be deleted.");
      const { adapter } = config;
      const found = await Promise.all(adapter.locales.map(async (l) => (await adapter.exists(slug, l)) || adapter.hasDraft(slug, l)));
      if (!found.some(Boolean)) throw new ActionRefusedError(`The page "${slug}" does not exist.`);
      const unlinkMenu = await menuRepoint(`/${slug}`, null);
      await committed(`content: delete ${slug}`, async () => {
        await store.deletePage(slug);
        await unlinkMenu?.();
      });
    },
    /** Delete a single translation (one locale) + its draft. */
    async deleteTranslation(slug: string, locale: string) {
      await guard("deletePage", { slug, locale });
      await committed(`content: delete ${slug}${where(locale)}`, () => store.deleteTranslation(slug, locale));
    },
    async listMedia() {
      await guard("read");
      if (!config.mediaAdapter) throw new Error("typren: no mediaAdapter configured");
      return config.mediaAdapter.list();
    },
    /** Deletes an asset. One that content still uses is refused, naming the
     *  pages, unless `opts.force`; `mediaUsage` lets a UI warn first. */
    async deleteMedia(id: string, opts: { force?: boolean } = {}) {
      await guard("deleteMedia");
      const media = config.mediaAdapter;
      if (!media) throw new Error("typren: no mediaAdapter configured");
      const asset = opts.force ? undefined : (await media.list()).find((a) => a.id === id);
      if (asset) {
        await guard("read");
        const uses = (await findMediaRefs(config.adapter, [asset.url]))[asset.url]!;
        const pages = [...new Set(uses.map((u) => (u.locale === defaultLocale ? u.slug : `${u.slug} (${u.locale})`)))];
        if (pages.length)
          throw new ActionRefusedError(`"${id}" is used on ${pages.join(", ")}. Remove it there first, or delete it anyway.`);
      }
      await committed(`media: delete ${id}`, () => media.delete(id));
    },
    /** Where each asset is referenced in content, keyed by asset URL. */
    async mediaUsage(): Promise<Record<string, MediaUse[]>> {
      await guard("read");
      if (!config.mediaAdapter) throw new Error("typren: no mediaAdapter configured");
      return findMediaRefs(config.adapter, (await config.mediaAdapter.list()).map((a) => a.url));
    },
    /** Folders under the media root; [] for an adapter without folders. */
    async listMediaFolders(): Promise<string[]> {
      await guard("read");
      return (await config.mediaAdapter?.listFolders?.()) ?? [];
    },
    /** Folder writes reuse the media actions: making a folder is gated like an
     *  upload, removing one like a delete. */
    async createMediaFolder(folder: string) {
      await guard("uploadMedia");
      await foldersOf(config.mediaAdapter).createFolder(folder);
    },
    async deleteMediaFolder(folder: string) {
      await guard("deleteMedia");
      await foldersOf(config.mediaAdapter).deleteFolder(folder);
    },
    /** Moves an asset, then points every reference at its new URL: content
     *  through the content adapter, anything else through `onMediaMove`.
     *  A move both adds and removes a file, so it needs both media actions,
     *  and it rewrites live pages and changes a live URL, so it is a publish too. */
    async moveMedia(id: string, folder: string, name?: string) {
      await guard("uploadMedia");
      await guard("deleteMedia");
      await guard("publish");
      const media = foldersOf(config.mediaAdapter);
      return committed(`media: move ${id}`, async () => {
        const { from, to } = await media.move(id, folder, name);
        if (from !== to.url) await rewriteAll([{ from, to: to.url }]);
        return to;
      });
    },
    /** Renames or moves a folder, with every asset in it, the same way. */
    async renameMediaFolder(folder: string, to: string) {
      await guard("uploadMedia");
      await guard("deleteMedia");
      await guard("publish");
      const media = foldersOf(config.mediaAdapter);
      await committed(`media: move folder ${folder} to ${to}`, async () => rewriteAll(await media.renameFolder(folder, to)));
    },
  };
  return actions;
}

function foldersOf(media: MediaAdapter | undefined): Required<MediaAdapter> {
  if (!media) throw new Error("typren: no mediaAdapter configured");
  if (!media.move) throw new Error("typren: this media adapter has no folders");
  return media as Required<MediaAdapter>;
}

export type CmsActions = ReturnType<typeof makeActions>;

/** The subset of `CmsActions` the page/site/media editor shells actually call
 *  (page CRUD + draft/publish, for the Pages rail's create/delete-page controls
 *  and PageEditor's save flow). `listMedia`/`deleteMedia` are wired separately
 *  via each shell's `media` prop. Hosts mounting `@typren/studio` pass a
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
 *  actually wires a rename/duplicate control. The reads and whole flows
 *  (`getPage` to `uploadMedia`) are left out the same way, until a shell
 *  calls them through its host. */
/** The whole-flow actions the editor calls through its host (the HTTP
 *  client has them all), kept apart from `PageActions` so a collection's
 *  actions and a host's hand-built literal don't owe them. */
export type PageFlows = Pick<CmsActions, "createPageFrom" | "insertSection" | "updatePageMeta" | "commitPage" | "publishAll">;

export type PageActions = Omit<
  CmsActions,
  | "listPages"
  | "getPage"
  | "listPageFolders"
  | "createPageFrom"
  | "insertSection"
  | "updatePageMeta"
  | "commitPage"
  | "publishAll"
  | "push"
  | "pendingChanges"
  | "pushChanges"
  | "pageHistory"
  | "discardChanges"
  | "uploadMedia"
  | "listMedia"
  | "deleteMedia"
  | "listMediaFolders"
  | "mediaUsage"
  | "createMediaFolder"
  | "deleteMediaFolder"
  | "moveMedia"
  | "renameMediaFolder"
  | "renamePage"
  | "duplicatePage"
  | "createPageFolder"
  | "deletePageFolder"
>;
