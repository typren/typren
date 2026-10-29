// ---- dist/actions.d.ts ----
import type { CmsConfig, ContentAdapter, MediaAsset, MediaMove, MediaUse, PageContent, PageInfo, Slice } from "./types.js";
import { type GitLogEntry, type GitPendingChange, type GitPushResult } from "./git.js";
/** Result of a version-checked write. A conflict is returned as data because Next
 *  redacts thrown error messages to an opaque digest in production, so a client
 *  couldn't read `e.message` to detect one. Auth denial still throws (fail loud). */
export type SaveResult = {
    ok: true;
    version: string;
} | {
    ok: false;
    code: "conflict";
    currentVersion: string | null;
};
/** Result of a rename. Same `{ok:false, code:"conflict"}` shape as `SaveResult`
 *  (reusing `saveResult()`'s 409 mapping in api/routes.ts) but no
 *  `currentVersion`: a rename conflict is a destination-slug collision, not a
 *  version race, so there is no version to report. */
export type RenameResult = {
    ok: true;
    slug: string;
} | {
    ok: false;
    code: "conflict";
};
/** A refusal written for the person who asked (a locked rename, a stale
 *  section insert), unlike the plain errors that carry internals. The HTTP
 *  API answers it as 422 with this message and no `typren:` prefix. */
export declare class ActionRefusedError extends Error {
    name: string;
}
/** A page as the editor opens it: its draft, else its published content. */
export type OpenedPage = {
    page: PageContent;
    version: string | null;
    hasDraft: boolean;
};
/** Result of `uploadMedia`. A refused file (too large, an unsupported or
 *  disabled format) is data, its `error` written for the person uploading. */
export type UploadResult = {
    ok: true;
    asset: MediaAsset;
} | {
    ok: false;
    error: string;
};
/** What `updatePageMeta` can change. Text is trimmed; an empty description
 *  and a false `noindex` remove their keys. `nav` adds the page to, or
 *  removes it from, the site doc's menu draft. */
export type PageMetaPatch = {
    title?: string;
    nav?: boolean;
    noindex?: boolean;
    description?: string;
};
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
export declare function rewriteMediaRefs(adapter: ContentAdapter, moves: MediaMove[]): Promise<void>;
/** Every reference to each of `urls` in content, keyed by URL, matched on
 *  the same URL boundary as `rewriteMediaRefs`. A page counts its draft when
 *  it has one, since that is what the editor shows, else its published
 *  source.
 *  ponytail: reads every page per call; index on write once a site's page
 *  count makes the Assets list slow to open. */
export declare function findMediaRefs(adapter: ContentAdapter, urls: string[]): Promise<Record<string, MediaUse[]>>;
/** A function that applies every move to a source text. Exported for hosts
 *  that rewrite references outside content (the studio's site files). */
