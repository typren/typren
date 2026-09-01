// ---- dist/actions.d.ts ----
import type { CmsConfig, PageContent } from "./types.js";
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
export declare function makeActions(config: CmsConfig): {
    saveDraft(slug: string, page: PageContent, baseVersion?: string, locale?: string): Promise<SaveResult>;
    discardDraft(slug: string, locale?: string): Promise<void>;
    publish(slug: string, baseVersion?: string, locale?: string): Promise<SaveResult>;
    /** Create an empty page (in `locale`, default when omitted); returns the
     *  normalized slug for navigation. */
    createPage(title: string, locale?: string): Promise<string>;
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
    renamePage(slug: string, newSlug: string): Promise<RenameResult>;
    /** Duplicate a page under a new, auto-derived slug (`slugify`-based
     *  "-copy"/"-copy-2"/... suffix, same helper `createPage` uses, so
     *  derivation can't drift between the two). Copies BOTH the published
     *  content and any draft that exist on the source (see
     *  `ContentStore.duplicatePage` for the justification). Gated as a
     *  "createPage" action: a duplicate IS creating a new page, just seeded
     *  from an existing one, so it shares that permission rather than adding
     *  a distinct one. */
    duplicatePage(slug: string, locale?: string): Promise<string>;
    /** Seed a draft translation of `slug` into `toLocale` from the default
     *  locale's published content. Gated as a draft write. */
    createTranslation(slug: string, toLocale: string): Promise<void>;
    deletePage(slug: string): Promise<void>;
    /** Delete a single translation (one locale) + its draft. */
    deleteTranslation(slug: string, locale: string): Promise<void>;
    listMedia(): Promise<import("./types.js").MediaAsset[]>;
    deleteMedia(id: string): Promise<void>;
};
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