export declare function mediaRefSwapper(moves: MediaMove[]): (text: string) => string;
export declare function makeActions(config: CmsConfig, scope?: {
    collectionId?: string;
}): {
    /** Every page in `locale` for the page list (see `ContentStore.listPages`). */
    listPages(locale?: string): Promise<PageInfo[]>;
    /** A page as the editor opens it, or null when it has neither published
     *  content nor a draft in the default locale. */
    getPage(slug: string, locale?: string): Promise<OpenedPage | null>;
    /** Page folders kept without pages (see `ContentAdapter.listFolders`). */
    listPageFolders(locale?: string): Promise<string[]>;
    saveDraft(slug: string, page: PageContent, baseVersion?: string, locale?: string): Promise<SaveResult>;
    discardDraft(slug: string, locale?: string): Promise<void>;
    publish(slug: string, baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Create an empty page (in `locale`, default when omitted); returns the
     *  normalized slug for navigation. `opts.slug` places it at an explicit,
     *  possibly nested slug (`event/1`) instead of one derived from the title;
     *  it is passed through as-is, so the adapter's slug guard is what rejects
     *  a bad one. `opts.draft` creates it as a draft only. */
    createPage(title: string, locale?: string, opts?: {
        slug?: string;
        draft?: boolean;
    }): Promise<string>;
    /** Creates a draft page at `slug` holding `slices`: an empty draft first,
     *  then a save against the version it was made at, so a page changed in
     *  between is a conflict, not overwritten. Resolves to the stored slug. */
    createPageFrom(title: string, slug: string, slices: Slice[], locale?: string): Promise<string>;
    /** Inserts `slice` into a page's draft at index `at` (clamped), or at the
     *  end; a conflict when the page moved on from `baseVersion`. */
    insertSection(slug: string, slice: Slice, at: number | "end", baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Changes a page's title, search visibility, description and place in
     *  the menu, as drafts: the page's own front matter at `baseVersion`, and
     *  the site doc's menu only when `nav` differs from it. A site whose menu
     *  lives in its code (no site doc menu) refuses `nav`. */
    updatePageMeta(slug: string, patch: PageMetaPatch, baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Save: writes `page` as the draft when given, then publishes it. With
     *  `config.git` the commit comes from `onPublish`. */
    commitPage(slug: string, page?: PageContent, baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Publishes every page with a draft in `locale`, and the site doc's
     *  menu draft, each at its current draft (last write wins). Resolves to
     *  the slugs published. */
    publishAll(locale?: string): Promise<string[]>;
    /** Pushes the local checkout's commits to its upstream. A push ships
     *  every pending commit live, so it clears the publish tier. */
    push(): Promise<GitPushResult>;
    /** Files with saved changes the upstream lacks: the Review list. */
    pendingChanges(): Promise<GitPendingChange[]>;
    /** Pushes only these files' saved changes (see `GitRepo.pushPaths`),
     *  and these pages' drafts: each draft is published first, one local
     *  commit per page, so it goes out as one commit per page. A draft whose
     *  publish commits nothing (it matches the page) adds nothing. `more`
     *  publishes other drafts the same way (the settings doc's). */
    pushChanges(paths: string[], slugs?: string[], locale?: string, more?: (() => Promise<unknown>)[]): Promise<GitPushResult>;
    /** A page's version history: the commits that touched its file in
     *  `locale`, newest first. Needs `config.git` and an adapter that keeps
     *  pages in files (`pageFile`); the adapter checks the slug and the repo
     *  keeps the read inside the content roots. */
    pageHistory(slug: string, locale?: string, limit?: number): Promise<GitLogEntry[]>;
    /** Undoes these files' saved changes in a new commit (see
     *  `GitRepo.discardPaths`). It changes what the next push ships, so it
     *  clears the publish tier. */
    discardChanges(paths: string[]): Promise<void>;
    /** Validates and web-optimizes an upload (see `processUpload`), then
     *  stores it in `folder`. */
    uploadMedia(file: {
        name: string;
        buffer: Buffer;
    }, folder?: string): Promise<UploadResult>;
    /** Keep a page folder with no page in it yet (see
     *  `ContentAdapter.createFolder`). Gated like creating a page there. */
    createPageFolder(folder: string, locale?: string): Promise<void>;
    /** Remove an empty page folder; the adapter refuses one that holds pages.
     *  Gated like deleting a page there. */
    deletePageFolder(folder: string, locale?: string): Promise<void>;
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
    renamePage(slug: string, newSlug: string): Promise<RenameResult>;
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
    duplicatePage(slug: string, locale?: string): Promise<string>;
    /** Seed a draft translation of `slug` into `toLocale` from the default
     *  locale's published content. Gated as a read of that source and a
     *  draft write to `toLocale`. */
    createTranslation(slug: string, toLocale: string): Promise<void>;
    deletePage(slug: string): Promise<void>;
    /** Delete a single translation (one locale) + its draft. */
    deleteTranslation(slug: string, locale: string): Promise<void>;
    listMedia(): Promise<MediaAsset[]>;
    /** Deletes an asset. One that content still uses is refused, naming the
     *  pages, unless `opts.force`; `mediaUsage` lets a UI warn first. */
    deleteMedia(id: string, opts?: {
        force?: boolean;
    }): Promise<void>;
    /** Where each asset is referenced in content, keyed by asset URL. */
    mediaUsage(): Promise<Record<string, MediaUse[]>>;
    /** Folders under the media root; [] for an adapter without folders. */
    listMediaFolders(): Promise<string[]>;
    /** Folder writes reuse the media actions: making a folder is gated like an
     *  upload, removing one like a delete. */
    createMediaFolder(folder: string): Promise<void>;
    deleteMediaFolder(folder: string): Promise<void>;
    /** Moves an asset, then points every reference at its new URL: content
     *  through the content adapter, anything else through `onMediaMove`.
     *  A move both adds and removes a file, so it needs both media actions,
     *  and it rewrites live pages and changes a live URL, so it is a publish too. */
    moveMedia(id: string, folder: string, name?: string): Promise<MediaAsset>;
    /** Renames or moves a folder, with every asset in it, the same way. */
    renameMediaFolder(folder: string, to: string): Promise<void>;
};
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
export type PageActions = Omit<CmsActions, "listPages" | "getPage" | "listPageFolders" | "createPageFrom" | "insertSection" | "updatePageMeta" | "commitPage" | "publishAll" | "push" | "pendingChanges" | "pushChanges" | "pageHistory" | "discardChanges" | "uploadMedia" | "listMedia" | "deleteMedia" | "listMediaFolders" | "mediaUsage" | "createMediaFolder" | "deleteMediaFolder" | "moveMedia" | "renameMediaFolder" | "renamePage" | "duplicatePage" | "createPageFolder" | "deletePageFolder">;

// ---- dist/api/client.d.ts ----
import type { PageActions, PageFlows, RenameResult, SaveResult } from "../actions.js";
import type { CollectionRecordInfo, MediaAsset, MediaUse, PageContent, PageInfo } from "../types.js";
import type { SiteSettings, SiteSettingsBootstrap, SiteSettingsRuntime } from "../settings.js";
import type { GitLogEntry, GitOutgoing, GitPendingChange } from "../git.js";
import type { FolderedLibrary } from "../library.js";
/**
 * Typed client for the editor's HTTP API (./routes).
 *
 * The important property: the returned object satisfies `PageActions`, the same
 * shape the UI already consumes via `SectionCtx.actions`. So switching a host
 * from injected Server Actions to HTTP is a one-line change at the wiring site,
 * with no edits to any component.
 *
 * Browser-safe: `fetch` only, no node imports, no framework.
 */
export interface TyprenClientOptions {
    /** Where the API is mounted, e.g. "/api/typren" or an absolute URL. */
    baseUrl: string;
    /** Injectable for tests / non-browser runtimes. Defaults to global fetch. */
    fetch?: typeof globalThis.fetch;
    /** Merged into every request: auth headers for a token-authenticated host. */
    headers?: Record<string, string>;
}
export interface TyprenClient extends PageActions, PageFlows {
    listPages(locale?: string): Promise<PageInfo[]>;
    getPage(slug: string, locale?: string): Promise<{
        page: PageContent;
        version: string | null;
        hasDraft: boolean;
    }>;
    renamePage(slug: string, newSlug: string): Promise<RenameResult>;
    duplicatePage(slug: string, locale?: string): Promise<string>;
    /** Page folders kept without pages (see `ContentAdapter.createFolder`). */
    listPageFolders(locale?: string): Promise<string[]>;
    createPageFolder(folder: string, locale?: string): Promise<void>;
    deletePageFolder(folder: string, locale?: string): Promise<void>;
    listMedia(): Promise<MediaAsset[]>;
    /** Refused (422) while content uses the asset, unless `opts.force`. */
    deleteMedia(id: string, opts?: {
        force?: boolean;
    }): Promise<void>;
    uploadMedia(file: File, folder?: string): Promise<MediaAsset>;
    listMediaFolders(): Promise<string[]>;
    createMediaFolder(folder: string): Promise<void>;
    deleteMediaFolder(folder: string): Promise<void>;
    moveMedia(id: string, folder: string, name?: string): Promise<MediaAsset>;
    renameMediaFolder(folder: string, to: string): Promise<void>;
    mediaUsage(): Promise<Record<string, MediaUse[]>>;
    getSettings(locale?: string): Promise<SiteSettings>;
    saveSettingsDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
    publishSettings(baseVersion?: string, locale?: string): Promise<SaveResult>;
    discardSettingsDraft(locale?: string): Promise<void>;
    settingsHistory(locale?: string): Promise<GitLogEntry[]>;
    writeBootstrap(patch: Partial<SiteSettingsBootstrap>): Promise<void>;
    /** The Sections library and its page templates (see `createSliceLibrary`). */
    library: FolderedLibrary;
    listCollectionRecords(sectionId: string, locale?: string): Promise<CollectionRecordInfo[]>;
    /** Commits a push would send; 404s unless the host set `config.git`. */
    gitOutgoing(): Promise<GitOutgoing>;
    /** Pushes to the upstream, or only `paths`' saved changes; a rejection
     *  throws with git's own error text. */
    gitPush(paths?: string[], slugs?: string[], settings?: boolean): Promise<void>;
    /** A page's commits, newest first (see `CmsActions.pageHistory`). */
    gitHistory(slug: string, locale?: string): Promise<GitLogEntry[]>;
    /** Files with saved changes the upstream lacks. */
    gitPending(): Promise<GitPendingChange[]>;
    /** Undoes `paths`' saved changes in a new commit. */
    gitDiscard(paths: string[]): Promise<void>;
    /** A PageActions for one collection section, HTTP-backed the same way the
     *  top-level Pages methods are. It structurally satisfies PageActions so it
     *  can be dropped straight into `SectionCtx.collections[id]`. */
    collection(sectionId: string): PageActions & {
        getRecord(slug: string, locale?: string): Promise<{
            page: PageContent;
            version: string | null;
            hasDraft: boolean;
        }>;
    };
}
declare class TyprenApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare function createTyprenClient(options: TyprenClientOptions): TyprenClient;
export { TyprenApiError };

// ---- dist/api/index.d.ts ----
export { createTyprenApi, type TyprenApiOptions, type CmsConfigFactory } from "./routes.js";
export { createTyprenClient, TyprenApiError, type TyprenClient, type TyprenClientOptions } from "./client.js";

// ---- dist/api/routes.d.ts ----
import type { CmsConfig } from "../types.js";
/**
 * The editor's HTTP API.
 *
 * Why HTTP rather than framework RPC: Server Actions are a Next-only transport,
 * invisible to anything that isn't a React host: no Nuxt/Astro/SvelteKit mount,
 * no CLI, no MCP server, no `curl`. The action logic (`makeActions`) was already
 * transport-agnostic, so this exposes it over a seam anything can call, and
 * `createTyprenClient` (./client) turns it back into the same object shape the
 * UI already consumes.
 *
 * Built on WHATWG `Request`/`Response` only, so the same handler runs as a Next
 * Route Handler, a Hono route, `Bun.serve`, or Deno.
 *
 * ## Resources
 * ```
 * GET    /pages                              list (?locale=)
 * POST   /pages                              create           (?locale=) { title, slug?, draft? } -> { slug }
 *        With `slices` it is createPageFrom: a draft at `slug` holding them ({ title, slug, slices }).
 * POST   /pages/publish-all                  publish every draft (?locale=) -> { slugs }
 * GET    /pages/:slug                        draft ?? published (?locale=)
 * PUT    /pages/:slug/draft                  save draft       (?locale=) { page, baseVersion? }
 * DELETE /pages/:slug/draft                  discard draft    (?locale=)
 * POST   /pages/:slug/publish                publish          (?locale=) { baseVersion? }
 * POST   /pages/:slug/commit                 save then publish (?locale=) { page?, baseVersion? }
 * POST   /pages/:slug/sections               insert a section (?locale=) { slice, at, baseVersion? }
 * PUT    /pages/:slug/meta                   title, nav, noindex, description (?locale=) { patch, baseVersion? }
 * POST   /pages/:slug/rename                 rename slug      { newSlug } -> SaveResult-shaped (409 on collision)
 * POST   /pages/:slug/duplicate              duplicate        (?locale=) -> { slug }
 * DELETE /pages/:slug                        delete page
 * POST   /pages/:slug/translations           create           { toLocale }
 * DELETE /pages/:slug/translations/:locale   delete translation
 * GET    /folders                            page folders     (?locale=) -> { folders: string[] }
 * POST   /folders                            keep a folder    (?locale=) { path }
 * DELETE /folders/:path                      delete an empty folder (?locale=; 409 when it holds pages)
 * GET    /collections/:id                    list records     (?locale=) -> { records: CollectionRecordInfo[] }
 * GET    /collections/:id/:slug              draft ?? published (?locale=)
 * POST   /collections/:id                    create           (?locale=) { title } -> { slug }
 * PUT    /collections/:id/:slug/draft        save draft       (?locale=) { page, baseVersion? }
 * DELETE /collections/:id/:slug/draft        discard draft    (?locale=)
 * POST   /collections/:id/:slug/publish      publish          (?locale=) { baseVersion? }
 * DELETE /collections/:id/:slug              delete record
 * GET    /media                              list
 * POST   /media                              upload (multipart/form-data, field "file")
 * DELETE /media/:id[?force=1]                delete (an id may hold "/" folders; 422 while in use unless force)
 * GET    /media/folders                      list folders
 * POST   /media/folders                      create folder {folder}
 * DELETE /media/folders?folder=               delete an empty folder
 * POST   /media/folders/rename               rename/move a folder {folder, to}
 * GET    /media/usage                        where each asset URL is referenced
 * POST   /media/move                         move/rename {id, folder, name?}; rewrites references
 * GET    /settings                           runtime (its draft when there is one) + bootstrap + version + hasDraft
 * PUT    /settings/draft                     save draft       (?locale=) { settings, baseVersion? }
 * DELETE /settings/draft                     discard draft    (?locale=)
 * POST   /settings/publish                   publish          (?locale=) { baseVersion? }
 * GET    /settings/history?limit=            the settings doc's commits, newest first
 * PUT    /settings/bootstrap                 write bootstrap  (admin)   { patch }
 * GET    /library                            saved sections   -> { saved: SavedSlice[] }
 * POST   /library                            save a section   { name, slice } -> SavedSlice
 * PUT    /library/:id                        update a section { slice, baseSavedAt, name? } -> LibraryUpdateResult (409 conflict, 404 gone)
 * DELETE /library/:id                        delete a saved section
 * GET    /library/templates                  page templates   -> { templates: PageTemplate[] }
 * POST   /library/templates                  save a template  { name, slices } -> PageTemplate
 * PUT    /library/templates/:id              update a template { slices, baseSavedAt, name? } -> TemplateUpdateResult (409 conflict, 404 gone)
 * DELETE /library/templates/:id              delete a template
 * POST   /library[/templates]/:id/move        move an entry    { folder, baseSavedAt? } -> result (409 conflict, 404 gone)
 * GET    /library[/templates]/folders         folders          -> { folders: string[] }
 * POST   /library[/templates]/folders         create a folder  { folder }
 * POST   /library[/templates]/folders/rename  rename a folder  { folder, to }
 * DELETE /library[/templates]/folders?folder= delete an empty folder (422 while it holds anything)
 * GET    /git                                commits a push would send (only with `config.git`)
 * POST   /git/push                           push to the upstream (publish) -> 502 { error } on rejection;
 *                                             with { paths } only those files' saved changes; { slugs }
 *                                             and { settings: true } publish those drafts first
 * GET    /git/pending                        files with saved changes the upstream lacks
 * GET    /git/history?slug=&limit=           a page's commits, newest first
 * POST   /git/discard                        undo files' saved changes in a new commit { paths }
 *        A failed git commit on publish, or a refused flow (a locked rename, a stale section insert),
 *        answers 422 { error } with a plain-language reason.
 * ```
 *
 * ## Security
 * Every write routes through `makeActions`/`createSettingsStore`, which call
 * `authorize()` themselves. The gate is not re-implemented here, so it can't
 * drift. Two things this layer DOES own, because Next's Server Actions used to
 * provide them implicitly:
 *  - **Origin checking** on unsafe methods, so a cookie-authenticated editor
 *    can't be driven cross-site (CSRF). Same-origin by default; a host with a
 *    split origin passes `allowedOrigins`.
 *  - **Read gating** for the GETs no action serves (collections, settings,
 *    git); page and folder reads go through `makeActions`' own read guard.
 */
export interface TyprenApiOptions {
    /** Path prefix to strip before matching, e.g. "/api/typren". Inferred from
     *  the request when omitted (everything up to the first known resource). */
    basePath?: string;
    /** Extra origins allowed to send writes. Same-origin is always allowed;
     *  requests with no `Origin` header (server-to-server, curl) are allowed
     *  because CSRF needs a browser to attach credentials. */
    allowedOrigins?: string[];
}
/** Resolves a `CmsConfig` fresh per request (session -> user -> account ->
 *  membership -> site, per docs/hosted-platform.md), for a host serving more
 *  than one tenant from one process. Never take `siteId`/`accountId` from
 *  the request yourself here -- resolve them server-side same as identity. */
export type CmsConfigFactory = (request: Request) => CmsConfig | Promise<CmsConfig>;
/**
 * Builds the handler. Mount it in Next as:
 *
 * ```ts
 * // app/api/typren/[...path]/route.ts
 * import { createTyprenApi } from "@typren/core/api";
 * import { cmsConfig } from "@/cms.config";
 * export const { GET, POST, PUT, DELETE } = createTyprenApi(cmsConfig, {
 *   basePath: "/api/typren",
 * });
 * ```
 *
 * `config` may also be a `CmsConfigFactory`, resolved (and rebuilt: actions,
 * store, settings, auth, the collection registry -- everything `build()`
 * derives) fresh on EVERY request, for a hosted host serving more than one
 * tenant from one process. That result is never cached across requests: two
 * concurrent requests for different tenants must never be able to observe
 * each other's resolved config, so per-request state stays local to that
 * request's `handler()` call rather than shared/reassigned on this closure.
 * A plain `CmsConfig` keeps building once here, byte-identical to before
 * this factory form existed.
 */
export declare function createTyprenApi(config: CmsConfig | CmsConfigFactory, options?: TyprenApiOptions): {
    handler: (request: Request) => Promise<Response>;
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
    PUT: (request: Request) => Promise<Response>;
    PATCH: (request: Request) => Promise<Response>;
    DELETE: (request: Request) => Promise<Response>;
};

// ---- dist/auth-adapter.d.ts ----
/**
 * Pluggable auth, analogous to `ContentAdapter`. Named `auth-adapter.ts` (not
 * `auth.ts` + `auth/` dir) to follow the existing `editor.ts`-vs-`ui/` no-clash
 * convention.
 */
/** What a handler is attempting. Lets an adapter allow reads but gate writes,
 *  or do per-slug / per-role checks. */
export type AuthAction = "read" | "saveDraft" | "discardDraft" | "publish" | "createPage" | "renamePage" | "deletePage" | "uploadMedia" | "deleteMedia"
/** Site-reconfiguration: bootstrap writes, settings-doc writes, onboarding
 *  writes. Distinct from the content-write actions above so a host can grant
 *  page-editing without granting site-reconfiguration (they reparameterize
 *  what the next boot trusts). */
 | "admin";
export type AuthContext = {
    action: AuthAction;
    /** Target slug when the action has one (undefined for "read" of the index / createPage). */
    slug?: string;
    /** Collection section id (see sections.ts's CollectionSection) when the
     *  action targets a collection record, undefined for a Pages action. Lets
     *  a policy grant/deny per collection the way `slug` lets it grant/deny
     *  per page. */
    collectionId?: string;
    /** Locale the action targets, when the caller resolved one. Undefined
     *  means the adapter's default locale. */
    locale?: string;
    /** Hosted-platform tenant scope, resolved server-side (session -> user ->
     *  account -> membership -> site) and NEVER taken from client input.
     *  Optional: a single-site local/self-host config omits both and every
     *  existing adapter keeps working unchanged. A hosted `authorize()` uses
     *  these to make cross-tenant access structurally impossible to forget
     *  rather than merely documented (docs/hosted-platform.md, "Tenant
     *  isolation"). */
    siteId?: string;
    accountId?: string;
};
/** Normalized identity. Adapters map their lib's user onto this. */
export type AuthUser = {
    id: string;
    email?: string;
    name?: string;
    roles?: string[];
};
/** Analogous to ContentAdapter: the only thing that knows how identity is
 *  resolved and what it's allowed to do. Adapters read the request themselves
 *  (App Router: `cookies()`/`headers()` via their auth lib). No request object
 *  is plumbed through, matching how next-auth v5 `auth()` and Clerk `auth()`
 *  work inside server actions/components. */
export interface AuthAdapter {
    /** Resolve the current user, or null if unauthenticated. Optional: adapters
     *  that only make an allow/deny decision (dev-local) may omit it. */
    getUser?(ctx: AuthContext): Promise<AuthUser | null>;
    /** Allow/deny this action. MUST fail closed on any error. */
    authorize(ctx: AuthContext): Promise<boolean>;
}
/** Back-compat shim: wraps the legacy zero-arg `CmsConfig.authorize()` closure
 *  as an adapter so old configs keep working unchanged. */
export declare function legacyAuthAdapter(fn: () => boolean | Promise<boolean>): AuthAdapter;
/** The "what may they do?" half of `withPolicy`'s split (see below): given
 *  the user identity has already resolved, decide the action. No identity
 *  resolution of its own, `filePolicy` (file-policy.ts) is the first
 *  implementation. */
export interface Policy {
    authorize(user: AuthUser | null, ctx: AuthContext): boolean | Promise<boolean>;
}
/**
 * Compose an identity adapter ("who is this?") with a `Policy` ("what may
 * they do?") into one `AuthAdapter`. `identity.getUser()` resolves the user;
 * `policy.authorize()` decides. The identity adapter's OWN `authorize()` (if
 * any) is never called, the policy is authoritative, so adding a group
 * policy can't silently be opted out of by picking a different identity
 * adapter. Fails closed: no `getUser`, no user, or any error resolving
 * either side denies. See docs/hosted-platform.md, "Compose identity and
 * policy, do not fuse them".
 */
export declare function withPolicy(identity: AuthAdapter, policy: Policy): AuthAdapter;
/** Single resolution point used by BOTH the action guard and the layout gate,
 *  so they can never diverge. Throws at construction if a config has neither. */
export declare function resolveAuth(config: {
    auth?: AuthAdapter;
    authorize?: () => boolean | Promise<boolean>;
}): AuthAdapter;

// ---- dist/auth/better-auth.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/** Better Auth's server instance is created per-app, so `getSession` is
 *  injected, not imported, matching next-auth.ts (the host passes e.g.
 *  `() => auth.api.getSession({ headers: await headers() })`). This entry
 *  (`@typren/core/auth/better-auth`) never resolves `better-auth` itself. */
type Session = {
    user?: {
        id?: string;
        email?: string;
        emailVerified?: boolean;
        name?: string;
        role?: string | null;
    };
} | null;
/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A signed-in session with neither would authorize
 * anyone who can sign in, which is almost never the intended policy for an
 * editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`. A host must opt in to who gets
 * to reconfigure the site.
 *
 * Better Auth's admin plugin stores `session.user.role` as a single string,
 * sometimes comma-separated for multi-role users; `rolesFrom` lets a host
 * override extraction (e.g. a custom field) and defaults to splitting that
 * string on commas.
 */
export declare function betterAuthAdapter(opts: {
    /** The host's session lookup, e.g. `() => auth.api.getSession({ headers: await headers() })`. */
    getSession: () => Promise<Session>;
    /** Case-insensitive match on session.user.email. */
    allowedEmails?: string[];
    /** Any-intersection with the resolved roles. */
    allowedRoles?: string[];
    /** Any-intersection with the resolved roles, required for the "admin" action. */
    adminRoles?: string[];
    /** Override role extraction from the session. Default: split
     *  `session.user.role` on commas. */
    rolesFrom?: (session: NonNullable<Session>) => string[] | undefined;
}): AuthAdapter;
export {};

// ---- dist/auth/clerk.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/**
 * Clerk gate (entry `@typren/core/auth/clerk`, optional peer `@clerk/nextjs`).
 * Unlike next-auth's injected `auth()`, Clerk's `auth()`/`currentUser()` are
 * global request-scoped helpers, so they're imported directly.
 *
 * REQUIRES AN ALLOWLIST: `allowedEmails`, `allowedRoles`, or `allowedUserIds`
 * must be set, or construction throws, matching next-auth.ts/better-auth.ts.
 * `allowedUserIds` counts as an allowlist on its own (a fixed roster of Clerk
 * user ids is a legitimate, closed policy) even with no email/role check.
 *
 * Roles are org-scoped: `allowedRoles`/`adminRoles` require `organizationId`,
 * and a role claim only counts while that org is the session's active org.
 *
 * "admin" (settings/onboarding/bootstrap writes) must first pass the same
 * allowlist as content writes, then also match `adminRoles`. Unmapped (no
 * `adminRoles` configured) denies. A host must opt in to who gets to
 * reconfigure the site.
 */
export declare function clerkAuthAdapter(opts?: {
    /** Case-insensitive match on the user's verified primary email. */
    allowedEmails?: string[];
    /** Org role claim, e.g. "org:admin". Requires `organizationId`. */
    allowedRoles?: string[];
    allowedUserIds?: string[];
    /** Org role claim the "admin" action additionally requires, e.g.
     *  "org:admin". Requires `organizationId`. */
    adminRoles?: string[];
    /** The Clerk organization id ("org_...") whose roles count. Required
     *  when `allowedRoles` or `adminRoles` is set. */
    organizationId?: string;
}): AuthAdapter;

// ---- dist/auth/local.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/**
 * True when `headers` look like they passed through a reverse proxy, tunnel
 * or port forwarder. Presence can't be the signal: Next itself fills
 * `X-Forwarded-For/-Host/-Proto` on every request (`??=`, so a proxy's own
 * value survives). Values can: a browser talking straight to a loopback-bound
 * server yields only loopback addresses, while a forwarder carries the real
 * client IP or public host. Refuses a non-loopback hop in `X-Forwarded-For`,
 * a non-loopback `X-Forwarded-Host`, and any `Forwarded` or `X-Real-IP`
 * (Next adds neither). `X-Forwarded-Proto` is ignored, it says nothing about
 * where the request came from.
 *
 * Best-effort tripwire, not a boundary: a forwarder on the same host that
 * sets none of these (nginx's default) shows Next its own loopback peer and
 * passes. Never put localAuth behind one.
 * ponytail: a per-boot secret (cookie set by a loopback-only page) would
 * close this properly, but needs a scaffolded route and an editor change.
 */
export declare function isForwardedRequest(headers: {
    get(name: string): string | null;
}): boolean;
/**
 * Dev-only gate (entry `@typren/core/auth/local`, no peer deps outside the
 * `getHost` default above). Refuses in production unless `allowInProduction`
 * is explicitly set, refuses unless the server is bound to loopback (Next:
 * `next dev -H 127.0.0.1`, which `typren init` scaffolds; other hosts pass
 * `isBoundToLoopback` and `getHost`), and refuses a non-loopback Host even
 * then. Also refuses a request that shows proxy forwarding (see
 * `isForwardedRequest`). Any throw from a check denies. The editor writes files, so never ship it open
 * by omission. Doesn't branch on `ctx.action`, so "admin"
 * (settings/onboarding/bootstrap writes) gets the exact same local-only gate
 * as every other write. There's only one tier in local dev.
 */
export declare function localAuth(opts?: {
    /** default: NODE_ENV === "development" */
    predicate?: () => boolean;
    /** default: false */
    allowInProduction?: boolean;
    /** Resolve the request's Host header. Default: Next's `headers()` (see
     *  `defaultGetHost`). Override in tests. Only ever narrows access. */
    getHost?: () => Promise<string | null>;
    /** True when the request shows proxy forwarding. Default: Next's
     *  `headers()` through `isForwardedRequest`. A non-Next host should call
     *  `isForwardedRequest(request.headers)`. */
    hasForwardedHeaders?: () => Promise<boolean>;
    /** True only when the server is listening on loopback alone. Default:
     *  Next's startup state (see `isBoundToLoopback`). A non-Next host must
     *  supply it from the address its server actually bound -- e.g. Astro's
     *  `astro:server:start` hook -- never from anything a request carries. */
    isBoundToLoopback?: () => boolean;
}): AuthAdapter;

// ---- dist/auth/next-auth.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/** next-auth v5's `auth()` is created per-app, so it's injected, not imported.
 *  This entry (`@typren/core/auth/next-auth`) never resolves `next-auth` itself. */
type Session = {
    user?: {
        id?: string;
        email?: string;
        name?: string;
        roles?: string[];
    };
} | null;
/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws, matching better-auth.ts. A signed-in session with
 * neither would authorize anyone who can sign in, which is almost never the
 * intended policy for an editor.
 *
 * "admin" (settings/onboarding/bootstrap writes; they reparameterize what the
 * next boot trusts) is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped (no
 * `adminRoles` configured) denies rather than falling back to `allowedRoles`.
 * A host must opt in to who gets to reconfigure the site.
 *
 * next-auth's session carries no standard verified-email signal (Credentials
 * and many OAuth providers never verify one), so `allowedEmails` requires an
 * `isEmailVerified(session)` callback; the email only reaches the allowlist
 * when it returns `true`, mirroring better-auth.ts's `emailVerified`.
 */
export declare function nextAuthAdapter(opts: {
    /** The host's `auth` from `NextAuth(config)` (reads the session cookie). */
    auth: () => Promise<Session>;
    /** Case-insensitive match on session.user.email, once `isEmailVerified` vouches for it. */
    allowedEmails?: string[];
    /** Whether the session's email is provider-verified. Required with `allowedEmails`. */
    isEmailVerified?: (session: NonNullable<Session>) => boolean;
    /** Any-intersection with session.user.roles. */
    allowedRoles?: string[];
    /** Any-intersection with session.user.roles, required for the "admin" action. */
    adminRoles?: string[];
}): AuthAdapter;
export {};

// ---- dist/auth/oidc.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/**
 * Generic OIDC/JWT gate (entry `@typren/core/auth/oidc`, peer `jose`). Covers
 * any IdP that hands the host a bearer JWT: Okta, Entra ID, Auth0, Keycloak,
 * Google Workspace SSO. The host reads the token out of its own
 * header/cookie and injects `getToken`, same reasoning as next-auth's
 * injected `auth()`: core never terminates a login flow or imports an IdP
 * SDK.
 *
 * Verifies the signature against the issuer's remote JWKS (resolved once per
 * adapter instance and cached/rotated by `jose`'s `createRemoteJWKSet`, not
 * refetched per request) plus `iss`/`aud`/`exp`. Without an explicit
 * `jwksUri`, the JWKS location is found via standard OIDC discovery: a lazy,
 * cached-once fetch of `${issuer}/.well-known/openid-configuration` on the
 * first `authorize()`/`getUser()` call, reading its `jwks_uri` (required to
 * be `https:`, since an http one would let a network attacker point
 * verification at their own keys). A discovery failure clears the cache so
 * the next call retries rather than wedging the adapter open or closed
 * forever on a transient outage; `authorize()` still fails closed for that
 * call like any other verification error. Pass `jwksUri` explicitly to skip
 * discovery entirely (`cfAccessAuthAdapter` below always does, Access's JWKS
 * endpoint isn't behind discovery).
 *
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A verified token with neither would authorize anyone
 * who can sign in with the IdP, which is almost never the intended policy
 * for an editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`.
 */
type OidcOpts = {
    /** Reads the bearer token from the host's own request, e.g. the
     *  `Authorization` header. Returns null when absent. */
    getToken: () => Promise<string | null>;
    /** Expected `iss` claim, and the default JWKS host. */
    issuer: string;
    /** Expected `aud` claim. */
    audience: string;
    /** Default: resolved via OIDC discovery (`${issuer}/.well-known/openid-configuration`'s `jwks_uri`). */
    jwksUri?: string;
    /** Claim holding roles, normalized to string[] (string -> `[value]`). Default `"roles"`. */
    rolesClaim?: string;
    /** Claim holding the email. Default `"email"`. */
    emailClaim?: string;
    /** Case-insensitive match on the resolved email. */
    allowedEmails?: string[];
    /** Any-intersection with the resolved roles. */
    allowedRoles?: string[];
    /** Any-intersection with the resolved roles, required for the "admin" action. */
    adminRoles?: string[];
};
export declare function oidcAuthAdapter(opts: OidcOpts): AuthAdapter;
/**
 * Cloudflare Access preset over the same verification `oidcAuthAdapter` uses.
 * Access issues its own JWT (the `Cf-Access-Jwt-Assertion` header, still
 * injected via `getToken`, core never reads headers itself) signed by the
 * team's own JWKS; issuer and JWKS URL are both derived from `teamDomain`, so
 * a host only supplies the team name and the application's `aud` tag.
 *
 * EXEMPT FROM THE ALLOWLIST REQUIREMENT: unlike a bare OIDC provider, Access
 * only issues this token after its own per-application policy (the set of
 * emails/groups/IdPs an admin configured for this `aud`) already let the
 * request through; a verified token here is already allowlisted, by Access
 * itself. `allowedEmails`/`allowedRoles` remain available for a second,
 * narrower tier inside Typren.
 *
 * NOTE on `allowedRoles`/`adminRoles` here: Access tokens only carry a
 * `groups` claim when the team has SCIM group sync configured. Without it,
 * every token omits `groups` and `rolesOf` resolves to `undefined`, so
 * `allowedRoles`/`adminRoles` silently deny everyone rather than signal
 * misconfiguration. Confirm SCIM sync is on before relying on role gating
 * with this preset.
 */
export declare function cfAccessAuthAdapter(opts: {
    /** The Cloudflare Access team name, e.g. `"acme"` for `acme.cloudflareaccess.com`.
     *  Must be a bare hostname label: no scheme, slashes or dots. */
    teamDomain: string;
    /** The Access application's `aud` tag. */
    audience: string;
    getToken: () => Promise<string | null>;
    /** Claim holding roles. Default `"groups"` (Access's group-membership claim). */
    rolesClaim?: string;
    emailClaim?: string;
    allowedEmails?: string[];
    allowedRoles?: string[];
    adminRoles?: string[];
}): AuthAdapter;
export {};

// ---- dist/auth/supabase.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/** Structural shape of the subset of `@supabase/supabase-js`'s client this
 *  adapter calls, so core never imports or depends on the real package (the
 *  host's own `createClient(...)` satisfies this). Deliberately uses
 *  `getUser()`, which revalidates the token against Supabase's server, not
 *  `getSession()`, which only reads the (client-forgeable) local cookie. */
type SupabaseClient = {
    auth: {
        getUser(): Promise<{
            data: {
                user: SupabaseUser | null;
            };
            error: unknown;
        }>;
    };
};
export type SupabaseUser = {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: {
        roles?: string[];
        role?: string;
    } & Record<string, unknown>;
};
/**
 * REQUIRES AN ALLOWLIST: `allowedEmails` or `allowedRoles` must be set, or
 * construction throws. A signed-in user with neither would authorize anyone
 * who can sign in, which is almost never the intended policy for an editor.
 *
 * "admin" is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped denies
 * rather than falling back to `allowedRoles`.
 *
 * SECURITY: roles are read ONLY from `user.app_metadata` (`roles` array or
 * singular `role`), never `user_metadata`. Supabase lets the signed-in user
 * write their own `user_metadata` from the client; trusting it for
 * authorization would let any user grant themselves roles. `app_metadata` is
 * writable only via the service-role key, server-side.
 */
export declare function supabaseAuthAdapter(opts: {
    /** The host's Supabase client, e.g. from `createServerClient(...)`. */
    client: SupabaseClient;
    /** Case-insensitive match on user.email. */
    allowedEmails?: string[];
    /** Any-intersection with app_metadata roles. */
    allowedRoles?: string[];
    /** Any-intersection with app_metadata roles, required for the "admin" action. */
    adminRoles?: string[];
}): AuthAdapter;
export {};

// ---- dist/collection.d.ts ----
import { type PageActions } from "./actions.js";
import type { CmsConfig, CollectionRecordInfo, ContentAdapter } from "./types.js";
import { type CollectionSection } from "./sections.js";
/** Shared by makeCollectionActions/listCollectionRecords/the HTTP routes
 *  (api/routes.ts, for the reads makeCollectionActions' write-only
 *  `PageActions` can't do): resolves a collection section's own
 *  `ContentAdapter`, guarded against overlapping the Pages adapter's root. */
export declare function makeCollectionAdapter(config: CmsConfig, section: CollectionSection): ContentAdapter;
/** `collectionId` defaults to the id `resolveSections` would give `section`;
 *  it reaches every write's AuthContext so a policy can gate per collection. */
export declare function makeCollectionActions(config: CmsConfig, section: CollectionSection, collectionId?: string): PageActions;
export declare function buildCollectionActions(config: CmsConfig): Record<string, PageActions>;
/** List every record in a collection section as `CollectionRecordInfo` rows:
 *  the list view's data source (spec: collections have no client "read"
 *  action, so this is what a host's server-fetch calls into). Reuses the same
 *  adapter construction as makeCollectionActions so the overlap guard and
 *  contentDir resolution can't drift between the read and write paths. */
export declare function listCollectionRecords(config: CmsConfig, section: CollectionSection, locale?: string): Promise<CollectionRecordInfo[]>;

// ---- dist/field-schema.d.ts ----
import type { SliceSchema } from "./types.js";
/** `CmsConfig["fieldSchema"]`'s shape, named for its own module: the set of
 *  per-slice field hints, keyed by slice name. Already plain data (strings,
 *  arrays, nested objects, no functions) -- this type exists so a hosted
 *  dashboard reading it from a repo-committed JSON file has something to
 *  import instead of reaching into `CmsConfig`. */
export type SerializedFieldSchema = Record<string, SliceSchema>;
/** Runtime type guard for a full fieldSchema document (every slice, every
 *  field). Exported so a caller can validate without also wanting the throw
 *  behavior `parseFieldSchema` has for the string-in-string-out case. */
export declare function isFieldSchema(value: unknown): value is SerializedFieldSchema;
/** Serialize a TS-authored `CmsConfig.fieldSchema` to the JSON a hosted
 *  dashboard commits alongside content and reads back on load. The TS shape
 *  is already JSON-serializable, so this is JSON.stringify with stable
 *  formatting for a readable diff; the real work is `parseFieldSchema`'s
 *  validation on the way back in. */
export declare function serializeFieldSchema(schema: SerializedFieldSchema): string;
/** Parse + validate a fieldSchema JSON document. Throws with a descriptive
 *  message on malformed JSON or anything not shaped like
 *  `Record<sliceName, Record<fieldName, FieldDef>>`, so a hand-edited or
 *  stale file fails loudly instead of silently feeding a control garbage. */
export declare function parseFieldSchema(json: string): SerializedFieldSchema;

// ---- dist/file-policy.d.ts ----
import type { AuthAction, Policy } from "./auth-adapter.js";
/** `.typren/access.yml` shape (docs/hosted-platform.md, "The policy file").
 *  `groups` maps a group name to the actions it may perform; `members` maps
 *  an identity (email, matched case-insensitively) or a `"*@domain"`
 *  wildcard default to a group name. */
export interface AccessPolicyFile {
    groups: Record<string, AuthAction[]>;
    members: Record<string, string>;
}
/**
 * File-backed `Policy`: reads the YAML file at `file` and checks the
 * resolved user's group against the requested action. DEFAULT CLOSED, no
 * member entry (exact email, falling back to a `*@domain` wildcard) or no
 * action listed for the matched group means deny, full stop; there is no
 * fallback allow.
 *
 * Read fresh on every call: these files are small and change by git commit
 * (slow), so this trades a stat+read per request for zero cache-invalidation
 * logic. `withPolicy` (auth-adapter.ts) already wraps this in the fail-closed
 * try/catch, so a missing file or malformed YAML denies rather than throwing
 * through to the caller.
 *
 * `file`'s location is the caller's responsibility to keep OUTSIDE whatever
 * the dashboard's ContentAdapter can write (`content/**` and the media dir)
 *, that's what closes the escalation trap (an editor promoting themselves
 * to admin), not anything in here. See docs/hosted-platform.md, "The
 * escalation trap".
 */
export declare function filePolicy(opts: {
    file: string;
}): Policy;

// ---- dist/fs-media-adapter.d.ts ----
import type { MediaAdapter } from "./types.js";
export type FsMediaAdapterOptions = {
    /** Absolute path to the directory assets are read from/written to. */
    dir: string;
    /** Public URL prefix the dir is served under, e.g. "/img". */
    publicPath: string;
};
/**
 * Filesystem media adapter over a directory tree: subfolders are media
 * folders, and an asset's id is its "/"-joined path under `dir` (mirrors
 * `markdown-adapter.ts`'s conventions: a `create*Adapter(opts)` factory, a
 * `SAFE_*` traversal guard, idempotent delete). Async throughout, same as
 * `ContentAdapter` (issue #29): `list()` probes image dimensions via sharp.
 * See `types.ts`'s `MediaAdapter`.
 */
export declare function createFsMediaAdapter({ dir, publicPath }: FsMediaAdapterOptions): MediaAdapter;

// ---- dist/git-error.d.ts ----
/** A git failure whose message is a plain-language reason the person saving
 *  or pushing can act on, not git's own text. */
export declare class GitError extends Error {
    name: string;
}
export declare const GIT_NO_BRANCH = "Check out a branch in your site folder to save.";

// ---- dist/git.d.ts ----
import { GitError, GIT_NO_BRANCH } from "./git-error.js";
export { GitError, GIT_NO_BRANCH };
/** A local commit the upstream branch does not have yet. */
export type GitCommit = {
    hash: string;
    subject: string;
    files: string[];
};
/** What a push would send. `upstream` is null when the branch tracks none,
 *  so there is nowhere to push and `commits` is empty. */
export type GitOutgoing = {
    branch: string;
    upstream: string | null;
    commits: GitCommit[];
};
export type GitPushResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
/** One commit in a file's history (see `GitRepo.history`). `date` is ISO 8601. */
export type GitLogEntry = {
    hash: string;
    subject: string;
    author: string;
    date: string;
};
/** One file with saved (committed) changes the upstream does not have yet:
 *  its net change since the upstream, and the local commits that touched it.
 *  `path` is relative to the repository root, like `GitCommit.files`. */
export type GitPendingChange = {
    path: string;
    change: "added" | "modified" | "deleted";
    commits: {
        hash: string;
        subject: string;
    }[];
};
/**
 * Explains a failed commit or push in words a non-developer working locally
 * can act on, keeping one line of git's (or a hook's) output where it helps.
 * ponytail: a hook is recognised by elimination, output with no "fatal:" or
 * "error:" line of git's own; read the hook path (core.hooksPath) if a
 * message ever needs to name the hook.
 */
export declare function explainGitError(output: string, step: "commit" | "push"): string;
/** A local git checkout holding the content: the local studio's Save commits
 *  into it and its Push sends the commits to the branch's upstream. */
export interface GitRepo {
    /** Stages and commits exactly `files` (absolute, inside the checkout),
     *  leaving anything else in the index alone. A file that no longer exists
     *  commits as a deletion when git tracks it, and is skipped when it never
     *  did, like an untracked file git ignores. False when they hold no
     *  change, so there was nothing to commit. Throws `GitError` with a
     *  plain-language reason, refusing outright on a detached HEAD; a failed
     *  commit leaves these paths' index entries as they were. */
    commit(files: string[], message: string): Promise<boolean>;
    /** `branch` is "" on a detached HEAD, where Save is refused. */
    outgoing(): Promise<GitOutgoing>;
    /** Pushes the current branch to its upstream, never forced. A rejection
     *  (non-fast-forward, auth) comes back as a plain-language reason. */
    push(): Promise<GitPushResult>;
    /** Every content file (see `createGitRepo`'s `roots`) with a net change the upstream lacks.
     *  Empty with no upstream or on a detached HEAD. */
    pending(): Promise<GitPendingChange[]>;
    /** Pushes only `paths` (from `pending()`), never forced: one commit on
     *  top of the upstream per local commit that last touched them, with that
     *  commit's message and author, holding just the chosen paths' changes.
     *  A page saved once per push is one commit per page. On success the
     *  branch becomes those commits followed by every unpushed commit
     *  replayed without the pushed paths' changes (dropped when nothing is
     *  left), so the working tree is untouched and unpushed history keeps its
     *  commits. A rejection (the remote moved, auth) comes back as a
     *  plain-language reason with the local branch as it was. Throws
     *  `GitError` for a path not in `pending()`. */
    pushPaths(paths: string[]): Promise<GitPushResult>;
    /** The latest `limit` (1 to 100) commits that touched `file` (absolute,
     *  inside one of the content roots), newest first. Throws `GitError` for
     *  a file outside them. */
    history(file: string, limit?: number): Promise<GitLogEntry[]>;
    /** Puts `paths` (from `pending()`) back to the upstream's version, a file
     *  the upstream lacks being deleted, as one new commit; history is never
     *  rewritten. Throws `GitError` for a path not in `pending()`, a path with
     *  uncommitted edits, or a failed commit, which leaves the files as they were. */
    discardPaths(paths: string[]): Promise<void>;
}
/**
 * Runs git as an argument array (`execFile`, no shell) in `dir`, with the
 * user's own credentials and config. Paths are literal pathspecs, so a file
 * name can never be read as pathspec magic.
 */
export declare function createGitRepo({ dir, roots, }: {
    dir: string;
    /** The files and folders (absolute) whose changes `pending()` lists and
     *  `pushPaths`/`discardPaths` accept: the content the host owns, so a
     *  developer's code commits stay out of per-file review. Default: `dir`. */
    roots?: string[];
}): GitRepo & {
    /** The subset of `files` (absolute, inside the checkout) git tracks,
     *  whether or not they still exist on disk. Kept off `GitRepo`, which
     *  hosts implement, since only the studio's rename commit needs it. */
    tracked(files: string[]): Promise<string[]>;
};
/**
 * Runs `write` and commits `files` (absolute, inside the checkout) as one
 * change: a detached HEAD is refused before anything is written, and a
 * failed write or commit runs `restore` to put the written files back before
 * the error (a plain-language `GitError` for the commit) is rethrown. `files` may be a function, read
 * once the write is done, for a write that only knows its paths afterwards.
 */
export declare function commitOrRestore<T>(git: GitRepo, files: string[] | (() => string[]), message: string, restore: () => unknown, write: () => Promise<T>): Promise<T>;

// ---- dist/github-adapter.d.ts ----
import type { ContentAdapter } from "./types.js";
/**
 * True when `relPath` (repo-relative, forward-slash) safely resolves inside
 * one of `allowedRoots` (also repo-relative). Rejects `..`, absolute paths,
 * any dotfile/dot-dir path segment (which subsumes `.github/`), and
 * well-known manifest filenames. Per this repo's convention an adapter owns
 * its own trust boundary rather than inheriting the fs adapter's guard, so
 * this is checked independently of (and in addition to) the slug allowlist
 * every public method also applies.
 */
export declare function isAllowedRepoPath(relPath: string, allowedRoots: string[]): boolean;
export type GithubAdapterOptions = {
    owner: string;
    repo: string;
    /** Installation access token. Minting/refreshing it (App JWT -> installation
     *  token exchange) is entirely the caller's job -- this adapter takes only
     *  the short-lived (~1h) token as plain config and never does App/JWT logic
     *  itself (docs/hosted-platform.md: "GitHub App, never an OAuth App"). A
     *  new token means a new adapter instance; this one never re-derives or
     *  caches credentials. */
    token: string;
    /** Branch every read/write targets. Default "main". This adapter always
     *  commits directly to it -- PR-based writes (the doc's cloud-tier
     *  default under "Content PRs as the cloud default") are a caller-level
     *  policy this adapter doesn't implement. Point `branch` at a working
     *  branch and open the PR outside this adapter for that. */
    branch?: string;
    /** Branch draft reads/writes/deletes/hasDraft target, instead of `branch`.
     *  Default `"typren-drafts"`: an unpublished draft never lands a commit on
     *  the branch a host builds from, so a draft save can't trigger (or
     *  pollute) a production/preview deploy, and the draft history stays out
     *  of `branch`'s own commit log. Pass `null`, or the same value as
     *  `branch`, to keep the pre-this-option behavior of drafts living under
     *  `draftSubdir` on `branch` itself. A host that builds every branch
     *  (Vercel's per-branch previews, CF Pages branch deploys) should tell it
     *  to ignore `typren-drafts` (Vercel's "Ignored Build Step", CF Pages'
     *  branch build controls) -- see this package's README. */
    draftBranch?: string | null;
    /** Repo-relative directory page files live under. Default "content". */
    contentDir?: string;
    /** Repo-relative media directory. No method here writes to it today (this
     *  is a ContentAdapter, not a MediaAdapter) -- it's accepted so the same
     *  write-path allowlist boundary (`isAllowedRepoPath`) can be validated
     *  against both roots ahead of a future GitHub-backed MediaAdapter reusing
     *  it. Default "public/img". */
    mediaDir?: string;
    /** Frontmatter key holding the slice array. Default "slices". */
    frontmatterKey?: string;
    /** Locale allowlist. Defaults to `[defaultLocale]`. */
    locales?: string[];
    /** Default locale, served flat + unprefixed. Defaults to "en". */
    defaultLocale?: string;
    /** Draft subdirectory name. Default "_drafts" -- NOT markdown-adapter's
     *  ".drafts": this adapter's own write-path allowlist rejects dotfile/
     *  dot-dir path segments (see `isAllowedRepoPath`), so a dot-prefixed
     *  default would make every draft write reject itself. "_" is this repo's
     *  existing convention for a reserved/internal name (see
     *  fs-media-adapter.ts's `_manifest-` prefix). Kept deliberately distinct
     *  from the fs adapter's own default rather than unified with it (issue
     *  #29): the dotfile rule is a real security boundary for this adapter
     *  (keeps a draft write from ever landing in `.github/` or another
     *  dot-prefixed path GitHub treats specially), not an arbitrary naming
     *  choice to reconcile. */
    draftSubdir?: string;
    /** Injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Merged into every GET's `RequestInit` (content reads only, never writes).
     *  Lets a host attach its own fetch-cache tags/options, e.g. Next's
     *  `{ next: { tags: [...] } }`, so a push webhook can invalidate the host's
     *  cache for this adapter's reads (see the `@typren/core/github-webhook`
     *  subpath). Never set this on the editor's own adapter instance: draft
     *  reads must always be fresh, a cached draft read would show a stale
     *  version of exactly the content someone is actively editing.
     *  ponytail: one site-wide cache tag is the common case; a host needing
     *  per-slug invalidation granularity passes a `relPath`-keyed tag itself
     *  (this hook already gets `relPath`), cheaper than this adapter inventing
     *  a tagging scheme. */
    readInit?: (relPath: string) => RequestInit | undefined;
};
/**
 * GitHub Contents API adapter. Mirrors `markdown-adapter.ts`'s factory shape
 * and locale layout (default locale flat at `contentDir`, others under
 * `contentDir/<locale>/`, drafts under `.../<draftSubdir>`). Implements
 * `ContentAdapter` natively: every method does real network I/O and returns a
 * promise, the same shape the interface itself now requires (issue #29).
 *
 * The CAS story lands on top of that: every write here does an
 * immediate read-sha-then-write, and the PUT is atomically compare-and-swapped
 * server-side by GitHub against the sha it's given -- a real CAS, not the fs
 * adapter's unconditional overwrite. That's the shape store.ts's own
 * `saveDraft` ponytail note asks for ("an atomic adapter ... moves the
 * compare into the adapter via an optional expectedVersion hook").
 */
export declare function createGithubAdapter({ owner, repo, token, branch, draftBranch, contentDir, mediaDir, frontmatterKey, defaultLocale, locales, draftSubdir, fetchImpl, readInit, }: GithubAdapterOptions): ContentAdapter;

// ---- dist/github-webhook.d.ts ----
/**
 * GitHub push-webhook handler for a site whose content lives in a
 * `createGithubAdapter`-backed repo (issue #29's "git runtime"): a host
 * mounts this at its webhook route, GitHub POSTs on every push, and
 * `onChange` is the host's own cache-invalidation hook (e.g. Next's
 * `revalidateTag`, see the README's "Live content from GitHub" section).
 * Web-standard `Request`/`Response`, same convention as
 * `@typren/forms`'s `createFormHandler`: one function that mounts on Next
 * Route Handlers, Workers, Lambda function URLs, or Hono alike.
 */
export type GithubWebhookChange = {
    /** Every added/modified/removed path under `contentDir` this push touched,
     *  repo-relative (e.g. "content/about.md"), draft paths already excluded. */
    paths: string[];
    /** Slugs derived from the `.md` paths above (both locale-prefixed and flat). */
    slugs: string[];
    /** Locales present in `paths` (a flat/default-locale path contributes none:
     *  there is no locale segment to read off it). */
    locales: string[];
    /** True when the push can't be enumerated reliably (force push, or no
     *  commit list in the payload): `paths`/`slugs`/`locales` are then empty and
     *  the host must invalidate ALL Typren content, or the rewritten pages stay
     *  stale until something else touches them. */
    full: boolean;
};
export type GithubWebhookOptions = {
    /** The webhook's configured secret, used to verify `X-Hub-Signature-256`.
     *  Required: a webhook with no secret is an unauthenticated endpoint that
     *  lets anyone trigger `onChange` by guessing the URL. */
    secret: string;
    /** Only a push to this branch triggers `onChange`; every other branch is
     *  202 Accepted (ignored), not rejected (another branch pushing is normal
     *  repo activity, not an error). Default "main". */
    branch?: string;
    /** Repo-relative content directory, matching the `createGithubAdapter`
     *  instance this webhook invalidates for. Default "content". */
    contentDir?: string;
    /** Draft subdirectory name, matching the adapter's own `draftSubdir`. A
     *  draft-only push never fires `onChange`: draft reads are never cached
     *  (see `readInit`'s doc comment on `GithubAdapterOptions`), so there is
     *  nothing to invalidate. Default "_drafts". */
    draftSubdir?: string;
    /** The host's cache-invalidation hook, e.g.
     *  `() => revalidateTag("typren-content")`. Thrown errors become a 500 so
     *  GitHub retries/redelivers the webhook rather than silently losing the
     *  invalidation. */
    onChange: (change: GithubWebhookChange) => void | Promise<void>;
};
export declare function createGithubWebhookHandler(options: GithubWebhookOptions): (req: Request) => Promise<Response>;

// ---- dist/i18n.d.ts ----
/** Flat, dot-namespaced editor-UI strings. */
export type Messages = Record<string, string>;
/** How locales map onto URLs. A consumer picks one preset on onboarding.
 *  - `prefix-except-default`: default locale is UNPREFIXED (`/about`), others
 *    are prefixed (`/es/about`). Preserves existing single-locale URLs/SEO.
 *  - `prefix-all`: every locale is prefixed (`/en/about`, `/es/about`). */
export type RoutingMode = "prefix-except-default" | "prefix-all";
/** The one i18n block on CmsConfig. `messages` are per-UI-locale overrides
 *  deep-merged onto the package's English defaults (see ui/messages.ts). */
export interface I18nConfig {
    locales: string[];
    defaultLocale: string;
    routing: RoutingMode;
    messages?: Record<string, Partial<Messages>>;
}
/** Validate + fill defaults. A missing/empty i18n block collapses to a single
 *  implicit locale so single-locale consumers ship byte-identical behavior.
 *  Throws early if `defaultLocale` isn't in `locales` (misconfig, fail loud). */
export declare function resolveI18n(i18n?: Partial<I18nConfig>): I18nConfig;
/** True when the default locale carries no URL prefix (its files live flat at
 *  the content-dir root and its public URLs are bare). */
export declare const defaultIsUnprefixed: (i18n: I18nConfig) => boolean;
/** Public path for a leading-slash path under a locale + routing preset.
 *  `/about` → `/es/about` (es) or `/about` (en, prefix-except-default). */
export declare function localizedPath(i18n: I18nConfig, path: string, locale: string): string;
/** Like localizedPath but leaves external/anchor/mailto hrefs untouched. */
export declare function localizedHref(i18n: I18nConfig, href: string, locale: string): string;
export type LocaleRoute = {
    type: "next";
} | {
    type: "redirect";
    pathname: string;
} | {
    type: "rewrite";
    pathname: string;
};
/** Decide how the proxy should route a pathname under the preset. Pure, so the
 *  edge proxy just maps the verdict onto a NextResponse. Never rewrites to a
 *  route that can't exist for the preset. */
export declare function routeLocale(i18n: I18nConfig, pathname: string): LocaleRoute;

// ---- dist/index.d.ts ----
export type { Slice, PageContent, LocalizedPage, PageInfo, CollectionRecordInfo, ContentAdapter, CmsConfig, FieldDef, SliceSchema, MediaAsset, MediaMove, MediaUse, MediaAdapter, PreparedFile, } from "./types.js";
export { resolveI18n, localizedPath, localizedHref, routeLocale, defaultIsUnprefixed, type I18nConfig, type Messages, type RoutingMode, type LocaleRoute, } from "./i18n.js";
export { mergeLocalized, localeSubdir } from "./localize.js";
export { createMarkdownAdapter, type MarkdownAdapterOptions } from "./markdown-adapter.js";
export { STYLE_MAP_DEFAULT, STYLE_TOKENS, mappedName, sanitizeStyle, styleCss, styleMapError, styleVars, type StyleMap, type StyleToken, type StyleTokenGroup, type StyleTokenKind, } from "./style.js";
export { GitError, GIT_NO_BRANCH } from "./git-error.js";
export { commitOrRestore, createGitRepo, explainGitError, type GitRepo, type GitCommit, type GitOutgoing, type GitPendingChange, type GitPushResult, type GitLogEntry } from "./git.js";
export { createNotionAdapter, createFetchNotionClient, type NotionAdapterOptions, type NotionClient, type NotionPage, type NotionPropertyMap, type NotionPropertyType, } from "./notion-adapter.js";
export { blocksToMarkdown, blocksToSegments, pageRecordFrom, richTextToMarkdown, type NotionBlock, type NotionSegment, type ProseSegment, type ComponentSegment, } from "./notion-blocks.js";
export { createFsMediaAdapter, type FsMediaAdapterOptions } from "./fs-media-adapter.js";
export { createLocalSiteConfig, rewriteSiteFiles, type LocalSite } from "./local-site.js";
export { createGithubAdapter, isAllowedRepoPath, type GithubAdapterOptions } from "./github-adapter.js";
export { processUpload, handleMediaUpload, MAX_UPLOAD_BYTES } from "./media.js";
export { createStore, slugify, type ContentStore } from "./store.js";
export { SITE_SLUG, assertSafeNav, linksTo, navHrefError, readMenu, unlink, type NavItem } from "./nav.js";
export { nameError, slugError, libraryFolderError, BUILT_IN_FOLDER } from "./names.js";
export { findMediaRefs, makeActions, mediaRefSwapper, rewriteMediaRefs, ActionRefusedError, type CmsActions, type OpenedPage, type PageActions, type PageFlows, type PageMetaPatch, type RenameResult, type SaveResult, type UploadResult, } from "./actions.js";
export { resolveAuth, legacyAuthAdapter, withPolicy, type AuthAdapter, type AuthAction, type AuthContext, type AuthUser, type Policy, } from "./auth-adapter.js";
export { filePolicy, type AccessPolicyFile } from "./file-policy.js";
export { versionOf, ConflictError } from "./version.js";
export { serializeFieldSchema, parseFieldSchema, isFieldSchema, type SerializedFieldSchema, } from "./field-schema.js";
export { resolveSections, DEFAULT_SECTIONS, SECTION_API_VERSION, type Section, type SectionKind, type SectionCtx, type ResolvedSection, type PagesSection, type MediaSection, type SettingsSection, type CollectionSection, type CustomSection, type LibrarySection, type FieldFormMedia, } from "./sections.js";
export { createSettingsStore, createFsSettingsAdapter, validateBootstrap, BOOTSTRAP_KEYS, type SiteSettings, type SiteSettingsRuntime, type SiteSettingsBootstrap, type SettingsAdapter, type SettingsStore, } from "./settings.js";
export { createSliceLibrary, type FolderedLibrary, type LibraryFolders, type LibraryUpdateResult, type PageTemplate, type PageTemplateLibrary, type SavedSlice, type SliceLibrary, type TemplateUpdateResult, } from "./library.js";
export { makeCollectionActions, makeCollectionAdapter, buildCollectionActions, listCollectionRecords } from "./collection.js";
export { buildRedirects, type RedirectEntry, type BuildRedirectsOptions, type PageRedirectMeta } from "./redirects.js";
export { scanContentStore, loadRedirectMap, mergeRedirectEntries, toRedirectPairs, type RedirectMapEntry, type ToRedirectPairsOptions, } from "./redirect-sources.js";
export { resolveStaticHostRequest, isUnsafeRedirectTarget, STATIC_HOST_PASSTHROUGH, REDIRECT_STATUSES, type StaticHostDecision, type RedirectLookup, type RedirectStatus, } from "./static-host.js";

// ---- dist/library.d.ts ----
import type { CmsConfig, Slice } from "./types.js";
/** One slice saved to the Sections library (the page editor's "Save to
 *  Sections"): a copy of its props, not a link, so inserting it later pastes
 *  that copy and editing a page never changes the library. */
export type SavedSlice = {
    id: string;
    name: string;
    savedAt: string;
    slice: Slice;
    folder?: string;
};
/** `update`'s outcome: the section as saved, or why it wasn't. "conflict"
 *  means it changed since `baseSavedAt`; "missing" that it was deleted. */
export type LibraryUpdateResult = {
    ok: true;
    saved: SavedSlice;
} | {
    ok: false;
    code: "conflict" | "missing";
};
/** The Sections library: list, save, update and delete saved slices. */
export interface SliceLibrary {
    list(): Promise<SavedSlice[]>;
    save(name: string, slice: Slice): Promise<SavedSlice>;
    /** Replaces a saved section's slice (and its name, when given), only while
     *  its `savedAt` still equals `baseSavedAt` (the version the caller edited). */
    update(id: string, slice: Slice, baseSavedAt: string, name?: string): Promise<LibraryUpdateResult>;
    remove(id: string): Promise<void>;
    /** Moves a section into `folder` ("" is the top level), checked against
     *  `baseSavedAt` when given. Optional so a host's own library type-checks. */
    move?(id: string, folder: string, baseSavedAt?: string): Promise<LibraryUpdateResult>;
    folders?: LibraryFolders;
    /** Page templates, kept in the same doc. Optional so a host's own
     *  `SliceLibrary` still type-checks; the editor hides them without it. */
    templates?: PageTemplateLibrary;
}
/** A page template: a named, ordered group of sections a new page can start
 *  from. Like a saved section, a copy: a page made from it never changes it. */
export type PageTemplate = {
    id: string;
    name: string;
    savedAt: string;
    slices: Slice[];
    folder?: string;
};
/** `PageTemplateLibrary.update`'s outcome, read as `LibraryUpdateResult`'s. */
export type TemplateUpdateResult = {
    ok: true;
    saved: PageTemplate;
} | {
    ok: false;
    code: "conflict" | "missing";
};
/** Page templates: list, save, update and delete. */
export interface PageTemplateLibrary {
    list(): Promise<PageTemplate[]>;
    save(name: string, slices: Slice[]): Promise<PageTemplate>;
    /** Replaces a template's sections (and its name, when given), only while
     *  its `savedAt` still equals `baseSavedAt`. */
    update(id: string, slices: Slice[], baseSavedAt: string, name?: string): Promise<TemplateUpdateResult>;
    remove(id: string): Promise<void>;
    /** As `SliceLibrary.move`. */
    move?(id: string, folder: string, baseSavedAt?: string): Promise<TemplateUpdateResult>;
    folders?: LibraryFolders;
}
/** A library's folders: "/"-joined paths, kept even while empty. */
export interface LibraryFolders {
    list(): Promise<string[]>;
    /** Creates `folder` and any missing parents. */
    create(folder: string): Promise<void>;
    /** Renames or moves `folder`, its subfolders and every entry in them. */
    rename(folder: string, to: string): Promise<void>;
    /** Refuses a folder that holds entries or subfolders. */
    delete(folder: string): Promise<void>;
}
/** `createSliceLibrary`'s library: every optional part present. */
export type FolderedLibrary = Required<Omit<SliceLibrary, "templates">> & {
    templates: Required<PageTemplateLibrary>;
};
/**
 * The library is one reserved-slug doc in the private content adapter
 * settings already use (`.typren/library.md` beside a markdown Pages dir), its
 * sections under `saved` and its page templates under `templates` in the
 * front matter. No new adapter method: any
 * adapter that can hold the settings doc holds this one too.
 *
 * Writes are gated as "saveDraft": the library never reaches the live site.
 * With `config.git` and a file-backed doc, every write is committed, the way
 * a page Save is: a detached HEAD refuses it before anything is written, and
 * a failed commit puts the doc back.
 */
export declare function createSliceLibrary(config: CmsConfig): FolderedLibrary;

// ---- dist/local-site.d.ts ----
import type { AuthAdapter } from "./auth-adapter.js";
import type { StyleMap } from "./style.js";
import type { CmsConfig, MediaMove } from "./types.js";
/** What a site on disk is, read from its folder and `typren.config.json`'s
 *  `studio` block by the CLI: everything a local front end (the studio, the
 *  CLI's content commands) needs to edit it. */
export type LocalSite = {
    /** Absolute path of the site's project root. */
    siteDir: string;
    /** Absolute path of the site's markdown content directory. */
    contentDir: string;
    /** `dir` is relative to `siteDir`. Default `public/img` at `/img`. */
    media?: {
        dir: string;
        publicPath: string;
    };
    /** Default "home". */
    homeSlug?: string;
    /** `typren.config.json`'s `studio.style`, validated by the CLI. */
    styleMap?: StyleMap;
    /** typren.config.json exists, so Settings can write its bootstrap keys. */
    writeBootstrap?: boolean;
};
/**
 * The `CmsConfig` for a site on disk: its markdown content, `public/img`
 * style media and `typren.config.json` settings, with `auth` injected by the
 * front end (the studio passes `localAuth()`).
 *
 * Inside a git checkout every write that changes published files commits
 * them: Save (publish, then `onPublish`'s commit), a rename, a folder
 * delete, and through `withCommit` a page delete, duplicate or published
 * create, and a media upload, delete or move with the references it
 * rewrote. A detached HEAD refuses the write first, and a failed commit puts
 * every touched file back. Drafts are working state and never commit.
 *
 * `registry`, `defaults` and `previewPath` come back empty: a front end that
 * shows slices or previews sets its own.
 */
export declare function createLocalSiteConfig(site: LocalSite, { auth }: {
    auth: AuthAdapter;
}): CmsConfig;
/** Points the site's own files at moved assets: every move's `from` URL in
 *  source becomes its `to`, ending at a URL boundary like core's content
 *  rewrite. Returns the changed files, relative to `siteDir`.
 *  ponytail: a full tree walk per move, fine at site scale; an index or a
 *  git-grep is the upgrade for a monorepo-sized site. */
export declare function rewriteSiteFiles(siteDir: string, moves: MediaMove[]): string[];

// ---- dist/localize.d.ts ----
import type { PageContent } from "./types.js";
/** Merge a locale-specific page over the default-locale base.
 *  - meta: field-level (a translation can override just title/description and
 *    inherit the rest).
 *  - slices: whole-array (positional cross-locale merge is a footgun); the
 *    locale file's slices replace the base's, or fall back when it has none.
 *  - body: falls back to the base when the locale file omits it.
 *  The store AND the host public read path both call THIS, so their fallback
 *  rules cannot drift. `null` loc = page-level fallback (serve base as-is).
 *  // ponytail: slices are whole-array per locale; per-slice/per-field merge
 *  // only if partial translation is demanded: key slices by an id and merge then. */
export declare function mergeLocalized(base: PageContent, loc: PageContent | null): PageContent;
/** Path segment for a locale's content, matching the adapter's on-disk layout:
 *  the default locale lives FLAT at the content root ("", so a single-locale
 *  site needs no file moves), non-default locales under "<locale>/". Shared so
 *  the adapter and the host read path resolve the same file. */
export declare function localeSubdir(locale: string, defaultLocale: string): string;

// ---- dist/markdown-adapter.d.ts ----
import type { ContentAdapter } from "./types.js";
export type MarkdownAdapterOptions = {
    /** Absolute path to the directory of `<slug>.md` page files (the DEFAULT
     *  locale lives flat here; non-default locales live under `<locale>/`). */
    contentDir: string;
    /** Absolute path where the default locale's draft `<slug>.md` files are
     *  written. Defaults to `<contentDir>/<draftSubdir>`. Non-default locales
     *  always draft under `<contentDir>/<locale>/<draftSubdir>`. */
    draftDir?: string;
    /** Frontmatter key holding the slice array (default "slices"). */
    frontmatterKey?: string;
    /** Locale allowlist. Defaults to `[defaultLocale]` (single-locale). */
    locales?: string[];
    /** Default locale. Served flat + unprefixed. Defaults to "en". */
    defaultLocale?: string;
    /** Draft subdirectory name (default ".drafts"). */
    draftSubdir?: string;
    /** Whether `listSlugs` only counts files that already carry a slice array
     *  under `frontmatterKey` (default true).
     *
     *  That filter is a Pages-section heuristic: the Pages dir is shared with
     *  non-page markdown (site.md, legal bodies), and carrying a slice array is
     *  what distinguishes an editable page without a hardcoded exclude list. A
     *  *collection* dir has no such mixture: every `.md` in it is a record, and
     *  records are frontmatter + prose that may legitimately have no slices at
     *  all, so collections set this to false (see makeCollectionAdapter). */
    requireSliceArray?: boolean;
};
/**
 * Filesystem + gray-matter adapter. A page's frontmatter carries the slice
 * array under `frontmatterKey`; everything else in the frontmatter is preserved
 * as `meta`, and the markdown body is preserved verbatim, so publish is a
 * lossless round-trip (modulo YAML reformatting: the CMS owns the file format
 * once a page is edited through it).
 *
 * Locale is purely a path prefix: the default locale lives flat at `contentDir`
 * (so a single-locale site needs no file moves and is byte-identical), and
 * non-default locales live under `contentDir/<locale>/`. `parse`/`serialize`
 * are locale-agnostic. The locale never enters the file.
 */
/** `createMarkdownAdapter`'s return type: `ContentAdapter` plus the one extra
 *  the fs-backed adapter can offer that a network-backed one can't -- an
 *  absolute on-disk root, for callers that need to site something beside it
 *  (the `.typren/` settings dir, a collection's dir-overlap guard). Kept off
 *  `ContentAdapter` itself (see that interface's doc comment) since neither
 *  the GitHub nor Notion adapter has a real filesystem path to report. */
export type MarkdownAdapter = ContentAdapter & {
    readonly root: string;
    /** Absolute path of a page's published file, slug- and locale-checked like
     *  every read. A git-backed host commits exactly this file. */
    pageFile(slug: string, locale?: string): string;
    /** Absolute path of a folder's marker file, checked like `pageFile`. A
     *  git-backed host commits it so an empty folder survives a clone. */
    folderFile(folder: string, locale?: string): string;
    /** Absolute path of a page's draft file, checked like `pageFile`. */
    draftFile(slug: string, locale?: string): string;
    listFolders(locale?: string): Promise<string[]>;
    createFolder(folder: string, locale?: string): Promise<void>;
    deleteFolder(folder: string, locale?: string): Promise<void>;
};
/** The file that keeps an empty page folder (see `createFolder`). A name of
 *  Typren's own, not `.gitkeep`: a `.gitkeep` a developer placed means
 *  nothing to the editor, and deleting a folder must never remove one. */
export declare const FOLDER_MARKER = ".typren-folder";
export declare function createMarkdownAdapter({ contentDir, draftDir, frontmatterKey, defaultLocale, locales, draftSubdir, requireSliceArray, }: MarkdownAdapterOptions): MarkdownAdapter;

// ---- dist/media.d.ts ----
import type { CmsConfig, PreparedFile } from "./types.js";
/** Pre-conversion upload cap. Sharp's own `limitInputPixels` default
 *  (~268 megapixels) is relied on as-is for decompression-bomb protection. */
export declare const MAX_UPLOAD_BYTES: number;
/** Validates + web-optimizes a raw upload. Never trusts the client-supplied
 *  mime/extension: sniffs actual bytes via sharp.metadata(). Throws with a
 *  user-facing message on any rejection. SVG is refused unless `allowSvg`
 *  (see `CmsConfig.allowSvg`). */
export declare function processUpload(input: {
    name: string;
    buffer: Buffer;
}, opts?: {
    allowSvg?: boolean;
}): Promise<PreparedFile>;
/** CSRF check for an unsafe request: true when it comes from the request's
 *  own host or an `allowed` origin. A request with no `Origin` header and no
 *  cross-site `Sec-Fetch-Site` is a non-browser caller, with no ambient
 *  credentials to abuse. "Own host" is the `Host` header the browser sent:
 *  a dev server bound to 127.0.0.1 can rebuild `request.url` as localhost,
 *  which refused every write from its own page. */
export declare function sameOrigin(request: Request, allowed: string[]): boolean;
/** Route Handler body. The host's route.ts is a thin wrapper, the same
 *  "host owns the boundary, package supplies the logic" split actions.ts
 *  already uses for Server Actions.
 *
 *  Route Handlers never run through a parent layout's auth gate (a
 *  `route.ts` renders no layout tree at all). The upload itself is
 *  `makeActions().uploadMedia`, whose guard is the gate; this checks the
 *  same action first anyway, so a caller who would be refused never gets a
 *  body buffered, and refuses a
 *  cross-origin request itself: a multipart POST needs no CORS preflight, so
 *  any page could otherwise drive a loopback dev server's upload. A host
 *  serving the editor from another origin passes it in `allowedOrigins`. */
export declare function handleMediaUpload(config: CmsConfig, request: Request, allowedOrigins?: string[]): Promise<Response>;

// ---- dist/names.d.ts ----
/** Why `segment` can't be a new slug segment beside `taken`, in the style of
 *  `nameError`; null when it can. The content adapter enforces its own slug
 *  rule regardless; this only explains it before the round trip. */
export declare function slugError(segment: string, taken: string[]): string | null;
/** Why `name` can't be a media asset or folder name beside `taken`, or null:
 *  safe in a URL as typed, and within what the media adapter accepts. `ext`
 *  is an asset's extension, which the name may end with but never changes. */
export declare function nameError(name: string, taken: string[], ext?: string): string | null;
/** The editor's group for templates its code ships. Reserved at the top
 *  level, so no saved folder can be mistaken for it. */
export declare const BUILT_IN_FOLDER = "built-in";
/** Why `folder` can't be a library folder path, or null. Each segment
 *  follows the media folder name rule (`nameError`), so "..", "/" runs and
 *  other traversal shapes never pass. */
export declare function libraryFolderError(folder: string): string | null;

// ---- dist/nav.d.ts ----
/** Slug of the site-wide doc `typren init` scaffolds beside the pages
 *  (`content/site.md`). The store never lists it as a page, slice array or
 *  not. Its `nav` and `cta` are the site's header menu. */
export declare const SITE_SLUG = "site";
/** One header menu link in the site doc's `nav`, or its `cta`. Keys the
 *  editor doesn't know round-trip untouched. */
export type NavItem = {
    label: string;
    href: string;
    external?: boolean;
    children?: NavItem[];
} & Record<string, unknown>;
/** Why `href` can't be a menu link, or null when it can: a site path
 *  ("/about"), a fragment ("#", "#team") or an absolute http(s) URL. Every
 *  other scheme is refused, `javascript:` foremost, since a site renders
 *  these straight into `<a href>`. */
export declare function navHrefError(href: string): string | null;
/** Throws on the first unsafe href in a site doc's `nav` (children
 *  included) or `cta`, or on submenus nested deeper than `MAX_NAV_DEPTH`.
 *  The store runs it on every draft of the site doc, so no caller can write
 *  a link the editor would refuse. Items of another shape are left alone:
 *  they are not menu links. */
export declare function assertSafeNav(meta: Record<string, unknown>): void;
/** The site doc's menu, or null when it has none: a site whose header is
 *  built in its own code. Entries that aren't items are left out. */
export declare function readMenu(meta: Record<string, unknown>): {
    nav: NavItem[];
    cta?: NavItem;
} | null;
/** Whether any menu item, submenus included, links to `path`. */
export declare const linksTo: (nav: NavItem[], path: string) => boolean;
/** `nav` without the items linking to `path`; a removed item's submenu
 *  moves up into its place, so unlinking a page never drops other links. */
export declare function unlink(nav: NavItem[], path: string): NavItem[];
/** `nav` with every item linking to `from`, submenus included, pointed at
 *  `to` instead, keeping its query, fragment or trailing slash. */
export declare function relink(nav: NavItem[], from: string, to: string): NavItem[];

// ---- dist/notion-adapter.d.ts ----
import type { ContentAdapter } from "./types.js";
import { type NotionBlock } from "./notion-blocks.js";
export type { NotionBlock } from "./notion-blocks.js";
/** Notion property types this adapter can round-trip: text, numbers,
 *  single/multi enums, booleans, dates, and a relation to another database,
 *  not Notion's full property-type list (no formula, rollup, people, files:
 *  none of those round-trip meaningfully through a plain read/write value,
 *  being either computed or reference-shaped in ways a generic mapper can't
 *  own). A site with a genuine need for one of those maps it via its own
 *  property glue rather than growing this list. */
export type NotionPropertyType = "title" | "rich_text" | "number" | "select" | "status" | "multi_select" | "checkbox" | "date" | "email" | "phone_number" | "url" | "relation";
/** metaKey -> which Notion property backs it and how to (de)serialize it.
 *  Every key here becomes a field on the record's `meta`; any other property
 *  on the Notion row is ignored (not read, not written, not clobbered). */
export type NotionPropertyMap = Record<string, {
    name: string;
    type: NotionPropertyType;
}>;
/** Raw per-property JSON Notion returns/expects for one property, e.g.
 *  `{ number: 42 }`, `{ title: [{ plain_text: "..." }] }`. Untyped beyond
 *  "a JSON object", its shape depends on the property's Notion type. */
export type NotionRawProperty = Record<string, unknown>;
/** One Notion database row, trimmed to what this adapter needs. `properties`
 *  is keyed by Notion property name. */
export type NotionPage = {
    id: string;
    archived: boolean;
    properties: Record<string, NotionRawProperty>;
    /** The database this row actually belongs to (Notion's `parent` field,
     *  present on any page that is a database row). Checked against the
     *  configured `databaseId` when a slug resolves straight to a page id (no
     *  `slugProperty`): a page id is a bare opaque string a caller controls, so
     *  nothing else stops it from naming a row in a DIFFERENT database this
     *  adapter instance was never configured for. */
    parent?: {
        database_id?: string;
    };
};
/**
 * The seam between the adapter and Notion's HTTP API, mocked directly in
 * tests (see notion-adapter.test.ts), so no network/HTTP-mocking library is
 * needed to unit-test the adapter's read/write/mapping logic. Every method is
 * async, matching `ContentAdapter` (issue #29) and Notion's own HTTP API.
 */
export interface NotionClient {
    /** Every non-archived row in the database (pagination is the client's problem). */
    queryDatabase(databaseId: string): Promise<NotionPage[]>;
    /** `null` when the page id doesn't exist OR is archived (this adapter
     *  treats "archived" as "deleted", see `deletePublished`). */
    retrievePage(pageId: string): Promise<NotionPage | null>;
    createPage(databaseId: string, properties: Record<string, NotionRawProperty>): Promise<NotionPage>;
    updatePage(pageId: string, properties: Record<string, NotionRawProperty>): Promise<NotionPage>;
    /** Notion has no hard delete via the API, only archive (= its trash). */
    archivePage(pageId: string): Promise<void>;
    /** A page's block children, recursively resolved (each returned block's own
     *  `children` is already populated when `has_children` is true), see
     *  notion-blocks.ts for what they turn into. Only called when a
     *  `NotionAdapterOptions.content` of `"blocks"` is configured; omit it on a
     *  client that never backs such a collection. */
    listBlockChildren?(pageId: string): Promise<NotionBlock[]>;
}
export type NotionAdapterOptions = {
    client: NotionClient;
    databaseId: string;
    properties: NotionPropertyMap;
    /** metaKey of a plain-text-valued property (title/rich_text/select/status)
     *  that uniquely and stably identifies a row, used as the record slug in
     *  place of the Notion page id. Required to CREATE new records through this
     *  adapter (`writeRaw` on an unknown slug): a page id doesn't exist until
     *  Notion assigns one, so it can't be the slug a caller picks up front.
     *  Omit for read/update/delete-only use against rows that already exist
     *  (slug = Notion page id), fine for collections whose records are only
     *  ever created in Notion directly. */
    slugProperty?: string;
    /** metaKey of a rich_text property to round-trip as `PageContent.body`.
     *  Ignored when `content: "blocks"` or `"slices"` is set. Omit both for a
     *  property-only collection (body is always ""), the normal case for a
     *  row-shaped record. */
    bodyProperty?: string;
    /** `"blocks"`: `body` is the page's own block content (paragraphs,
     *  headings, lists, ...) converted to markdown (see notion-blocks.ts)
     *  instead of a `bodyProperty` column.
     *
     *  `"slices"`: the page reads as a full typren page record, `body` is
     *  always `""` and `slices` comes from running the same block tree through
     *  `blocksToSegments` + `pageRecordFrom` (prose runs become a `"prose"`
     *  slice carrying markdown, `::componentName` directives become named
     *  slices in document order). The host's slice registry resolves each
     *  `slice` name at render time; a name with no registered component is the
     *  registry's problem, not this adapter's, it degrades the same way any
     *  other unregistered slice does there (see `SliceZone`'s scaffold),
     *  never a throw here.
     *
     *  Both need a `client` whose `listBlockChildren` is implemented (throws
     *  loud otherwise). READ-ONLY for now: `writeRaw`/`writeDraftRaw` still
     *  only push `properties` (see the `content` note on
     *  `createNotionAdapter`'s own doc comment), a body/slice edit against a
     *  blocks- or slices-backed record is not written back to Notion yet.
     *  Default `"none"` keeps the `bodyProperty`/property-only behavior
     *  unchanged. */
    content?: "blocks" | "slices" | "none";
    locales?: string[];
    defaultLocale?: string;
};
/**
 * Notion-backed `ContentAdapter`. One database row = one record; `meta` is
 * the schema-shaped prop bag (see `NotionPropertyMap`), `body` is optional
 * (see `bodyProperty`). `slices` is `[]` unless `content: "slices"` is set,
 * in which case a page's own block content is read as an ordered list of
 * typren slices (see the `content` doc on `NotionAdapterOptions`), matching
 * how a markdown *page* record already carries slices, just sourced from
 * Notion blocks instead of frontmatter.
 *
 * typren: Notion has no draft/publish distinction (unlike the filesystem
 * adapter's separate `.drafts` dir), every draft op writes straight through
 * to the published row (`writeDraftRaw` calls the same path as `writeRaw`;
 * `readDraftRaw`/`hasDraft` always report "no draft" so `ContentStore.publish`
 * safely no-ops after the write-through already landed). This drops
 * optimistic-locking and "unpublished changes" UX for Notion-backed
 * collections. Parked as an open question for Gabriel (queue
 * T-20260810-riau-06), not silently dropped: revisit if the admin needs a
 * real draft/review step, e.g. writing to a "Draft" Notion property or a
 * shadow database instead of aliasing to published.
 *
 * typren: `content: "blocks"` and `content: "slices"` (see
 * `NotionAdapterOptions`) both read a page's own block content but do NOT
 * write it back, `writeRaw` only ever pushes `properties`. A body/slice
 * edit against such a record is silently (from Notion's point of view;
 * loudly from this code's, via the one-time `console.warn` below) NOT
 * persisted. typren TODO: slice write-back needs a segments -> blocks
 * inverse of `blocksToSegments` (a lossy, rate-limit-heavy replace: delete
 * existing children, append new ones) plus a decision on how an edited prose
 * slice's markdown maps back to Notion's rich-text block shapes; land it
 * once the read side (this adapter + notion-blocks.ts) has seen real use.
 */
export declare function createNotionAdapter({ client, databaseId, properties, slugProperty, bodyProperty, content, defaultLocale, locales, }: NotionAdapterOptions): ContentAdapter;
/** Real `NotionClient` against `https://api.notion.com`. `token` is an
 *  internal-integration secret, pass it from `process.env` only (never
 *  commit one); the caller owns getting it there. `fetchImpl` is injectable
 *  for tests, same convention as github-adapter.ts, defaults to the global
 *  `fetch`. */
export declare function createFetchNotionClient(token: string, fetchImpl?: typeof fetch): NotionClient;

// ---- dist/notion-blocks.d.ts ----
import type { PageContent } from "./types.js";
/**
 * Notion block tree -> typren content, generic and dependency-free: this
 * file knows Notion block SHAPES (paragraph/heading/list/code/table/...),
 * never a site's entities or components. Block payloads are Notion's raw
 * per-type JSON (e.g. `{ rich_text: [...] }` under `paragraph`), so types
 * here stay loose (`Record<string, unknown>`) the same way notion-adapter.ts's
 * property mapper does.
 *
 * Two-stage pipeline:
 *   blocks -> segments (`blocksToSegments`): an ordered list of either prose
 *     (a run of plain content blocks) or a component call (see the directive
 *     convention below). This is the shape closest to what the page actually
 *     contains.
 *   segments -> output: `blocksToMarkdown` renders the prose segments back
 *     into one markdown string (component segments become a visible comment,
 *     never silently vanish); `pageRecordFrom` instead maps EVERY segment,
 *     prose and component alike, into one ordered typren `slices` array;
 *     see its own doc comment for why that mapping is lossless.
 *
 * Component-call convention (generic, no entity/component names live here):
 * a `callout` or `code` block whose first line is `::componentName` is a
 * component call; every remaining line is JSON (not YAML, no yaml parser is
 * already a dependency of this package, and hand-authoring one JSON object
 * in a Notion code block is a small ask) parsed as that component's props.
 * Malformed JSON, a missing name, or an empty prop body after the `::name`
 * line all degrade to treating the block as ordinary prose rather than
 * throwing, a typo in Notion should never break the whole page read.
 */
/** One Notion block, trimmed to what conversion needs. `children` is only
 *  present when the caller (see NotionClient.listBlockChildren) already
 *  resolved nested blocks, this module never fetches anything itself. */
export type NotionBlock = {
    id: string;
    type: string;
    has_children?: boolean;
    children?: NotionBlock[];
} & Record<string, unknown>;
export type ProseSegment = {
    kind: "prose";
    blocks: NotionBlock[];
};
export type ComponentSegment = {
    kind: "component";
    name: string;
    props: Record<string, unknown>;
};
export type NotionSegment = ProseSegment | ComponentSegment;
/** A Notion rich_text array -> one inline markdown string (bold/italic/
 *  strikethrough/code/link annotations applied). */
export declare function richTextToMarkdown(runs: unknown): string;
/** Group a page's top-level blocks into an ordered list of prose runs and
 *  component calls (see this file's header for the directive convention).
 *  Nested children of a NON-directive block stay attached to it and render
 *  as part of whichever prose segment that block belongs to (see
 *  `blocksToMarkdown`'s use of `renderBlocks`, which walks `children`). */
export declare function blocksToSegments(blocks: NotionBlock[]): NotionSegment[];
/** Notion block children (already recursively resolved, see
 *  `NotionClient.listBlockChildren`) -> one markdown string: every PROSE
 *  segment rendered and joined (paragraph, heading_1/2/3, bulleted/numbered
 *  lists, to_do, quote, code, divider, image, table, toggle, bookmark/
 *  link_preview/embed; anything else degrades to an HTML comment, see
 *  `renderBlock`). A component segment (see the directive convention above)
 *  is NOT prose, it becomes a visible marker comment instead of silently
 *  disappearing from the body; callers that want it realized as a real
 *  component belong in `pageRecordFrom` instead. */
export declare function blocksToMarkdown(blocks: NotionBlock[]): string;
/** Segments -> a typren `PageContent`, ordered slices only (no `body`): a
 *  prose segment becomes one `{ slice: proseSlice, markdown }` entry, a
 *  component segment becomes `{ slice: name, ...props }`, the exact shape
 *  `CmsConfig.registry` already expects (see types.ts's `Slice`). This is
 *  lossless on ORDER (typren's `slices` is itself an ordered array, so
 *  interleaved prose/component runs survive exactly as authored) but NOT on
 *  markdown-body position: typren's page model renders `slices` and `body`
 *  as two separate channels, not one interleaved stream, so putting every
 *  segment into `slices` (leaving `body` empty) is the one mapping that
 *  doesn't need a channel that doesn't exist. A host must register a
 *  `proseSlice`-named component (default `"prose"`) that renders `markdown`,
 *  same as registering any other slice; this module doesn't render one. */
export declare function pageRecordFrom(segments: NotionSegment[], opts?: {
    proseSlice?: string;
    meta?: Record<string, unknown>;
}): PageContent;

// ---- dist/proxy.d.ts ----
/** Current `adminRoute` from `typren.config.json`, mtime-cached so a steady
 *  file only costs one `statSync` per request, not a `readFileSync` too.
 *  Missing file (`throwIfNoEntry: false`) or missing/invalid field -> "editor". */
export declare function currentAdminRoute(file?: string): string;
/** `previewPath` derived from the live admin route, so it can never drift
 *  from whatever `currentAdminRoute` reports. */
export declare function previewPathFor(adminRoute: string): string;
/**
 * Maps `/<adminRoute>/**` -> `/editor/**`; returns null when no rewrite
 * applies (adminRoute is still the default "editor", or the path isn't under
 * the admin route at all) so a host's proxy can fall through to its own logic.
 * Accepts `URL | string` (matches `request.nextUrl` or a plain path) rather
 * than a `NextRequest`, so this stays testable without a `next/server` import
 * and works the same whether the host is on the Node.js or edge convention.
 */
export declare function typrenProxyRewrite(url: URL | string, opts?: {
    configFile?: string;
}): string | null;
/**
 * True when `url` hits `/editor/**` directly while a renamed `adminRoute`
 * means that's no longer the live admin path. A host wires this ahead of
 * `typrenProxyRewrite` (see the module doc comment) to 404 it: without this,
 * renaming the admin route for URL hygiene was purely cosmetic -- the OLD
 * path kept serving the editor side by side with the new one, forever.
 */
export declare function typrenBlocksDirectEditorAccess(url: URL | string, opts?: {
    configFile?: string;
}): boolean;

// ---- dist/redirect-sources.d.ts ----
import type { ContentStore } from "./store.js";
import type { RedirectEntry } from "./redirects.js";
import { type RedirectStatus } from "./static-host.js";
/**
 * Minimal read-only `ContentStore` built by scanning a content directory's
 * flat `*.md` files directly, rather than importing a host's `cms.config.ts`
 * (which imports "server-only" and throws outside a React Server Component
 * build, the same constraint `typren review`'s `listCmsPageSlugs`/`parsePage`
 * in packages/cli work around, mirrored here). Only `listPages`/`getPublished`
 * are real; `buildRedirects` (this module's only caller) needs nothing else.
 *
 * ponytail: default-locale, flat-file layout only, same scope `typren review`
 * already covers. No draft/i18n/collection support: a redirects sync doesn't
 * need it, and buildRedirects itself is single-locale (see redirects.ts).
 */
export declare function scanContentStore(contentDir: string): ContentStore;
/** One entry in a host-supplied redirect map file: an incoming on-site path
 *  and where it should redirect to (an on-site path or an absolute http(s)
 *  URL). `status` defaults to 301 (migrators from `_redirects`/`vercel.json`
 *  expect per-entry 302/307/308; see static-host.ts's REDIRECT_STATUSES). */
export type RedirectMapEntry = {
    from: string;
    to: string;
    status?: RedirectStatus;
};
/**
 * Loads a host-supplied redirect map file into validated `RedirectEntry[]`,
 * the same shape `buildRedirects` emits, so both sources merge into one
 * sync. This is what makes a host's redirect sync useful beyond a typren
 * site: frontmatter aliases describe pages that exist in a content store,
 * while a map file carries everything else a real site accumulates (legacy
 * platform URLs, removed pages, paths that moved off-site entirely).
 *
 * Formats, by extension:
 *   - `.json`: an array of `{ "from": "/old", "to": "/new-or-https-url" }`
 *   - `.mjs`/`.js`: a module whose default export (or a named `REDIRECTS` /
 *     `redirects` export) is that same array. A config module may compute its
 *     entries; the JSON form exists for hosts that would rather not execute
 *     code from the map.
 *
 * Validation (fail loud, never silently drop, matching buildRedirects):
 * `from` must be an absolute on-site path; `to` must be an absolute on-site
 * path or an absolute http(s) URL; `status`, if present, must be one of
 * REDIRECT_STATUSES; duplicate `from`s (after trailing-slash normalization)
 * throw. Entry `slug`s carry the map file's name so a merge collision names
 * its source.
 */
export declare function loadRedirectMap(cwd: string, file: string): Promise<RedirectEntry[]>;
/**
 * Merges content-derived entries with map-file entries, refusing a `from`
 * claimed by both sources (a silent override in either direction would make
 * one source's edit mysteriously not take effect) and a map `from` that
 * shadows a live page's canonical path (which would 301 a real page away;
 * the same guard buildRedirects applies to frontmatter aliases, which the
 * map path would otherwise bypass). `pagePaths` are the canonical public
 * paths of the scanned pages; pass nothing when there is no content store to
 * shadow.
 */
export declare function mergeRedirectEntries(content: RedirectEntry[], map: RedirectEntry[], pagePaths?: string[]): RedirectEntry[];
export type ToRedirectPairsOptions = {
    /** Append the canonical trailing slash to on-site page targets (the
     *  `trailingSlash: true` static-export shape, and the default). A site
     *  whose canonical URLs are the bare form passes `false` and targets are
     *  emitted verbatim. */
    appendSlash?: boolean;
};
/**
 * Converts validated `RedirectEntry[]` into the key/value pairs a host's
 * redirect store wants: the `from` percent-encoded (the form an edge sees a
 * request path in) and the `to` canonicalized to the site's trailing-slash
 * convention. Host-agnostic; a vendor-specific byte-limit check (CloudFront's
 * KVS, say) belongs at the emitter that knows about it, not here (see
 * `@typren/adapter-cloudfront`'s `toKvsEntries`, a thin wrapper around this).
 */
export declare function toRedirectPairs(entries: RedirectEntry[], opts?: ToRedirectPairsOptions): {
    key: string;
    value: string;
}[];

// ---- dist/redirects.d.ts ----
import type { ContentStore } from "./store.js";
import type { RedirectStatus } from "./static-host.js";
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
export declare function buildRedirects(store: ContentStore, opts?: BuildRedirectsOptions): Promise<RedirectEntry[]>;

// ---- dist/sections.d.ts ----
import type { ComponentType } from "react";
import type { ContentAdapter, MediaAdapter, MediaAsset, MediaUse, SliceSchema } from "./types.js";
import type { PageActions } from "./actions.js";
import type { Messages } from "./i18n.js";
import type { SiteSettings, SettingsStore } from "./settings.js";
export type FieldFormMedia = {
    list: () => Promise<MediaAsset[]>;
    /** Refused while content uses the asset, unless `opts.force`. */
    delete: (id: string, opts?: {
        force?: boolean;
    }) => Promise<void>;
    /** Uploads POST multipart "file", plus "folder" when uploading into one. */
    uploadPath: string;
    /** Where each asset URL is referenced; omit to hide usage. */
    usage?: () => Promise<Record<string, MediaUse[]>>;
    /** Folder support (see `MediaAdapter.listFolders`); omit for a flat library. */
    folders?: {
        list: () => Promise<string[]>;
        create: (folder: string) => Promise<void>;
        delete: (folder: string) => Promise<void>;
        /** Moves an asset, renaming it when `name` is given. */
        move: (id: string, folder: string, name?: string) => Promise<MediaAsset>;
        /** Renames or moves a folder to the path `to`. */
        rename: (folder: string, to: string) => Promise<void>;
    };
};
/** Bump ONLY on a breaking change to SectionCtx or the custom mount/element
 *  calling convention. A custom section can runtime-check this and degrade
 *  instead of crashing. Adding a new BUILT-IN kind is additive and never bumps
 *  this (see the switch convention in the spec). */
export declare const SECTION_API_VERSION: 1;
interface SectionBase {
    /** Stable identity for nav highlighting + the `/editor/<id>` route segment.
     *  Defaults: built-in singletons use `kind`; collection/custom fall back to
     *  slug(label) but SHOULD be set so renaming `label` never breaks a link. */
    id?: string;
    label: string;
    /** Inline lucide svg from icons.ts, or omit for a kind-default icon. */
    icon?: unknown;
    /** Figma "Content" / "Other" grouping. Open string: unknown groups render
     *  in registration order after the known ones, never dropped. */
    group?: "content" | "other" | (string & {});
}
export interface PagesSection extends SectionBase {
    kind: "pages";
}
export interface MediaSection extends SectionBase {
    kind: "media";
}
export interface SettingsSection extends SectionBase {
    kind: "settings";
}
/** The Sections library: slices saved from the page editor (see library.ts). */
export interface LibrarySection extends SectionBase {
    kind: "library";
}
export interface CollectionSection extends SectionBase {
    kind: "collection";
    /** Repo-relative dir, e.g. "content/authors". Gets its OWN markdown-backed
     *  ContentAdapter instance. MUST NOT resolve inside the Pages contentDir
     *  (guarded at makeCollectionAdapter time, throws loud). Provide exactly
     *  one of `dir`/`adapter` (also guarded there). */
    dir?: string;
    /** Pre-built adapter for a non-filesystem backend (Notion, a KV store, ...).
     *  Used as-is, bypassing markdown-adapter construction and the Pages dir-
     *  overlap guard entirely, an adapter owns its own storage, so there is no
     *  dir to overlap. Provide exactly one of `dir`/`adapter`. */
    adapter?: ContentAdapter;
    /** Reuses FieldDef/SliceSchema verbatim: a record IS a slice-shaped prop bag. */
    schema: SliceSchema;
    /** Which schema key is the list-view primary column. Default: "title", then
     *  the first schema key, then the slug. */
    titleField?: string;
    /** Explicit list columns. Default: first 4 schema keys, title-cased. */
    columns?: string[];
}
export interface CustomSection extends SectionBase {
    kind: "custom";
    /** Provide EXACTLY ONE of element/mount/host (validated at resolveSections
     *  time, throws loud on more or none). `element` = a registered custom element
     *  tag (config-serializable, AI-authorable as a string); `mount` = imperative
     *  fallback, returning an optional cleanup fn called on section switch. */
    element?: string;
    mount?: (host: HTMLElement, ctx: SectionCtx) => void | (() => void);
    /** `host: true` = the EMBEDDING SHELL renders this section itself, keyed by
     *  `id`. For a React host that owns its own screens, requiring a custom
     *  element or an imperative mount would mean wrapping a React tree in a
     *  fake mount just to satisfy the contract. A section can instead declare
     *  that its renderer lives in the host. A generic shell can't render these
     *  and should say so loudly rather than paint an empty pane. */
    host?: true;
}
/** Plain union, NOT closed by a `never`-exhaustive host convention (see the
 *  spec's forward-compat switch convention). Adding a built-in kind later is
 *  an ADDITIVE change here. */
export type Section = PagesSection | MediaSection | SettingsSection | LibrarySection | CollectionSection | CustomSection;
export type SectionKind = Section["kind"];
/**
 * The ONE context object every section renderer (built-in or custom) reads.
 * GROWTH RULE (binding): fields are added, never renamed/removed; a field's
 * type only widens. Removal requires a SECTION_API_VERSION major bump.
 */
export interface SectionCtx {
    readonly apiVersion: typeof SECTION_API_VERSION;
    readonly config: {
        /** Server-only handles, hence optional: every element that reads this ctx
         *  runs in the browser, so a host assembling the ctx client-side (the
         *  normal case in a React-Server-Components app, since a slice registry of
         *  components and an fs-backed adapter can't cross that boundary) simply
         *  omits them. Nothing in the shell reads either one client-side; they're
         *  here for a section renderer that does have server reach. */
        readonly registry?: Record<string, ComponentType<unknown>>;
        readonly adapter?: ContentAdapter;
        /** `list`/`delete` only: the two a browser can call. Uploads go through
         *  the host's upload route (`MediaSectionProps.uploadPath`), never this
         *  handle, so a full server-side `MediaAdapter` satisfies this and a
         *  client-side facade of two server actions does too. */
        readonly mediaAdapter?: Pick<MediaAdapter, "list" | "delete">;
    };
    /** Pages-section actions: the existing PageActions, unchanged shape. */
    readonly actions: PageActions;
    /** One PageActions per declared collection, keyed by section id. */
    readonly collections: Record<string, PageActions>;
    /** Live read/write for runtime SiteSettings (brand/SEO/theme). */
    readonly settings: SettingsStore;
    /** Read-only settings snapshot for chrome (brand logo in the nav, etc.). */
    readonly settingsSnapshot: SiteSettings;
    readonly media?: FieldFormMedia;
    readonly messages?: Partial<Messages>;
    readonly locale: string;
    readonly locales: string[];
    readonly defaultLocale: string;
    /** Navigate to another section (full navigation to `/editor/<id>`). */
    navigate(sectionId: string): void;
    /** Contribute a top-bar right-slot action (e.g. collection "+ New").
     *  Optional; a section that never calls it puts nothing there. Returns an
     *  unregister fn; call with null to clear. */
    setTopBarAction(action: {
        label: string;
        onClick: () => void;
    } | null): void;
    /** Feature-detection over version-sniffing: custom sections check
     *  `ctx.capabilities.has("collections.v1")` rather than branching on
     *  apiVersion. Strings are only ever added, never removed. */
    readonly capabilities: ReadonlySet<string>;
}
/** Resolved section the shell renders, every default filled. Internal. */
export interface ResolvedSection {
    raw: Section;
    id: string;
    label: string;
    kind: SectionKind;
    group: string;
    icon?: unknown;
}
export declare const DEFAULT_SECTIONS: Section[];
/** Back-compat resolver, same shape/spirit as resolveI18n(). Omitted or empty
 *  sections → DEFAULT_SECTIONS. Also fills ids/defaults and validates loud. */
export declare function resolveSections(config: {
    sections?: Section[];
}): ResolvedSection[];
export {};

// ---- dist/seo/index.d.ts ----
export type { PageSeoMeta, SliceJsonLd, OrganizationConfig, SeoConfig } from "./types.js";
export { JsonLd, organizationJsonLd, websiteJsonLd, breadcrumbJsonLd } from "./json-ld.js";
export { collectSliceJsonLd } from "./slice-registry.js";
export { buildRootMetadata, buildMetadata } from "./metadata.js";
export { buildSitemap, type BuildSitemapOptions } from "./sitemap.js";
export { withSiteSettings, resolveSeoConfig } from "./site-settings.js";
export { buildRobots, DEFAULT_AI_CRAWLERS } from "./robots.js";
export { renderSlicesAsMarkdown, type SliceMarkdownRegistry } from "./markdown-render.js";
export { createMarkdownRouteHandler, createMarkdownMirrorMiddleware, matchMarkdownMirrorSlug, } from "./markdown-route.js";
export { generateLlmsFullTxt } from "./llms-txt.js";

// ---- dist/seo/json-ld.d.ts ----
import type { SeoConfig } from "./types.js";
/**
 * Renders a JSON-LD <script> tag. Escapes `<` so a `</script>` (or any other
 * tag) can never appear literally inside the payload and break out of the
 * script context. This is the standard mitigation for embedding untrusted-shaped
 * JSON in HTML (OWASP "JSON in HTML" guidance).
 */
export declare function JsonLd({ data }: Readonly<{
    data: object;
}>): import("react").JSX.Element;
export declare function organizationJsonLd(config: SeoConfig): {
    sameAs?: string[] | undefined;
    parentOrganization?: {
        "@type": string;
        name: string;
    } | undefined;
    description: string;
    logo?: string | undefined;
    url: string;
    alternateName?: string | undefined;
    "@context": string;
    "@type": string;
    name: string;
};
export declare function websiteJsonLd(config: SeoConfig): {
    "@context": string;
    "@type": string;
    name: string;
    url: string;
};
/** items: ordered list, position is 1-based index + 1. First item is
 *  conventionally the site's Home page. Pass `path: ""` for it so its
 *  `item` URL is the bare site root, not `${siteUrl}/`. */
export declare function breadcrumbJsonLd(config: SeoConfig, items: {
    name: string;
    path: string;
}[]): {
    "@context": string;
    "@type": string;
    itemListElement: {
        "@type": string;
        position: number;
        name: string;
        item: string;
    }[];
};

// ---- dist/seo/llms-txt.d.ts ----
import type { ContentStore } from "../store.js";
import { type SliceMarkdownRegistry } from "./markdown-render.js";
/** Generates a detailed, always-fresh markdown export of every page in the
 *  store: the "llms-full.txt" companion to a hand-curated llms.txt (this
 *  function does NOT replace a curated summary file: a hand-authored
 *  llms.txt still needs a human author for marketing copy). */
export declare function generateLlmsFullTxt(store: ContentStore, renderOverrides?: SliceMarkdownRegistry): Promise<string>;

// ---- dist/seo/markdown-render.d.ts ----
import type { Slice } from "../types.js";
/** Best-effort generic slice -> prose flattener: pulls heading/body (common
 *  to nearly every slice), plus common repeating-item shapes (columns/cards/
 *  items/quotes/stats), each rendered as "title: body"-style lines. This is
 *  a *default*, not a registry: a typren consumer whose slices don't fit
 *  this shape can pass its own `renderSlice` override per slice name (mirrors
 *  the sliceJsonLd registry's opt-in shape) via `overrides`. */
export type SliceMarkdownRegistry = Record<string, (props: Record<string, unknown>) => string>;
/** Renders one page's slices as plain-text prose, in slice order. Used for
 *  both the raw-markdown mirror and llms-full.txt: one flattening pass, two
 *  consumers, so a slice-shape fix only happens once. */
export declare function renderSlicesAsMarkdown(slices: Slice[], overrides?: SliceMarkdownRegistry): string;

// ---- dist/seo/markdown-route.d.ts ----
import { NextResponse, type NextRequest } from "next/server.js";
import type { ContentStore } from "../store.js";
import { type SliceMarkdownRegistry } from "./markdown-render.js";
/** Matches "/some-slug.md" (single path segment) and returns the slug, or
 *  null. A pure function (no fs/req access) so both middleware (URL rewrite)
 *  and any other router glue can reuse the same match rule. */
export declare function matchMarkdownMirrorSlug(pathname: string): string | null;
/** Route Handler factory: GET returns "# Title\n\n<flattened slices>" as
 *  text/markdown for a known slug, 404 for an unknown one. Mount at any path
 *  (e.g. src/app/md/[slug]/route.ts) and pair with createMarkdownMirrorMiddleware
 *  (or your own rewrite) to expose it at "/<slug>.md". Next's dynamic Route
 *  Handler segments resolve `params` as a Promise (same as page.tsx). */
export declare function createMarkdownRouteHandler(store: ContentStore, renderOverrides?: SliceMarkdownRegistry): {
    GET(_req: NextRequest, { params }: {
        params: Promise<{
            slug: string;
        }>;
    }): Promise<NextResponse<unknown>>;
};
/** Returns a NextRequest -> NextResponse handler that rewrites "/<slug>.md"
 *  -> "<mirrorPath>/<slug>" so the route handler above (mounted at
 *  mirrorPath) serves it transparently. Ship this as (part of) the host's
 *  proxy file (Next's `middleware.ts` file convention was renamed to
 *  `proxy.ts` in Next 16, so this factory works unchanged either way, only the
 *  host filename/export name changed). This module exports the matcher
 *  separately so a host with other proxy concerns can compose them. */
export declare function createMarkdownMirrorMiddleware(mirrorPath: string): (request: NextRequest) => NextResponse<unknown>;

// ---- dist/seo/metadata.d.ts ----
import type { Metadata, ResolvingMetadata } from "next";
import type { PageContent } from "../types.js";
import type { I18nConfig } from "../i18n.js";
import type { SeoConfig } from "./types.js";
/** Root-layout `metadata` object defaults: everything a Next app's
 *  layout.tsx hand-writes today, parameterized. Host still adds anything
 *  fully site-specific (e.g. Search Console `verification`) by spreading
 *  the result and adding keys. */
export declare function buildRootMetadata(config: SeoConfig): Metadata;
/** Per-page Metadata for a slug-routed page, reading the page's frontmatter
 *  (PageSeoMeta fields live directly in PageContent.meta, no new file
 *  format). The caller is responsible for resolving `slug` to a `PageContent`
 *  first (e.g. via a ContentStore) and handling an unknown slug itself.
 *  This function never throws, so it never needs fs-mocking to test. */
export declare function buildMetadata(page: PageContent, slug: string, config: SeoConfig, parent: ResolvingMetadata,
/** When given with more than one locale, adds hreflang `alternates.languages`
 *  (+ x-default) and localizes the canonical for `locale`. With a single
 *  locale (or omitted) the output is byte-identical to the non-i18n build. */
i18n?: I18nConfig, locale?: string): Promise<Metadata>;

// ---- dist/seo/robots.d.ts ----
import type { MetadataRoute } from "next";
import type { SeoConfig } from "./types.js";
/** AIO: named AI/answer-engine crawlers, explicitly allow-listed even though
 *  redundant with a wildcard allow, kept explicit as a one-line future
 *  revert point (a project may later decide to block training crawlers). */
export declare const DEFAULT_AI_CRAWLERS: readonly ["GPTBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot"];
export declare function buildRobots(config: SeoConfig): MetadataRoute.Robots;

// ---- dist/seo/site-settings.d.ts ----
import type { SettingsStore, SiteSettingsRuntime } from "../settings.js";
import type { SeoConfig } from "./types.js";
/** Overlays the saved Site Settings onto a code `SeoConfig`, field by field.
 *  A non-empty saved value wins; the code value is the fallback, so a site
 *  with no settings doc (or blank fields) renders exactly as it did before.
 *  Pure: no I/O. Mapping: brand.name -> siteName, brand.logo ->
 *  organization.logo (Organization JSON-LD), seo.titleTemplate ->
 *  titleTemplate, seo.description -> defaultDescription, seo.ogImage ->
 *  defaultOgImage. `brand.logoDark` has no SEO surface and is not read. */
export declare function withSiteSettings(config: SeoConfig, settings: Partial<SiteSettingsRuntime> | undefined): SeoConfig;
/** Reads the published settings and overlays them (see `withSiteSettings`).
 *  Call once per request in `generateMetadata`, the root layout, sitemap and
 *  robots; the store read is cheap and the result is never cached here. */
export declare function resolveSeoConfig(config: SeoConfig, settings: Pick<SettingsStore, "get">, locale?: string): Promise<SeoConfig>;

// ---- dist/seo/sitemap.d.ts ----
import type { MetadataRoute } from "next";
import type { ContentStore } from "../store.js";
import type { I18nConfig } from "../i18n.js";
import type { SeoConfig } from "./types.js";
export type BuildSitemapOptions = {
    /** Slug that maps to the site root ("/") instead of "/<slug>", e.g. "home". */
    homeSlug?: string;
    defaultChangeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
    defaultPriority?: number;
    /** When given with more than one locale, emits one entry per (locale, slug)
     *  with `alternates.languages` hreflang. Single locale (or omitted) is
     *  byte-identical to the non-i18n sitemap. */
    i18n?: I18nConfig;
};
/** One entry per page in the store, honoring per-page `noindex`/`sitemap`
 *  frontmatter overrides. Does NOT know about non-CMS collections (e.g. a
 *  separate hosted-resources collection). The host concats those itself. */
export declare function buildSitemap(store: ContentStore, config: SeoConfig, opts?: BuildSitemapOptions): Promise<MetadataRoute.Sitemap>;

// ---- dist/seo/slice-registry.d.ts ----
import type { Slice } from "../types.js";
import type { SliceJsonLd } from "./types.js";
/** Walks a page's slices, calls each one's registered SliceJsonLd (if any),
 *  and flattens the results into one array. The host renders these once per
 *  page next to BreadcrumbList, instead of each slice component rendering its
 *  own <script> tag (today's ad hoc faq.tsx behavior). Unregistered slice
 *  names are silently skipped, not an error: most slices have no schema. */
export declare function collectSliceJsonLd(slices: Slice[], registry?: Record<string, SliceJsonLd>): object[];

// ---- dist/seo/types.d.ts ----
import type { MetadataRoute } from "next";
import type { PageContent } from "../types.js";
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
        /** `lastmod` for this page, `YYYY-MM-DD` or full ISO datetime, passed
         *  through verbatim. Omitted → the entry carries no `lastmod` at all;
         *  buildSitemap never substitutes build time for a date it doesn't know. */
        lastModified?: string;
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

// ---- dist/settings.d.ts ----
import type { CmsConfig, ContentAdapter, MediaAsset } from "./types.js";
import type { RoutingMode } from "./i18n.js";
import type { SaveResult } from "./actions.js";
import type { GitLogEntry } from "./git.js";
/** Content-shaped, locale-aware, hot-editable: a reserved-slug PageContent in
 *  a PRIVATE dir (never the Pages dir). */
export interface SiteSettingsRuntime {
    /** `logoDark` is the variant for dark surfaces (the admin shell in dark mode).
     *  Optional: a host with a single logo that reads on both, or no logo at all,
     *  sets only `logo` and consumers fall back to it. */
    brand: {
        name: string;
        logo?: MediaAsset;
        logoDark?: MediaAsset;
    };
    seo: {
        titleTemplate?: string;
        description?: string;
        ogImage?: MediaAsset;
    };
    theme?: {
        preset?: "shadcn" | "neutral";
    };
    /** The site's `--typren-*` style tokens (custom property to value); see `styleCss`. */
    style?: Record<string, string>;
}
/** NOT locale-scoped, NOT adapter-managed. Small root JSON, read at server
 *  start (cms.config.ts), by the CLI, and optionally by proxy.ts (Wave 5). */
export interface SiteSettingsBootstrap {
    adminRoute: string;
    locales: string[];
    defaultLocale: string;
    routing: RoutingMode;
    onboarded: boolean;
}
export type SiteSettings = SiteSettingsRuntime & {
    bootstrap: SiteSettingsBootstrap;
};
export interface SettingsAdapter {
    readBootstrap(): SiteSettingsBootstrap;
    writeBootstrap(patch: Partial<SiteSettingsBootstrap>): void;
}
/** Keys `SettingsStore.writeBootstrap` (and so `PUT /settings/bootstrap`)
 *  may patch. Anything else in the patch is rejected before it ever reaches
 *  the adapter's `writeBootstrap`, which has no key allowlist of its own. */
export declare const BOOTSTRAP_KEYS: ReadonlySet<string>;
/**
 * Validates a FULL bootstrap (not a partial patch): the one check shared by
 * the Settings "Advanced" panel, the onboarding wizard's admin-route step,
 * `typren apply-settings` (packages/cli/src/cli.ts), and the settings store's
 * bootstrap write (`SettingsStore.writeBootstrap`), so a config that passes one passes all
 * four. Returns an error string, or null when valid. Reuses `resolveI18n`'s
 * own defaultLocale-in-locales check rather than re-deriving it.
 */
export declare function validateBootstrap(bs: SiteSettingsBootstrap): string | null;
/** Default bootstrap adapter: one root JSON, atomic tmp+rename write so no
 *  reader ever observes a half-written config that gates server boot. */
export declare function createFsSettingsAdapter(opts: {
    file: string;
}): SettingsAdapter;
export interface SettingsStore {
    get(locale?: string): Promise<SiteSettingsRuntime>;
    /** Version of the stored settings doc, for the same optimistic-lock flow pages
     *  use. Without this a client had nothing to seed `baseVersion` from, so its
     *  FIRST save passed `undefined`, which `store.saveDraft` treats as "no base
     *  version to check" and writes unconditionally, silently overwriting whatever
     *  another session had just saved. */
    currentVersion(locale?: string): Promise<string | null>;
    /** What the editor shows: the draft when there is one, else the published
     *  doc, with the version to save against. Read tier, as a page's draft is. */
    open(locale?: string): Promise<{
        settings: SiteSettingsRuntime;
        version: string | null;
        hasDraft: boolean;
    }>;
    saveDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
    publish(baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Drops the draft, so the published doc shows again. */
    discardDraft(locale?: string): Promise<void>;
    /** The settings doc's commits in a local git checkout, newest first; empty
     *  without git or a file-backed doc. */
    history(locale?: string, limit?: number): Promise<GitLogEntry[]>;
    /** Patches the bootstrap file, as admin: only `BOOTSTRAP_KEYS`, and only
     *  when the merged result passes `validateBootstrap`. A refused patch is
     *  data, its `error` written for the person changing it. */
    writeBootstrap(patch: Partial<SiteSettingsBootstrap>): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    bootstrap: SettingsAdapter;
}
/** The private content adapter beside the Pages one: settings and the saved
 *  slice library (see library.ts) live there as reserved-slug docs. */
export declare function privateContentAdapter(config: CmsConfig): ContentAdapter;
export declare function createSettingsStore(config: CmsConfig): SettingsStore;

// ---- dist/static-host.d.ts ----
/** Migrators from `_redirects`/`vercel.json` expect per-entry 301/302/307/308,
 *  not a hardcoded 301 (see parseRedirectValue). */
export declare const REDIRECT_STATUSES: readonly [301, 302, 307, 308];
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];
export type StaticHostDecision = {
    kind: "redirect";
    status: RedirectStatus;
    location: string;
} | {
    kind: "rewrite";
    path: string;
} | {
    kind: "pass";
};
/** Looks up a redirect target for an exact, trailing-slash-normalized key.
 *  A throw/rejection (store down) and a null/undefined/empty result both
 *  mean "no redirect here" to the caller. */
export type StaticHostOptions = {
    /** The export's URL shape, i.e. Next's `trailingSlash`. Default `true`:
     *  `/about/` serves `about/index.html`. `false` is Next's default export:
     *  `/about` serves `about.html`. */
    trailingSlash?: boolean;
};
export type RedirectLookup = (key: string) => Promise<string | null | undefined> | string | null | undefined;
export declare const STATIC_HOST_PASSTHROUGH: ReadonlySet<string>;
/** A redirect target arrives from a store an operator with write access can
 *  edit directly. Refuse to serve a target that is protocol-relative
 *  ("//host" resolves off-site), uses backslash (URL parsers read "\" as "/"),
 *  or carries control characters (header injection). Falling through serves
 *  the request instead. */
export declare function isUnsafeRedirectTarget(target: string): boolean;
/**
 * `path` is the request path exactly as received (CloudFront `uri` / URL
 * `pathname`, percent-encoded). `query` is the raw query string without a
 * leading "?", `""` when there is none, passed through verbatim: unlike the
 * CloudFront function, which rebuilds it from the runtime's parsed
 * querystring object, there is nothing to reassemble here.
 */
export declare function resolveStaticHostRequest(path: string, query: string, lookup: RedirectLookup, opts?: StaticHostOptions): Promise<StaticHostDecision>;

// ---- dist/store.d.ts ----
import type { ContentAdapter, LocalizedPage, PageContent, PageInfo } from "./types.js";
/** Normalize free text into a URL-safe slug: lowercase, alnum-and-dash only, no
 *  leading/trailing dashes. Shared by `createPage` (from a title) and
 *  `duplicatePage` (from a source slug + "-copy" suffix) so slug derivation
 *  can't drift between the two call sites. */
export declare function slugify(text: string): string;
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
    createPage(slug: string, page: PageContent, locale?: string, opts?: {
        draft?: boolean;
    }): Promise<void>;
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
export declare function createStore(adapter: ContentAdapter, opts?: {
    onPublish?: (slug: string, locale: string) => void | Promise<void>;
    onSaveDraft?: (slug: string, locale: string, version: string) => void;
    /** Default locale for fallback. Defaults to the adapter's. */
    defaultLocale?: string;
}): ContentStore;

// ---- dist/style.d.ts ----
/** The site's visual tokens as an editable `--typren-*` set. Stored on
 *  `SiteSettingsRuntime.style` (custom property name to value) and turned into
 *  CSS with {@link styleCss}; a site reads them with `var(--typren-primary, ...)`. */
/** `number` is unitless (a line height, a ratio). */
export type StyleTokenKind = "color" | "text" | "length" | "number";
export type StyleTokenGroup = "colors" | "typography" | "shape";
export interface StyleToken {
    /** The CSS custom property, always `--typren-*`. */
    name: string;
    label: string;
    group: StyleTokenGroup;
    kind: StyleTokenKind;
}
export declare const STYLE_TOKENS: readonly StyleToken[];
/** The known tokens of `style` whose values are safe to emit. */
export declare function sanitizeStyle(style: Record<string, string> | undefined): Record<string, string>;
/** Which of the site's own custom properties each token drives: a set token
 *  is emitted under its mapped name as well as its own, and the editor reads a
 *  token's current value from the mapped name. A site sets its own map as
 *  `studio.style` in `typren.config.json`; one that styles with `--typren-*`
 *  directly maps a token to itself.
 *  ponytail: a plain name-to-name map. A StyleAdapter (design-token files,
 *  per-mode values) is the upgrade once a site needs more than renaming. */
export type StyleMap = Readonly<Record<string, string>>;
/** The stock shadcn names, used when a site gives no map, so a shadcn
 *  site restyles with no config. The same names core's theme.css reads as its
 *  host fallbacks. */
export declare const STYLE_MAP_DEFAULT: StyleMap;
/** A custom property name safe to write into a stylesheet. */
export declare const CUSTOM_PROPERTY: RegExp;
/** Why `map` can't be a style map, or null when it can: every key a known
 *  token, every value a plain lowercase custom property name. */
export declare function styleMapError(map: unknown): string | null;
/** The name `token` writes to and is read from under `map`; the token itself
 *  when the map leaves it out. */
export declare function mappedName(token: string, map?: StyleMap): string;
/** The declarations a site style makes: each safe token under its own name
 *  and its mapped one, with the same concrete value. A site whose CSS sets
 *  `--typren-x: var(--x)` gets both overridden at once, so neither refers to
 *  the other and no cycle can form. An invalid map entry is skipped. */
export declare function styleVars(style: Record<string, string> | undefined, map?: StyleMap): Record<string, string>;
/** A rule for the site's stylesheet (empty string when nothing is set). The
 *  doubled `:root:root` outranks the site's own `:root`, `.dark` and
 *  `html.dark` blocks whatever order the stylesheets load in or which layer
 *  they sit in, as long as this rule is unlayered; only `!important` or an
 *  inline style on `<html>` beat it. */
export declare function styleCss(style: Record<string, string> | undefined, map?: StyleMap): string;

// ---- dist/templates/init.d.ts ----
export declare const TYPREN_REWRITE_MARKER = "typren:admin-route-rewrite";
export declare const TYPREN_BOOTSTRAP_MARKER = "typren:bootstrap-wired";
/** Every file \`typren init\` scaffolds, keyed by path relative to the
 *  detected project base dir ("src" when the project has \`src/app\`, "."
 *  when it has a root-level \`app\`). \`contentDirLiteral\` is the same base
 *  dir joined with "content" (e.g. "src/content" or "content"). A key
 *  starting with "/" is project-ROOT-relative regardless of baseDir (see
 *  ../cli.ts's \`scaffold\`), used for next.config.ts/typren.config.json,
 *  which can never live under src/. */
export declare function buildTemplates(contentDirLiteral: string): Record<string, string>;

// ---- dist/types.d.ts ----
import type { ComponentType } from "react";
import type { AuthAdapter } from "./auth-adapter.js";
import type { GitRepo } from "./git.js";
import type { I18nConfig } from "./i18n.js";
import type { Section } from "./sections.js";
import type { SettingsAdapter } from "./settings.js";
/** A single content block. `slice` is the registry key; the rest are its props. */
export type Slice = {
    slice: string;
} & Record<string, unknown>;
/** A page's editable content: frontmatter (minus the slice list), the slices,
 *  and any markdown body after the frontmatter (preserved on round-trip). */
export type PageContent = {
    meta: Record<string, unknown>;
    slices: Slice[];
    body: string;
};
/** A page read for a specific locale, with fallback provenance for the editor.
 *  `isFallback` is true when the requested locale had no file and the default
 *  locale's content is being served instead. */
export type LocalizedPage = PageContent & {
    locale: string;
    isFallback: boolean;
};
/** Summary row for the page picker. `locales` is which locales this page exists
 *  in (translation status); `hasDraft` is for the currently-listed locale.
 *  `nav`/`navOrder`/`system`/`noindex` mirror the page's front matter and are
 *  present only when set there with the right type; the editor groups pages
 *  by them. Without front matter, `nav`/`navOrder` come from the site doc's
 *  header navigation (`site.md`'s `nav` and `cta` links), in its order. `published` is false for a page that exists only as a draft (never
 *  published); absent means published. */
export type PageInfo = {
    slug: string;
    title: string;
    hasDraft: boolean;
    locales: string[];
    nav?: boolean;
    navOrder?: number;
    system?: boolean;
    noindex?: boolean;
    published?: boolean;
};
/** One row of a collection's list view. A record IS a `PageContent` with
 *  `slices: []` (see collection.ts). `meta` is the schema-shaped prop bag,
 *  `hasDraft`/`locale` mirror `PageInfo`'s draft/translation status but are
 *  kept as a local type (not `PageInfo`) since a collection record's display
 *  value comes from an arbitrary schema key, not a fixed `title` field. */
export type CollectionRecordInfo = {
    slug: string;
    meta: Record<string, unknown>;
    /** The record's markdown body. Required, not optional: an optional field
     *  would let a host omit it, and a UI round-tripping this through a save
     *  (see `TyprenCollection._save`) would then silently blank the file's
     *  body: the exact bug this field exists to prevent. */
    body: string;
    hasDraft: boolean;
    /** v1 gap: collections aren't locale-switcher aware; this is an
     *  opportunistic display-only badge when a host happens to set it. */
    locale?: string;
};
/** Editor hint for a single prop. Without one, the control is auto-detected
 *  from the value (string→input, number→number, boolean→checkbox, object→YAML).
 *  With one, `type` (and `options` for "select") pick the control explicitly.
 *  This is how enum props become dropdowns. "image"/"media" render the media
 *  picker (see FieldForm) for a bare string or a `{src, alt}` object prop.
 *  Additive: every existing value keeps working byte-identical; the new ones
 *  below only ever activate when a schema explicitly asks for them. */
export type FieldDef = {
    type?: "text" | "textarea" | "number" | "boolean" | "select" | "yaml" | "image" | "media" | "richtext" | "icon" | "color" | "link" | "slot";
    options?: string[];
    label?: string;
    /** "slot" only: field schema for ONE item in the list (not the list itself).
     *  Recursion is expected: an item's own fields can include another "slot". */
    of?: SliceSchema;
    /** "slot" only: which item field's value to show as a row's heading in the
     *  editor (e.g. "title"). Falls back to "Item N" when absent, not a string,
     *  or empty. */
    itemLabel?: string;
};
/** Field hints for one slice, keyed by prop name. */
export type SliceSchema = Record<string, FieldDef>;
/** Metadata for one stored media asset. width/height are optional. The fs
 *  adapter always populates them for freshly uploaded files (sharp probes
 *  them during processUpload), but can't retroactively know them for files
 *  that were already sitting in the media dir before this feature existed. */
export type MediaAsset = {
    id: string;
    url: string;
    name: string;
    size: number;
    width?: number;
    height?: number;
    mime: string;
    createdAt: string;
    /** Folder the asset sits in, "/"-joined ("events/2025"); "" or absent at
     *  the root. Only adapters with folder support set it. */
    folder?: string;
};
/** One asset's public URL before and after a move or rename. */
export type MediaMove = {
    from: string;
    to: string;
};
/** Where one asset URL is referenced: a page (or "settings") in a locale,
 *  and how many times. */
export type MediaUse = {
    slug: string;
    locale: string;
    count: number;
};
/** A file that has already passed validation + web-optimization (see
 *  media.ts's processUpload) and is ready to persist. Adapters never see
 *  raw client uploads, only this. */
export type PreparedFile = {
    name: string;
    mime: string;
    buffer: Buffer;
    width?: number;
    height?: number;
};
/**
 * The ONLY thing that knows where/how media files are stored. Phase 1 ships
 * a filesystem adapter over `public/img`; an S3/Vercel Blob adapter drops in
 * behind the same interface later without touching processUpload, FieldForm,
 * or the media library UI, same seam as ContentAdapter (see above).
 */
export interface MediaAdapter {
    list(): Promise<MediaAsset[]>;
    /** `file` is already validated + converted (see media.ts). Adapters own
     *  collision-free key assignment (the fs adapter appends a random suffix
     *  unconditionally rather than check-then-write). */
    /** `folder` (see `MediaAsset.folder`) is only passed to adapters with
     *  folder support; others ignore it. */
    upload(file: PreparedFile, folder?: string): Promise<MediaAsset>;
    delete(id: string): Promise<void>;
    /** Optional folder support: implement all five or none. Folder paths are
     *  "/"-joined and validated by the adapter, like ids. */
    listFolders?(): Promise<string[]>;
    createFolder?(folder: string): Promise<void>;
    /** Refuses a folder that still holds assets, so nothing referenced goes
     *  missing as a side effect. */
    deleteFolder?(folder: string): Promise<void>;
    /** Moves an asset into `folder` ("" for the root), renaming it to `name`
     *  when given (the extension is kept). `from` is its old public URL, so
     *  callers can rewrite references to it. */
    move?(id: string, folder: string, name?: string): Promise<{
        from: string;
        to: MediaAsset;
    }>;
    /** Renames or moves a whole folder to the path `to`; returns the old and new
     *  public URL of every asset it carried. */
    renameFolder?(folder: string, to: string): Promise<MediaMove[]>;
}
/**
 * The ONLY thing that knows where/how content is stored and serialized.
 * Phase 1 ships a filesystem+markdown adapter; a KV/GitHub adapter drops in
 * behind the same interface later without touching the store or the UI.
 */
export interface ContentAdapter {
    /** Locale allowlist and default. The adapter is the storage authority, so the
     *  allowlist (the traversal guard for the locale path segment) lives here; the
     *  store/actions read these instead of duplicating the config. */
    readonly locales: string[];
    readonly defaultLocale: string;
    /** Slugs of every editable (sliced) page in a locale (defaults to default). */
    listSlugs(locale?: string): Promise<string[]>;
    /** Locales in which `slug` has a published file (switcher / translation status). */
    listLocales(slug: string): Promise<string[]>;
    exists(slug: string, locale?: string): Promise<boolean>;
    /** Raw published source (rejects if absent; callers gate with `exists`). */
    readRaw(slug: string, locale?: string): Promise<string>;
    /** `opts.expectedVersion`, when given, asks the adapter to compare-and-swap:
     *  the write only lands if the path's CURRENT version (see version.ts's
     *  `versionOf`) still equals it, else reject with `ConflictError`, closing
     *  the TOCTOU window a caller-side read-then-write check can't (see
     *  store.ts's `saveDraft`). An adapter with no atomic primitive to hang
     *  this on (markdown/Notion) may ignore `opts` and keep its existing
     *  unconditional-overwrite behavior. */
    writeRaw(slug: string, raw: string, locale?: string, opts?: {
        expectedVersion?: string;
    }): Promise<void>;
    /** Delete the published source (and let the store also drop any draft). */
    deletePublished(slug: string, locale?: string): Promise<void>;
    /** Raw draft source, or null when no draft is checked out. */
    readDraftRaw(slug: string, locale?: string): Promise<string | null>;
    writeDraftRaw(slug: string, raw: string, locale?: string, opts?: {
        expectedVersion?: string;
    }): Promise<void>;
    deleteDraft(slug: string, locale?: string): Promise<void>;
    hasDraft(slug: string, locale?: string): Promise<boolean>;
    /** Slugs with a draft in a locale, published or not. Optional: without it,
     *  a page that exists only as a draft is left out of `listPages`. */
    listDraftSlugs?(locale?: string): Promise<string[]>;
    /** Page folders kept on their own, with no page inside required: paths
     *  like `event` or `docs/guides`. Folders that hold pages are implied by
     *  their slugs and need not be listed. The three folder methods are
     *  optional together; the folder path is validated like a slug. */
    listFolders?(locale?: string): Promise<string[]>;
    createFolder?(folder: string, locale?: string): Promise<void>;
    /** Refuses (rejects) unless the folder holds nothing but its own marker. */
    deleteFolder?(folder: string, locale?: string): Promise<void>;
    /** True when `writeDraftRaw` writes the live content (no separate draft
     *  storage, e.g. Notion). `makeActions` then gates draft writes as
     *  "publish", since a draft save publishes. */
    readonly draftsWriteThrough?: boolean;
    /** Parse raw source into structured content, and back. Locale-agnostic: the
     *  locale is a path segment, never inside the file. Pure/sync: no I/O. */
    parse(raw: string): PageContent;
    serialize(page: PageContent): string;
}
/**
 * One object wires the CMS into a project. Everything project-specific lives
 * here; the package core reads only this.
 */
export interface CmsConfig {
    /** Slice name -> component. The editor uses only the keys (for the add menu);
     *  the host renders the components in its own preview route. */
    registry: Record<string, ComponentType<unknown>>;
    /** Starter props inserted when a slice is added, keyed by slice name. */
    defaults: Record<string, Record<string, unknown>>;
    /** Optional per-slice field hints (dropdowns for enum props, etc.). Fields
     *  without an entry auto-detect their control. Keyed by slice name. */
    fieldSchema?: Record<string, SliceSchema>;
    adapter: ContentAdapter;
    /** Route the editor iframes for live preview, e.g. "/editor/preview". */
    previewPath: string;
    /** Slug of the page the site serves at "/". It keeps its slug: a rename
     *  refuses it. Default "home". */
    homeSlug?: string;
    /** Pluggable auth (preferred over `authorize`). Resolved via `resolveAuth`,
     *  which both the action guard and the layout gate share. */
    auth?: AuthAdapter;
    /** @deprecated Use `auth`. Legacy zero-arg gate; wrapped via `legacyAuthAdapter`.
     *  Kept optional for back-compat: a config must set either `auth` or this. */
    authorize?(): boolean | Promise<boolean>;
    /** Locale set, default locale, URL routing preset, and editor-UI message
     *  overrides. Omit for a single implicit locale (byte-identical behavior).
     *  The host passes `locales`/`defaultLocale` on to the adapter + store. */
    i18n?: I18nConfig;
    /** Optional publish side-effect (Phase 2: revalidatePath + GitHub commit).
     *  Gains `locale` so a revalidate can target the right localized path. */
    onPublish?(slug: string, locale: string): void | Promise<void>;
    /** Optional save-draft side-effect: mirrors onPublish but for the draft
     *  write. Fired synchronously right after the draft file is written, before
     *  the HTTP response is sent. Keep it fast (a marker-file write, not a
     *  network call). store.saveDraft is synchronous and does not await this. */
    onSaveDraft?(slug: string, locale: string, version: string): void;
    /** Optional rename side-effect, awaited after `renamePage` moved the page's
     *  files in every locale (the local studio commits the move here). With
     *  `git` set, a rename on a detached HEAD is refused before anything moves,
     *  and a throw moves the page back before it propagates. */
    onRename?(slug: string, newSlug: string): void | Promise<void>;
    /** The local git checkout the content lives in (the local studio). The
     *  HTTP API then serves `GET /git` (commits a push would send) and
     *  `POST /git/push`. Committing stays the host's call, from `onPublish`. */
    git?: GitRepo;
    /** Wraps a page or media write that lands as one change (a page delete,
     *  duplicate or published create; a media upload, delete or move), with a
     *  one-line description of it. The local site commits every file the
     *  write touched here (see `createLocalSiteConfig`); without it the write
     *  just runs. */
    withCommit?<T>(message: string, write: () => Promise<T>): Promise<T>;
    /** Optional media library. Omit to disable media management. Image-typed
     *  fields (see FieldDef) still render, just as a plain text input with no
     *  "Browse library" button. */
    mediaAdapter?: MediaAdapter;
    /** Called after a media move, once references in content are rewritten,
     *  for references the content adapter can't see (a site's source code).
     *  The local studio rewrites the site's files here. */
    onMediaMove?(moves: MediaMove[]): void | Promise<void>;
    /** Accept SVG uploads (sanitized). Off by default: an SVG is a document, so
     *  serve media from a separate origin or with `Content-Security-Policy:
     *  sandbox` before turning this on. See docs/site/media-storage.md. */
    allowSvg?: boolean;
    /** Left-nav section registry. Omit → resolveSections() returns the default
     *  trio (pages, media, settings); existing hosts get byte-identical
     *  behavior, mirroring resolveI18n's omitted-block collapse. */
    sections?: Section[];
    /** Where SiteSettings persists. Omit → derived from `adapter`'s root: runtime
     *  tier in a private sibling dir, bootstrap tier in a root JSON file. No new
     *  adapter required to get Settings/onboarding working. */
    settingsAdapter?: SettingsAdapter;
    /** Where the SiteSettings *content* doc itself is stored (distinct from
     *  `settingsAdapter`'s bootstrap JSON above). Required when `adapter` has no
     *  filesystem root to site a sibling `.typren/` dir next to (a GitHub or
     *  Notion Pages adapter); omit for a markdown adapter, which keeps today's
     *  derived location unchanged. */
    settingsContentAdapter?: ContentAdapter;
    /** `false` disables first-run onboarding (embeds, tests, hosts that seed
     *  settings out-of-band). Omit = auto-detect via bootstrap `onboarded` flag. */
    onboarding?: false;
    /** Hosted-platform tenant scope for this config instance. Threaded into
     *  every `AuthContext` the package builds (actions.ts, settings.ts,
     *  media.ts, api/routes.ts) so a hosted `authorize()` can enforce isolation
     *  structurally. Resolve server-side per request (see `createTyprenApi`'s
     *  config-factory form), never take these from the client. Omit for a
     *  single-site config; behavior is byte-identical. */
    siteId?: string;
    accountId?: string;
}
export type { I18nConfig, Messages, RoutingMode } from "./i18n.js";

// ---- dist/ui/canvas-react.d.ts ----
import { type ComponentType } from "react";
import type { RendererAdapter } from "./canvas.js";
type Props = Record<string, unknown>;
/**
 * The page canvas's React renderer. It creates no root per section, which
 * would cut sections off from the root layout's providers: each `mount`
 * adds a slot that the canvas's own React tree (its `Outlet`) fills with a
 * portal, so context reaches every section. A slot keeps its portal while
 * the canvas moves its element, so a reorder keeps the mounted instance.
 *
 * Changes made while handling one studio message commit together, in one
 * synchronous render a microtask later, so the canvas's `rendered` timing
 * sees them painted on the next frame.
 */
export declare function createReactRenderer(): RendererAdapter<ComponentType<Props>>;
export {};

// ---- dist/ui/canvas.d.ts ----
import { type ComponentType } from "react";
/** The canvas protocol this core speaks (see docs/canvas-renderer.md). */
export declare const CANVAS_PROTOCOL = 1;
/** One section a renderer has mounted. */
export interface MountedSection {
    update(props: Record<string, unknown>): void;
    unmount(): void;
}
/** Mounts one framework component into one element of the page canvas. A
 *  section that throws should dispatch a bubbling `typren:error` event from
 *  its element, which the canvas reports to the studio. */
export interface RendererAdapter<C = unknown> {
    readonly name: string;
    mount(el: HTMLElement, component: C, props: Record<string, unknown>): MountedSection;
    /** Rendered once inside the canvas's own React tree, for a renderer whose
     *  sections live there (the React renderer's portals). */
    readonly Outlet?: ComponentType;
}
/** A `patch` operation, by the studio's per-session slice key. */
export type CanvasOp = {
    op: "set";
    key: string;
    slice: unknown;
} | {
    op: "insert";
    at: number;
    key: string;
    slice: unknown;
} | {
    op: "remove";
    key: string;
} | {
    op: "move";
    key: string;
    to: number;
};
type Post = (message: Record<string, unknown>) => void;
/**
 * The page canvas's state machine, framework-free: it keeps one element per
 * slice under `root`, in document order, each wrapped as the preview bridge
 * expects (`data-typren-index`, plus `data-typren-key`), and has `renderer`
 * mount, update or unmount the registry's component in it. A reorder moves
 * the element, so the mounted section survives it.
 *
 * `receive` takes the studio's messages, already checked for origin and
 * nonce: `document` replaces the page, `patch` applies to the current `rev`
 * only and otherwise asks for a `resync`. Each answer goes through `post`:
 * `rendered { rev, ms }` on the next animation frame, `missing { keys }` for
 * slices this site cannot render, `error { key }` for a section that threw.
 */
export declare function createCanvasSession<C>({ renderer, registry, root, post, }: Readonly<{
    renderer: RendererAdapter<C>;
    registry: Record<string, C>;
    root: HTMLElement;
    post: Post;
}>): {
    /** Ready: tells the studio this canvas's protocol and renderer. */
    hello: () => void;
    receive(d: Record<string, unknown>): void;
    destroy(): void;
};
/** The studio's session nonce from the frame URL's fragment
 *  (`#typren=<nonce>`), or null. */
export declare function readNonce(hash: string): string | null;
/** Page mode on a canvas with no client renderer (the server form of
 *  `createSectionCanvas`): says so at once, so the studio falls back to the
 *  real route without waiting out its timer. */
export declare function CanvasUnavailable({ origin }: Readonly<{
    origin?: string;
}>): null;
/**
 * The section canvas in the browser, with a renderer for page mode. Mount
 * the result where the site mounts its section canvas today, passed to
 * `createSectionCanvas`, which keeps the server-side gate:
 *
 * - `?page` (with the studio's nonce in the fragment): the persistent page
 *   canvas. The studio posts the page as a `document` and its edits as
 *   `patch`es; every slice renders here, in order, under the root layout.
 * - `?slices=`: the Templates grid (see `MultiSectionCanvas`).
 * - `?slice=`: one slice, as `createClientSectionCanvas` always did.
 *
 * ponytail: the one and many modes render registry entries as React
 * components whatever the renderer; non-React renderers (phase 4) take
 * them over when they land.
 *
 * Inert outside the studio: it reads its URL only outside a production
 * build and with a valid studio `origin`, which the server wrapper passes
 * only while `typren studio` previews.
 */
export declare function createCanvas<C>({ renderer, registry }: Readonly<{
    renderer: RendererAdapter<C>;
    registry: Record<string, C>;
}>): ({ origin }: Readonly<{
    origin?: string;
}>) => import("react").JSX.Element | null;
export {};

// ---- dist/ui/i18n-strings.d.ts ----
import type { Messages } from "../i18n.js";
/**
 * Vanilla (non-React) counterpart to @typren/studio's `useT`: same
 * key→host-override→English-default→literal-key fallback + `{var}`
 * interpolation, without a context provider. A non-React consumer calls
 * `createT(messages)` itself; `messages` is passed as a plain value, no
 * shared provider involved.
 */
export declare function createT(messages?: Partial<Messages>): (key: string, vars?: Record<string, string | number>) => string;

// ---- dist/ui/messages.d.ts ----
import type { Messages } from "../i18n.js";
/** English editor-UI strings shipped by the package. Flat, dot-namespaced keys.
 *  `{var}` placeholders are filled by `useT(key, vars)`. A host overrides any
 *  subset via `CmsConfig.i18n.messages[uiLocale]`. */
export declare const defaultMessages: Messages;

// ---- dist/ui/preview-bridge.vanilla.d.ts ----
/**
 * Rendered inside the preview route (vanilla, runs in the iframe's own
 * document, never in the editor's shadow tree; spec fact #4). Bridges the
 * preview iframe and the editor:
 *  - click a block (an element wrapped with `data-typren-index`) to select it
 *  - double-click a text element to edit it inline; on blur the new text is
 *    posted back to the editor, which maps it to the matching slice field
 *  - applies an independent light/dark theme + scroll-to on request
 *  - draws the editor's hover and selection outlines in this document, in a
 *    shadow root laid over the page, so they scroll with it natively; the
 *    editor says which blocks (`outline`), in its own colour
 *  - posts every block's rect on a layout change, the document's scroll on
 *    each frame it scrolls, and the hovered block, so the editor can place
 *    its interactive controls over this frame
 *  - posts its path on load and on every navigation, so a browsing editor
 *    can follow it; once the editor answers `browse`, clicks and
 *    double-clicks are left to the site, so its links work, until `edit`
 *    makes the page an edit canvas again
 *  - answers `computedStyle` with the site's effective values for the Style
 *    screen's tokens
 */
/** True for a serialized http(s) origin such as "http://127.0.0.1:4400". */
export declare function isOrigin(value: string): boolean;
/**
 * Attach the preview bridge listeners + inject its stylesheet into
 * `document.head` (once). Returns a cleanup function that removes the
 * listeners (the base `<style>` is left in place: idempotent, harmless; the scrollbar one is removed).
 *
 * `allowedOrigin` is the one origin this frame will post to and accept
 * messages from. Omit it and the bridge defaults to `window.location.origin`
 * (byte-identical to the old same-origin-only behavior, for local/self-host
 * setups embedding their own dashboard). A hosted dashboard framing a
 * customer's site is cross-origin by definition, so it must pass its own
 * origin explicitly here (learned from the site record), this is never
 * `"*"`; the channel always compares against one explicit value.
 *
 * Fails closed: an `allowedOrigin` that is not a bare http(s) origin (`"*"`,
 * `"null"`, an empty env var, a URL with a path) leaves the bridge inert,
 * with no listeners attached, rather than guessing what was meant.
 *
 * `nonce` is the studio's session nonce (the page canvas reads it from its
 * URL fragment): with one, every post carries it and a message without it
 * is ignored, so a page the frame navigates to cannot speak for it.
 */
export declare function initPreviewBridge(allowedOrigin?: string, nonce?: string): () => void;

// ---- dist/ui/section-canvas-client.d.ts ----
import type { CmsConfig } from "../types.js";
/** The section canvas for a static-export site: renders the slice in the
 *  browser from `window.location.search`, since `output: "export"` refuses
 *  `searchParams` even under `next dev`. Call it in a `"use client"` file and
 *  hand the result to `createSectionCanvas`, which keeps the gate on the
 *  server. ponytail: every registry component must render on the client, so
 *  an async server component or one importing server-only code cannot sit in
 *  this registry; such a site keeps `createSectionCanvas(registry)` and turns
 *  export off for the preview.
 *
 *  It holds its own gate too, for a site that mounts it without the server
 *  wrapper: it reads the query only outside a production build and only with
 *  an `origin`, which the wrapper passes just while the studio previews
 *  (`TYPREN_PREVIEW` never reaches the browser). Without one the bridge is
 *  inert anyway, so the studio could not use the canvas.
 *
 *  It is `createCanvas` with the React renderer, so it also serves the
 *  studio's page canvas (`?page`) and its Templates grid (`?slices=`). */
export declare function createClientSectionCanvas(registry: CmsConfig["registry"]): ({ origin }: Readonly<{
    origin?: string;
}>) => import("react").JSX.Element;

// ---- dist/ui/section-canvas-multi.d.ts ----
import { type ReactNode } from "react";
import type { CmsConfig } from "../types.js";
/** One tile as the studio posts it: where to draw, in this frame's pixels. */
export type SectionPlace = {
    key: string;
    left: number;
    top: number;
    width: number;
    height: number;
    radius: number;
    slice?: unknown;
};
/** The studio's posted layout, validated. Malformed entries are dropped; a
 *  slice rides along untouched, for the caller to check. */
export declare function toPlaces(raw: unknown): SectionPlace[];
/**
 * The section canvas's many-section mode (`?slices=`): one page draws every
 * tile of the studio's Templates grid, so the grid costs one page load
 * instead of one per tile. The studio lays this frame over its grid and
 * posts `{type:"sections", items}`, each item a tile's key, rect and slice;
 * every section renders 1280px wide, scaled into its rect and clipped to its
 * radius. It answers with the keys it has drawn (`ready`), the ones it
 * cannot (`missing`) and its root's `colorScheme`, which the studio copies
 * onto the frame so the browser keeps the frame transparent.
 *
 * `rendered` is the server form: sections rendered on the server from the
 * page's `?slices=` query, by key, so a posted slice is ignored and a key
 * that is not there is missing (the studio then reloads with it). `registry`
 * is the client form: it renders the posted slices themselves, checked like
 * the query (see `parseSectionQuery`), so it never needs a reload.
 *
 * Messages count only from the parent window at `origin`, and posts go only
 * there; without a valid origin, or in a production build, it is inert.
 */
export declare function MultiSectionCanvas({ origin, rendered, registry, }: Readonly<{
    origin?: string;
    rendered?: Record<string, ReactNode>;
    registry?: CmsConfig["registry"];
}>): import("react").JSX.Element | null;

// ---- dist/ui/section-canvas.d.ts ----
import type { ComponentType } from "react";
import type { CmsConfig } from "../types.js";
type Query = {
    slice?: string | string[];
    slices?: string | string[];
    page?: string | string[];
};
/** The page behind `<site>/typren/section?slice=<json>`: renders one slice
 *  alone so the studio can show it as a real thumbnail. Mount it as a site's
 *  `app/typren/section/page.tsx` default export.
 *
 *  Pass the registry to render the slice on the server from `searchParams`;
 *  any component works, but a static export (`output: "export"`) refuses the
 *  query even under `next dev`. Pass a client canvas instead (see
 *  `createClientSectionCanvas`) and the slice renders in the browser, so the
 *  page never reads `searchParams` and exports as static.
 *
 *  Closed unless `typren studio` is previewing (same rule as the scaffold's
 *  `studioPreview`), and then it never reads `searchParams` either.
 *  ponytail: closed means an empty 200, not a 404 (`notFound()` would break
 *  `output: "export"`); the route exists in production but renders nothing.
 *  The bridge mounts even for an empty or unknown slice: the studio's probe
 *  sends `{slice:""}` and waits for the bridge's `rects` post.
 *
 *  With `?slices=` instead, the page is the studio's whole Templates grid
 *  (see `MultiSectionCanvas`): the server form renders every slice in that
 *  query, by key; the client form renders what the studio posts.
 *
 *  With `?page`, the client form is the studio's persistent page canvas
 *  (see `createCanvas`). The server form has no client renderer, so it
 *  answers that it cannot, and the studio frames the real route instead. */
export declare function createSectionCanvas(source: CmsConfig["registry"] | ComponentType<{
    origin?: string;
}>): ({ searchParams }: Readonly<{
    searchParams: Promise<Query>;
}>) => Promise<import("react").JSX.Element | null>;
export {};

// ---- dist/ui/studio-bridge.d.ts ----
/** Talks to the `typren studio` editor framing this page. `origin` is the
 *  studio's own origin (`TYPREN_STUDIO_ORIGIN`, which `typren studio` sets):
 *  the only one the bridge posts to or accepts. Without it the bridge stays
 *  off rather than guess. `nonce` is the page canvas's session nonce (see
 *  `initPreviewBridge`). */
export declare function StudioBridge({ origin, nonce }: Readonly<{
    origin?: string;
    nonce?: string;
}>): null;

// ---- dist/ui/typren-style.d.ts ----
import type { SettingsStore } from "../settings.js";
import { type StyleMap } from "../style.js";
/** The saved Style tokens as the site's stylesheet rule (see `styleCss`):
 *  sanitised, unlayered, `:root:root`. Empty when nothing is saved. `map` is
 *  the site's `studio.style` from `typren.config.json`; without one, the stock
 *  shadcn names. Reads the published settings on every call, like
 *  `resolveSeoConfig`. */
export declare function resolveStyleCss(settings: Pick<SettingsStore, "get">, map?: StyleMap, locale?: string): Promise<string>;
/** A server component that renders `resolveStyleCss` as a `<style>`, which
 *  React hoists into `<head>` once however many times it renders. Nothing
 *  when no token is saved. */
export declare function TyprenStyle({ store, map, locale }: Readonly<{
    store: Pick<SettingsStore, "get">;
    map?: StyleMap;
    locale?: string;
}>): Promise<import("react").JSX.Element | null>;

// ---- dist/version.d.ts ----
/** Content version = SHA-256 of the raw file text, truncated. Deterministic and
 *  adapter-agnostic (survives fs → KV → git), no mtime flakiness. */
export declare const versionOf: (raw: string) => string;
/** Thrown by the store when a version-checked write loses a race. The action
 *  layer converts this to returned data (Next redacts thrown messages in prod),
 *  so callers detect conflicts via the returned union, not `e.message`. */
export declare class ConflictError extends Error {
    readonly slug: string;
    readonly currentVersion: string | null;
    readonly baseVersion: string;
    readonly code: "conflict";
    constructor(slug: string, currentVersion: string | null, baseVersion: string);
}
/** Thrown by the store when a rename/duplicate would land on a slug that
 *  already has content (published or draft) in some locale. Distinct from
 *  `ConflictError`: that's an optimistic-lock version race on ONE resource;
 *  this is two resources colliding, so there's no `currentVersion`/`baseVersion`
 *  to report. Carries the same `code: "conflict"` discriminant so the action
 *  layer's result union and the 409 mapping in `api/routes.ts`'s `saveResult()`
 *  don't need a second code path. */
export declare class SlugExistsError extends Error {
    readonly slug: string;
    readonly code: "conflict";
    constructor(slug: string);
}