// ---- dist/api/client.d.ts ----
import type { PageActions, RenameResult, SaveResult } from "../actions.js";
import type { CollectionRecordInfo, MediaAsset, PageContent, PageInfo } from "../types.js";
import type { SiteSettings, SiteSettingsBootstrap, SiteSettingsRuntime } from "../settings.js";
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
export interface TyprenClient extends PageActions {
    listPages(locale?: string): Promise<PageInfo[]>;
    getPage(slug: string, locale?: string): Promise<{
        page: PageContent;
        version: string | null;
        hasDraft: boolean;
    }>;
    renamePage(slug: string, newSlug: string): Promise<RenameResult>;
    duplicatePage(slug: string, locale?: string): Promise<string>;
    listMedia(): Promise<MediaAsset[]>;
    deleteMedia(id: string): Promise<void>;
    uploadMedia(file: File): Promise<MediaAsset>;
    getSettings(locale?: string): Promise<SiteSettings>;
    saveSettingsDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
    publishSettings(baseVersion?: string, locale?: string): Promise<SaveResult>;
    writeBootstrap(patch: Partial<SiteSettingsBootstrap>): Promise<void>;
    listCollectionRecords(sectionId: string, locale?: string): Promise<CollectionRecordInfo[]>;
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
 * POST   /pages                              create           { title, locale? } -> { slug }
 * GET    /pages/:slug                        draft ?? published (?locale=)
 * PUT    /pages/:slug/draft                  save draft       { page, baseVersion?, locale? }
 * DELETE /pages/:slug/draft                  discard draft
 * POST   /pages/:slug/publish                publish          { baseVersion?, locale? }
 * POST   /pages/:slug/rename                 rename slug      { newSlug } -> SaveResult-shaped (409 on collision)
 * POST   /pages/:slug/duplicate              duplicate        (?locale=) -> { slug }
 * DELETE /pages/:slug                        delete page
 * POST   /pages/:slug/translations           create           { toLocale }
 * DELETE /pages/:slug/translations/:locale   delete translation
 * GET    /collections/:id                    list records     (?locale=) -> { records: CollectionRecordInfo[] }
 * GET    /collections/:id/:slug              draft ?? published (?locale=)
 * POST   /collections/:id                    create           { title, locale? } -> { slug }
 * PUT    /collections/:id/:slug/draft        save draft       { page, baseVersion?, locale? }
 * DELETE /collections/:id/:slug/draft        discard draft
 * POST   /collections/:id/:slug/publish      publish          { baseVersion?, locale? }
 * DELETE /collections/:id/:slug              delete record
 * GET    /media                              list
 * POST   /media                              upload (multipart/form-data, field "file")
 * DELETE /media/:id                          delete
 * GET    /settings                           runtime + bootstrap snapshot + version
 * PUT    /settings/draft                     save draft       { settings, baseVersion?, locale? }
 * POST   /settings/publish                   publish          { baseVersion?, locale? }
 * PUT    /settings/bootstrap                 write bootstrap  (admin)   { patch }
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
 *  - **Read gating**, since a bare GET never reaches an action guard.
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
 *  resolution of its own — `filePolicy` (file-policy.ts) is the first
 *  implementation. */
export interface Policy {
    authorize(user: AuthUser | null, ctx: AuthContext): boolean | Promise<boolean>;
}
/**
 * Compose an identity adapter ("who is this?") with a `Policy` ("what may
 * they do?") into one `AuthAdapter`. `identity.getUser()` resolves the user;
 * `policy.authorize()` decides. The identity adapter's OWN `authorize()` (if
 * any) is never called — the policy is authoritative, so adding a group
 * policy can't silently be opted out of by picking a different identity
 * adapter. Fails closed: no `getUser`, no user, or any error resolving
 * either side denies. See docs/hosted-platform.md, "Compose identity and
 * policy — do not fuse them".
 */
export declare function withPolicy(identity: AuthAdapter, policy: Policy): AuthAdapter;
/** Single resolution point used by BOTH the action guard and the layout gate,
 *  so they can never diverge. Throws at construction if a config has neither. */
export declare function resolveAuth(config: {
    auth?: AuthAdapter;
    authorize?: () => boolean | Promise<boolean>;
}): AuthAdapter;

// ---- dist/auth/clerk.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/**
 * Clerk gate (entry `@typren/core/auth/clerk`, optional peer `@clerk/nextjs`).
 * Unlike next-auth's injected `auth()`, Clerk's `auth()`/`currentUser()` are
 * global request-scoped helpers, so they're imported directly.
 *
 * "admin" (settings/onboarding/bootstrap writes) is gated separately from
 * ordinary content writes: it needs `adminRoles` set and a matching org role
 * claim, full stop. Unmapped (no `adminRoles` configured) denies rather than
 * falling back to `allowedRoles`/`allowedUserIds`. A host must opt in to who
 * gets to reconfigure the site.
 */
export declare function clerkAuthAdapter(opts?: {
    /** Org role claim, e.g. "org:admin". */
    allowedRoles?: string[];
    allowedUserIds?: string[];
    /** Org role claim required for the "admin" action, e.g. "org:admin". */
    adminRoles?: string[];
}): AuthAdapter;

// ---- dist/auth/local.d.ts ----
import type { AuthAdapter } from "../auth-adapter.js";
/**
 * Dev-only gate (entry `@typren/core/auth/local`, no peer deps). Refuses in
 * production unless `allowInProduction` is explicitly set. The editor writes
 * files, so never ship it open by omission. Doesn't branch on `ctx.action`, so
 * "admin" (settings/onboarding/bootstrap writes) gets the exact same local-only
 * gate as every other write. There's only one tier in local dev.
 */
export declare function localAuth(opts?: {
    /** default: NODE_ENV === "development" */
    predicate?: () => boolean;
    /** default: false */
    allowInProduction?: boolean;
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
 * DEFAULT-OPEN CAVEAT: with neither `allowedEmails` nor `allowedRoles` set,
 * ANY signed-in user is authorized. For a public editor that is almost never
 * what you want. Require at least one allowlist in production.
 *
 * "admin" (settings/onboarding/bootstrap writes; they reparameterize what the
 * next boot trusts) is gated separately from ordinary content writes: it needs
 * `adminRoles` set and an intersecting role, full stop. Unmapped (no
 * `adminRoles` configured) denies rather than falling back to `allowedRoles`.
 * A host must opt in to who gets to reconfigure the site.
 */
export declare function nextAuthAdapter(opts: {
    /** The host's `auth` from `NextAuth(config)` (reads the session cookie). */
    auth: () => Promise<Session>;
    /** Case-insensitive match on session.user.email. */
    allowedEmails?: string[];
    /** Any-intersection with session.user.roles. */
    allowedRoles?: string[];
    /** Any-intersection with session.user.roles, required for the "admin" action. */
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
export declare function makeCollectionActions(config: CmsConfig, section: CollectionSection): PageActions;
export declare function buildCollectionActions(config: CmsConfig): Record<string, PageActions>;
/** List every record in a collection section as `CollectionRecordInfo` rows:
 *  the list view's data source (spec: collections have no client "read"
 *  action, so this is what a host's server-fetch calls into). Reuses the same
 *  adapter construction as makeCollectionActions so the overlap guard and
 *  contentDir resolution can't drift between the read and write paths. */
export declare function listCollectionRecords(config: CmsConfig, section: CollectionSection, locale?: string): CollectionRecordInfo[];

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
 * resolved user's group against the requested action. DEFAULT CLOSED — no
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
 * — that's what closes the escalation trap (an editor promoting themselves
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
 * Filesystem media adapter over a flat directory (mirrors `markdown-adapter.ts`'s
 * conventions: a `create*Adapter(opts)` factory, a `SAFE_*` traversal guard,
 * idempotent delete). Async throughout (unlike `ContentAdapter`) because
 * `list()` probes image dimensions via sharp. See `types.ts`'s `MediaAdapter`.
 */
export declare function createFsMediaAdapter({ dir, publicPath }: FsMediaAdapterOptions): MediaAdapter;

// ---- dist/github-adapter.d.ts ----
import type { PageContent } from "./types.js";
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
     *  fs-media-adapter.ts's `_manifest-` prefix). */
    draftSubdir?: string;
    /** Injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
};
/**
 * GitHub Contents API adapter. Mirrors `markdown-adapter.ts`'s factory shape
 * and locale layout (default locale flat at `contentDir`, others under
 * `contentDir/<locale>/`, drafts under `.../<draftSubdir>`) and
 * `fs-media-adapter.ts`'s async convention -- unlike the filesystem adapter,
 * every method here does real network I/O, so none of them can be
 * synchronous. That is a real (structural) divergence from the `ContentAdapter`
 * interface in types.ts, which predates any network-backed implementation
 * and types every method as synchronous. Wiring this adapter into
 * `createStore`/`createMeditorApi` therefore needs that interface widened to
 * `T | Promise<T>` first -- deliberately out of scope here: it ripples into
 * store.ts, collection.ts, settings.ts, and api/routes.ts, which is a much
 * larger change than "add a GitHub adapter" and collides with the parallel
 * per-request-config-resolution work on routes.ts. This adapter is the ready,
 * tested piece that migration plugs in.
 *
 * The upside lands regardless of that wiring: every write here does an
 * immediate read-sha-then-write, and the PUT is atomically compare-and-swapped
 * server-side by GitHub against the sha it's given -- a real CAS, not the fs
 * adapter's unconditional overwrite. That's the shape store.ts's own
 * `saveDraft` ponytail note asks for ("an atomic adapter ... moves the
 * compare into the adapter via an optional expectedVersion hook").
 */
export declare function createGithubAdapter({ owner, repo, token, branch, contentDir, mediaDir, frontmatterKey, defaultLocale, locales, draftSubdir, fetchImpl, }: GithubAdapterOptions): {
    locales: string[];
    defaultLocale: string;
    root: string;
    parse: (raw: string) => PageContent;
    serialize: (page: PageContent) => string;
    listSlugs(locale?: string): Promise<string[]>;
    listLocales(slug: string): Promise<string[]>;
    exists: (slug: string, locale?: string) => Promise<boolean>;
    readRaw: (slug: string, locale?: string) => Promise<string>;
    writeRaw: (slug: string, raw: string, locale?: string) => Promise<void>;
    deletePublished: (slug: string, locale?: string) => Promise<void>;
    readDraftRaw: (slug: string, locale?: string) => Promise<string | null>;
    writeDraftRaw: (slug: string, raw: string, locale?: string) => Promise<void>;
    deleteDraft: (slug: string, locale?: string) => Promise<void>;
    hasDraft: (slug: string, locale?: string) => Promise<boolean>;
};

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
export type { Slice, PageContent, LocalizedPage, PageInfo, CollectionRecordInfo, ContentAdapter, CmsConfig, FieldDef, SliceSchema, MediaAsset, MediaAdapter, PreparedFile, } from "./types.js";
export { resolveI18n, localizedPath, localizedHref, routeLocale, defaultIsUnprefixed, type I18nConfig, type Messages, type RoutingMode, type LocaleRoute, } from "./i18n.js";
export { mergeLocalized, localeSubdir } from "./localize.js";
export { createMarkdownAdapter, type MarkdownAdapterOptions } from "./markdown-adapter.js";
export { createFsMediaAdapter, type FsMediaAdapterOptions } from "./fs-media-adapter.js";
export { createGithubAdapter, isAllowedRepoPath, type GithubAdapterOptions } from "./github-adapter.js";
export { processUpload, handleMediaUpload, MAX_UPLOAD_BYTES } from "./media.js";
export { createStore, type ContentStore } from "./store.js";
export { makeActions, type CmsActions, type PageActions, type SaveResult } from "./actions.js";
export { resolveAuth, legacyAuthAdapter, withPolicy, type AuthAdapter, type AuthAction, type AuthContext, type AuthUser, type Policy, } from "./auth-adapter.js";
export { filePolicy, type AccessPolicyFile } from "./file-policy.js";
export { versionOf, ConflictError } from "./version.js";
export { serializeFieldSchema, parseFieldSchema, isFieldSchema, type SerializedFieldSchema, } from "./field-schema.js";
export { resolveSections, DEFAULT_SECTIONS, SECTION_API_VERSION, type Section, type SectionKind, type SectionCtx, type ResolvedSection, type PagesSection, type MediaSection, type SettingsSection, type CollectionSection, type CustomSection, type FieldFormMedia, } from "./sections.js";
export { createSettingsStore, createFsSettingsAdapter, type SiteSettings, type SiteSettingsRuntime, type SiteSettingsBootstrap, type SettingsAdapter, type SettingsStore, } from "./settings.js";
export { makeCollectionActions, makeCollectionAdapter, buildCollectionActions, listCollectionRecords } from "./collection.js";

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
export declare function createMarkdownAdapter({ contentDir, draftDir, frontmatterKey, defaultLocale, locales, draftSubdir, requireSliceArray, }: MarkdownAdapterOptions): ContentAdapter;

// ---- dist/media.d.ts ----
import type { CmsConfig, PreparedFile } from "./types.js";
/** Pre-conversion upload cap. Sharp's own `limitInputPixels` default
 *  (~268 megapixels) is relied on as-is for decompression-bomb protection. */
export declare const MAX_UPLOAD_BYTES: number;
/** Validates + web-optimizes a raw upload. Never trusts the client-supplied
 *  mime/extension: sniffs actual bytes via sharp.metadata(). Throws with a
 *  user-facing message on any rejection. */
export declare function processUpload(input: {
    name: string;
    buffer: Buffer;
}): Promise<PreparedFile>;
/** Route Handler body. The host's route.ts is a thin wrapper, the same
 *  "host owns the boundary, package supplies the logic" split actions.ts
 *  already uses for Server Actions.
 *
 *  Route Handlers never run through a parent layout's auth gate (a
 *  `route.ts` renders no layout tree at all), so this re-checks auth itself
 *  via the same `resolveAuth` the action guard uses. */
export declare function handleMediaUpload(config: CmsConfig, request: Request): Promise<Response>;

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

// ---- dist/sections.d.ts ----
import type { ComponentType } from "react";
import type { ContentAdapter, MediaAdapter, MediaAsset, SliceSchema } from "./types.js";
import type { PageActions } from "./actions.js";
import type { Messages } from "./i18n.js";
import type { SiteSettings, SettingsStore } from "./settings.js";
export type FieldFormMedia = {
    list: () => Promise<MediaAsset[]>;
    delete: (id: string) => Promise<void>;
    uploadPath: string;
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
export interface CollectionSection extends SectionBase {
    kind: "collection";
    /** Repo-relative dir, e.g. "content/authors". Gets its OWN ContentAdapter
     *  instance. MUST NOT resolve inside the Pages contentDir (guarded at
     *  buildCollectionActions time, throws loud). */
    dir: string;
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
export type Section = PagesSection | MediaSection | SettingsSection | CollectionSection | CustomSection;
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
export declare function generateLlmsFullTxt(store: ContentStore, renderOverrides?: SliceMarkdownRegistry): string;

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
import { NextResponse, type NextRequest } from "next/server";
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
export declare function buildSitemap(store: ContentStore, config: SeoConfig, opts?: BuildSitemapOptions): MetadataRoute.Sitemap;

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
import type { CmsConfig, MediaAsset } from "./types.js";
import type { RoutingMode } from "./i18n.js";
import type { SaveResult } from "./actions.js";
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
/** Default bootstrap adapter: one root JSON, atomic tmp+rename write so no
 *  reader ever observes a half-written config that gates server boot. */
export declare function createFsSettingsAdapter(opts: {
    file: string;
}): SettingsAdapter;
export interface SettingsStore {
    get(locale?: string): SiteSettingsRuntime;
    /** Version of the stored settings doc, for the same optimistic-lock flow pages
     *  use. Without this a client had nothing to seed `baseVersion` from, so its
     *  FIRST save passed `undefined`, which `store.saveDraft` treats as "no base
     *  version to check" and writes unconditionally, silently overwriting whatever
     *  another session had just saved. */
    currentVersion(locale?: string): string | null;
    saveDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
    publish(baseVersion?: string, locale?: string): Promise<SaveResult>;
    bootstrap: SettingsAdapter;
}
export declare function createSettingsStore(config: CmsConfig): SettingsStore;

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
    /** Move a page from `slug` to `newSlug`: published AND any draft, in every
     *  locale the source occupies (see markdown-adapter's per-locale layout).
     *  All-locales, unlike most ops' single optional `locale` param: a page's
     *  slug is the key tying its translations together (`listPages` derives the
     *  canonical page set from the default locale's slugs), so moving only one
     *  locale's file would strand the rest under the old name. Throws
     *  `SlugExistsError` (not `ConflictError`, a destination collision, not a
     *  stale-version race) if `newSlug` already has content anywhere the move
     *  would touch. No-op if `newSlug === slug`. */
    renamePage(slug: string, newSlug: string): void;
    /** Copy `slug`'s content (published AND draft, whichever exist) to a new,
     *  auto-derived non-colliding slug (see `slugify`) and return it. Single-
     *  locale (defaults to the default locale), matching `createPage`'s own
     *  scope; other translations of the source are not duplicated. Throws if
     *  `slug` has neither published nor draft content to copy. */
    duplicatePage(slug: string, locale?: string): string;
}
export declare function createStore(adapter: ContentAdapter, opts?: {
    onPublish?: (slug: string, locale: string) => void | Promise<void>;
    onSaveDraft?: (slug: string, locale: string, version: string) => void;
    /** Default locale for fallback. Defaults to the adapter's. */
    defaultLocale?: string;
}): ContentStore;

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
 *  in (translation status); `hasDraft` is for the currently-listed locale. */
export type PageInfo = {
    slug: string;
    title: string;
    hasDraft: boolean;
    locales: string[];
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
    upload(file: PreparedFile): Promise<MediaAsset>;
    delete(id: string): Promise<void>;
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
    /** Absolute path to this adapter's content root. Lets callers that need to
     *  site something beside it (the `.typren/` settings dir, a collection's
     *  dir-overlap guard) do so without re-deriving or guessing the path. */
    readonly root: string;
    /** Slugs of every editable (sliced) page in a locale (defaults to default). */
    listSlugs(locale?: string): string[];
    /** Locales in which `slug` has a published file (switcher / translation status). */
    listLocales(slug: string): string[];
    exists(slug: string, locale?: string): boolean;
    /** Raw published source (throws if absent; callers gate with `exists`). */
    readRaw(slug: string, locale?: string): string;
    writeRaw(slug: string, raw: string, locale?: string): void;
    /** Delete the published source (and let the store also drop any draft). */
    deletePublished(slug: string, locale?: string): void;
    /** Raw draft source, or null when no draft is checked out. */
    readDraftRaw(slug: string, locale?: string): string | null;
    writeDraftRaw(slug: string, raw: string, locale?: string): void;
    deleteDraft(slug: string, locale?: string): void;
    hasDraft(slug: string, locale?: string): boolean;
    /** Parse raw source into structured content, and back. Locale-agnostic: the
     *  locale is a path segment, never inside the file. */
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
    /** Optional media library. Omit to disable media management. Image-typed
     *  fields (see FieldDef) still render, just as a plain text input with no
     *  "Browse library" button. */
    mediaAdapter?: MediaAdapter;
    /** Left-nav section registry. Omit → resolveSections() returns the default
     *  trio (pages, media, settings); existing hosts get byte-identical
     *  behavior, mirroring resolveI18n's omitted-block collapse. */
    sections?: Section[];
    /** Where SiteSettings persists. Omit → derived from `adapter`'s root: runtime
     *  tier in a private sibling dir, bootstrap tier in a root JSON file. No new
     *  adapter required to get Settings/onboarding working. */
    settingsAdapter?: SettingsAdapter;
    /** `false` disables first-run onboarding (embeds, tests, hosts that seed
     *  settings out-of-band). Omit = auto-detect via bootstrap `onboarded` flag. */
    onboarding?: false;
    /** Hosted-platform tenant scope for this config instance. Threaded into
     *  every `AuthContext` the package builds (actions.ts, settings.ts,
     *  media.ts, api/routes.ts) so a hosted `authorize()` can enforce isolation
     *  structurally. Resolve server-side per request (see `createTyprenApi`'s
     *  config-factory form) — never take these from the client. Omit for a
     *  single-site config; behavior is byte-identical. */
    siteId?: string;
    accountId?: string;
}
export type { I18nConfig, Messages, RoutingMode } from "./i18n.js";

// ---- dist/ui/i18n-strings.d.ts ----
import type { Messages } from "../i18n.js";
/**
 * Vanilla (non-React) counterpart to @typren/editor's `useT`: same
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
 */
/**
 * Attach the preview bridge listeners + inject its stylesheet into
 * `document.head` (once). Returns a cleanup function that removes the
 * listeners (the injected `<style>` is left in place: idempotent, harmless).
 *
 * `allowedOrigin` is the one origin this frame will post to and accept
 * messages from. Omit it and the bridge defaults to `window.location.origin`
 * (byte-identical to the old same-origin-only behavior, for local/self-host
 * setups embedding their own dashboard). A hosted dashboard framing a
 * customer's site is cross-origin by definition, so it must pass its own
 * origin explicitly here (learned from the site record) — this is never
 * `"*"`; the channel always compares against one explicit value.
 */
export declare function initPreviewBridge(allowedOrigin?: string): () => void;

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
