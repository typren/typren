import { ActionRefusedError, makeActions } from "../actions";
import { resolveAuth } from "../auth-adapter";
import { GitError } from "../git";
import { buildCollectionActions, listCollectionRecords, makeCollectionAdapter } from "../collection";
import { createSliceLibrary, type FolderedLibrary } from "../library";
import { handleMediaUpload, sameOrigin } from "../media";
import { resolveSections, type CollectionSection } from "../sections";
import { BOOTSTRAP_KEYS, createSettingsStore } from "../settings";
import { createStore, type ContentStore } from "../store";
import type { CmsConfig, ContentAdapter, PageContent, Slice } from "../types";
import type { PageMetaPatch } from "../actions";
import type { SiteSettingsBootstrap, SiteSettingsRuntime } from "../settings";

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

const RESOURCES = ["pages", "media", "settings", "collections", "git", "library", "folders"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function json(body: unknown, status = 200): Response {
  return Response.json(body as Record<string, unknown>, { status });
}

/** Draft content, settings, and the media library are per-request/per-user
 *  reads that a shared cache (CDN, browser back/forward cache) must never
 *  store: an intermediary caching an unpublished draft or another editor's
 *  settings snapshot would leak it to the next viewer of that URL. */
function jsonNoStore(body: unknown, status = 200): Response {
  const res = Response.json(body as Record<string, unknown>, { status });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/** Unauthorized from an action guard is a thrown Error, not a status. Map it
 *  to 403 and let anything else surface as a 500 rather than being swallowed. */
function isUnauthorized(e: unknown): boolean {
  return e instanceof Error && /unauthorized/i.test(e.message);
}

function segments(url: URL, basePath?: string): string[] {
  let path = url.pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  const parts = path.split("/").filter(Boolean);
  // No explicit basePath: drop everything before the first known resource so a
  // host can mount this anywhere without configuring it.
  const start = parts.findIndex((p) => (RESOURCES as readonly string[]).includes(p));
  return start === -1 ? parts : parts.slice(start);
}

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Everything derived from a single `CmsConfig`: actions/settings/auth
 *  plus the per-collection registry. Pure function of `config` -- called once
 *  at construction for a plain-config call, or fresh per request for a
 *  factory (see `createTyprenApi`), so it must never read or mutate anything
 *  outside its argument. */
function build(config: CmsConfig) {
  const actions = makeActions(config);
  const settings = createSettingsStore(config);
  const library = createSliceLibrary(config);
  const auth = resolveAuth(config);

  // One PageActions per collection (writes) plus this route layer's own
  // adapter/store per collection (reads): PageActions has no read method
  // (see actions.ts), unlike the Pages resource's full makeActions.
  const collectionSections = new Map<string, CollectionSection>(
    resolveSections(config)
      .filter((s) => s.kind === "collection")
      .map((s) => [s.id, s.raw as CollectionSection])
  );
  const collectionActions = buildCollectionActions(config);
  const collectionAdapters = new Map<string, ContentAdapter>();
  const collectionStores = new Map<string, ContentStore>();
  for (const [id, section] of collectionSections) {
    const adapter = makeCollectionAdapter(config, section);
    collectionAdapters.set(id, adapter);
    collectionStores.set(id, createStore(adapter));
  }

  return {
    config,
    actions,
    settings,
    library,
    auth,
    collectionSections,
    collectionActions,
    collectionAdapters,
    collectionStores,
  };
}

type Built = ReturnType<typeof build>;

/** A conflict is a normal outcome of optimistic locking, not a failure: it
 *  comes back as `{ ok: false, code: "conflict" }`. Surfaced as 409 so HTTP
 *  callers can branch on status, with the body kept intact for the client. */
function saveResult(result: { ok: boolean; code?: string }): Response {
  return json(result, result.ok ? 200 : result.code === "conflict" ? 409 : 400);
}

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
export function createTyprenApi(config: CmsConfig | CmsConfigFactory, options: TyprenApiOptions = {}) {
  const allowed = options.allowedOrigins ?? [];
  const isFactory = typeof config === "function";
  const cached = isFactory ? null : build(config);

  async function handler(request: Request): Promise<Response> {
    if (!SAFE_METHODS.has(request.method) && !sameOrigin(request, allowed)) {
      return json({ error: "Cross-origin request refused" }, 403);
    }

    const built = cached ?? build(await (config as CmsConfigFactory)(request));

    const url = new URL(request.url);
    const [resource, ...rest] = segments(url, options.basePath);
    const locale = url.searchParams.get("locale") ?? undefined;
    const method = request.method;

    try {
      if (resource === "pages") return await pages(built, request, method, rest, locale);
      if (resource === "media") return await media(built, request, method, rest, allowed);
      if (resource === "settings") return await settingsRoutes(built, request, method, rest, locale);
      if (resource === "collections") return await collections(built, request, method, rest, locale);
      if (resource === "git") return await gitRoutes(built, request, method, rest);
      if (resource === "folders") return await folderRoutes(built, request, method, rest, locale);
      if (resource === "library") return await libraryRoutes(built, request, method, rest);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      if (isUnauthorized(e)) return json({ error: "Unauthorized" }, 403);
      // Written for the person saving (see explainGitError), so it is shown.
      if (e instanceof GitError) return json({ error: e.message }, 422);
      if (e instanceof ActionRefusedError) return json({ error: e.message }, 422);
      // Never echo e.message to the client: an adapter/filesystem error can carry
      // absolute paths, slugs, or other internals a public API response shouldn't
      // leak. Full detail still reaches the server's own logs.
      console.error("typren: unhandled API error", e);
      return json({ error: "Internal error" }, 500);
    }
  }

  return {
    handler,
    // Named exports for hosts that dispatch by method (Next Route Handlers).
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
  };
}

async function requireRead(
  built: Built,
  ctx: { slug?: string; collectionId?: string; locale?: string } = {}
): Promise<Response | null> {
  return (await built.auth.authorize({ action: "read", ...ctx, siteId: built.config.siteId, accountId: built.config.accountId }))
    ? null
    : json({ error: "Unauthorized" }, 403);
}

async function pages(
  built: Built,
  request: Request,
  method: string,
  rest: string[],
  locale?: string
): Promise<Response> {
  const { actions } = built;
  const [encoded, sub, subId] = rest;
  if (encoded === "publish-all" && !sub && method === "POST") return json({ slugs: await actions.publishAll(locale) });
  // A nested slug (`event/1`) arrives as one encoded segment; the adapter's
  // slug guard still judges the decoded value.
  const slug = encoded && decodeURIComponent(encoded);

  if (!slug) {
    if (method === "GET") return jsonNoStore({ pages: await actions.listPages(locale) });
    if (method === "POST") {
      const { title, slug: at, draft, slices } = await body<{ title?: string; slug?: string; draft?: boolean; slices?: Slice[] }>(request);
      if (!title) return json({ error: "title is required" }, 400);
      if (slices) {
        if (!at) return json({ error: "slug is required" }, 400);
        return json({ slug: await actions.createPageFrom(title, at, slices, locale) }, 201);
      }
      return json({ slug: await actions.createPage(title, locale, { slug: at, draft: draft === true }) }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (!sub) {
    if (method === "GET") {
      const opened = await actions.getPage(slug, locale);
      return opened ? jsonNoStore(opened) : json({ error: "Not found" }, 404);
    }
    if (method === "DELETE") {
      await actions.deletePage(slug);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (sub === "draft") {
    if (method === "PUT") {
      const { page, baseVersion } = await body<{ page?: PageContent; baseVersion?: string }>(request);
      if (!page) return json({ error: "page is required" }, 400);
      return saveResult(await actions.saveDraft(slug, page, baseVersion, locale));
    }
    if (method === "DELETE") {
      await actions.discardDraft(slug, locale);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (sub === "publish" && method === "POST") {
    const { baseVersion } = await body<{ baseVersion?: string }>(request);
    return saveResult(await actions.publish(slug, baseVersion, locale));
  }

  if (sub === "commit" && method === "POST") {
    const { page, baseVersion } = await body<{ page?: PageContent; baseVersion?: string }>(request);
    return saveResult(await actions.commitPage(slug, page, baseVersion, locale));
  }

  if (sub === "sections" && method === "POST") {
    const { slice, at, baseVersion } = await body<{ slice?: Slice; at?: number | "end"; baseVersion?: string }>(request);
    if (!slice) return json({ error: "slice is required" }, 400);
    return saveResult(await actions.insertSection(slug, slice, at ?? "end", baseVersion, locale));
  }

  if (sub === "meta" && method === "PUT") {
    const { patch, baseVersion } = await body<{ patch?: PageMetaPatch; baseVersion?: string }>(request);
    if (!patch) return json({ error: "patch is required" }, 400);
    return saveResult(await actions.updatePageMeta(slug, patch, baseVersion, locale));
  }

  if (sub === "rename" && method === "POST") {
    const { newSlug } = await body<{ newSlug?: string }>(request);
    if (!newSlug) return json({ error: "newSlug is required" }, 400);
    return saveResult(await actions.renamePage(slug, newSlug));
  }

  if (sub === "duplicate" && method === "POST") {
    return json({ slug: await actions.duplicatePage(slug, locale) }, 201);
  }

  if (sub === "translations") {
    if (method === "POST") {
      const { toLocale } = await body<{ toLocale?: string }>(request);
      if (!toLocale) return json({ error: "toLocale is required" }, 400);
      await actions.createTranslation(slug, toLocale);
      return json({ ok: true }, 201);
    }
    if (method === "DELETE" && subId) {
      await actions.deleteTranslation(slug, subId);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}

/** `rest` is `[id, slug?, sub?]`: `id` is the resolved section id (see
 *  resolveSections), never confusable with a record's own `slug`/`sub`:
 *  `segments()` matches "collections" itself before this function ever sees
 *  the path, so a record whose slug happens to be the literal string
 *  "pages"/"media"/"settings" (or even "collections") still lands as `slug`
 *  here, not as a top-level resource (see routes.test.ts). */
async function collections(
  built: Built,
  request: Request,
  method: string,
  rest: string[],
  locale?: string
): Promise<Response> {
  const { config, collectionSections, collectionActions, collectionAdapters, collectionStores } = built;
  const [id, slug, sub] = rest;
  const section = collectionSections.get(id);
  const actions = collectionActions[id];
  if (!section || !actions) return json({ error: "Not found" }, 404);

  if (!slug) {
    if (method === "GET") {
      const denied = await requireRead(built, { collectionId: id, locale });
      return denied ?? jsonNoStore({ records: await listCollectionRecords(config, section, locale) });
    }
    if (method === "POST") {
      const { title } = await body<{ title?: string }>(request);
      if (!title) return json({ error: "title is required" }, 400);
      return json({ slug: await actions.createPage(title, locale) }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (!sub) {
    if (method === "GET") {
      const denied = await requireRead(built, { collectionId: id, slug, locale });
      if (denied) return denied;
      const adapter = collectionAdapters.get(id)!;
      if (!(await adapter.exists(slug, adapter.defaultLocale))) return json({ error: "Not found" }, 404);
      const collectionStore = collectionStores.get(id)!;
      const [draft, published, version] = await Promise.all([
        collectionStore.getDraft(slug, locale),
        collectionStore.getPublished(slug, locale),
        collectionStore.currentVersion(slug, locale),
      ]);
      return jsonNoStore({
        page: draft ?? published,
        version,
        hasDraft: Boolean(draft),
      });
    }
    if (method === "DELETE") {
      await actions.deletePage(slug);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (sub === "draft") {
    if (method === "PUT") {
      const { page, baseVersion } = await body<{ page?: PageContent; baseVersion?: string }>(request);
      if (!page) return json({ error: "page is required" }, 400);
      return saveResult(await actions.saveDraft(slug, page, baseVersion, locale));
    }
    if (method === "DELETE") {
      await actions.discardDraft(slug, locale);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (sub === "publish" && method === "POST") {
    const { baseVersion } = await body<{ baseVersion?: string }>(request);
    return saveResult(await actions.publish(slug, baseVersion, locale));
  }

  return json({ error: "Not found" }, 404);
}

async function media(
  built: Built,
  request: Request,
  method: string,
  rest: string[],
  allowed: string[]
): Promise<Response> {
  const { config, actions } = built;
  const id = rest.join("/");
  if (id === "folders") {
    if (method === "GET") return jsonNoStore({ folders: await actions.listMediaFolders() });
    if (method === "POST") {
      await actions.createMediaFolder((await body<{ folder: string }>(request)).folder);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await actions.deleteMediaFolder(new URL(request.url).searchParams.get("folder") ?? "");
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }
  if (id === "folders/rename" && method === "POST") {
    const { folder, to } = await body<{ folder: string; to: string }>(request);
    await actions.renameMediaFolder(folder, to);
    return json({ ok: true });
  }
  if (id === "usage" && method === "GET") return jsonNoStore({ usage: await actions.mediaUsage() });
  if (id === "move" && method === "POST") {
    const { id: asset, folder, name } = await body<{ id: string; folder: string; name?: string }>(request);
    return json(await actions.moveMedia(asset, folder, name));
  }
  if (!id) {
    if (method === "GET") return jsonNoStore({ media: await actions.listMedia() });
    // Delegated: the HTTP checks before the body is read live there.
    if (method === "POST") return handleMediaUpload(config, request, allowed);
    return json({ error: "Method not allowed" }, 405);
  }
  if (method === "DELETE") {
    const force = new URL(request.url).searchParams.get("force") === "1";
    await actions.deleteMedia(rest.map(decodeURIComponent).join("/"), { force });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function settingsRoutes(
  built: Built,
  request: Request,
  method: string,
  rest: string[],
  locale?: string
): Promise<Response> {
  const { settings } = built;
  const [sub] = rest;

  if (!sub && method === "GET") {
    const denied = await requireRead(built, { locale });
    // `version` completes the optimistic-lock loop: a client had no way to read
    // it, so its first save sent no baseVersion and could not conflict-detect.
    if (denied) return denied;
    // The draft when there is one: this is the editor's read, as a page's is.
    const { settings: current, version, hasDraft } = await settings.open(locale);
    // Only the keys the editor edits: the rest of typren.config.json (the CLI's
    // `studio` block with its preview command and paths) is not the read tier's.
    const bootstrap = Object.fromEntries(Object.entries(settings.bootstrap.readBootstrap()).filter(([k]) => BOOTSTRAP_KEYS.has(k)));
    return jsonNoStore({ ...current, bootstrap, version, hasDraft });
  }
  if (sub === "draft" && method === "PUT") {
    const { settings: next, baseVersion } = await body<{
      settings?: SiteSettingsRuntime;
      baseVersion?: string;
    }>(request);
    if (!next) return json({ error: "settings is required" }, 400);
    return saveResult(await settings.saveDraft(next, baseVersion, locale));
  }
  if (sub === "publish" && method === "POST") {
    const { baseVersion } = await body<{ baseVersion?: string }>(request);
    return saveResult(await settings.publish(baseVersion, locale));
  }
  if (sub === "draft" && method === "DELETE") {
    await settings.discardDraft(locale);
    return json({ ok: true });
  }
  if (sub === "history" && method === "GET") {
    const denied = await requireRead(built, { locale });
    return denied ?? jsonNoStore(await settings.history(locale, Number(new URL(request.url).searchParams.get("limit") ?? 20)));
  }
  if (sub === "bootstrap" && method === "PUT") {
    const { patch } = await body<{ patch?: Partial<SiteSettingsBootstrap> }>(request);
    if (!patch || typeof patch !== "object") return json({ error: "patch is required" }, 400);
    const result = await settings.writeBootstrap(patch);
    return result.ok ? json(result) : json(result, 400);
  }

  return json({ error: "Not found" }, 404);
}

/** The library guards itself (see createSliceLibrary), like the actions.
 *  Sections and page templates share the move and folder routes. */
async function libraryRoutes(built: Built, request: Request, method: string, rest: string[]): Promise<Response> {
  const { library } = built;
  const [id] = rest;
  if (id === "templates") return templateRoutes(library.templates, request, method, rest.slice(1));
  const shared = await entryFolderRoutes(library, request, method, rest);
  if (shared) return shared;
  if (!id && method === "GET") return jsonNoStore({ saved: await library.list() });
  if (!id && method === "POST") {
    const { name, slice } = await body<{ name?: string; slice?: Slice }>(request);
    if (!slice || typeof slice.slice !== "string") return json({ error: "slice is required" }, 400);
    return json(await library.save(name ?? "", slice));
  }
  if (id && method === "PUT") {
    const { slice, baseSavedAt, name } = await body<{ slice?: Slice; baseSavedAt?: string; name?: unknown }>(request);
    if (!slice || typeof slice.slice !== "string" || typeof baseSavedAt !== "string")
      return json({ error: "slice and baseSavedAt are required" }, 400);
    const result = await library.update(decodeURIComponent(id), slice, baseSavedAt, typeof name === "string" ? name : undefined);
    return json(result, result.ok ? 200 : result.code === "conflict" ? 409 : 404);
  }
  if (id && method === "DELETE") {
    await library.remove(decodeURIComponent(id));
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

/** `:id/move` and `folders[/rename]` for either list; null when `rest` is neither. */
async function entryFolderRoutes(
  lib: Pick<FolderedLibrary | FolderedLibrary["templates"], "folders"> & {
    move(id: string, folder: string, baseSavedAt?: string): Promise<{ ok: boolean; code?: string }>;
  },
  request: Request,
  method: string,
  rest: string[]
): Promise<Response | null> {
  const [id, sub] = rest;
  if (id && sub === "move" && method === "POST") {
    const { folder, baseSavedAt } = await body<{ folder?: unknown; baseSavedAt?: unknown }>(request);
    if (typeof folder !== "string" || (baseSavedAt !== undefined && typeof baseSavedAt !== "string"))
      return json({ error: "folder is required" }, 400);
    const result = await lib.move(decodeURIComponent(id), folder, baseSavedAt);
    return json(result, result.ok ? 200 : result.code === "conflict" ? 409 : 404);
  }
  if (id !== "folders") return null;
  if (!sub && method === "GET") return jsonNoStore({ folders: await lib.folders.list() });
  if (!sub && method === "POST") {
    const { folder } = await body<{ folder?: unknown }>(request);
    if (typeof folder !== "string") return json({ error: "folder is required" }, 400);
    await lib.folders.create(folder);
    return json({ ok: true });
  }
  if (!sub && method === "DELETE") {
    await lib.folders.delete(new URL(request.url).searchParams.get("folder") ?? "");
    return json({ ok: true });
  }
  if (sub === "rename" && method === "POST") {
    const { folder, to } = await body<{ folder?: unknown; to?: unknown }>(request);
    if (typeof folder !== "string" || typeof to !== "string") return json({ error: "folder and to are required" }, 400);
    await lib.folders.rename(folder, to);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

const isSlices = (v: unknown): v is Slice[] =>
  Array.isArray(v) && v.every((s) => s && typeof (s as Slice).slice === "string");

async function templateRoutes(
  templates: FolderedLibrary["templates"],
  request: Request,
  method: string,
  rest: string[]
): Promise<Response> {
  const [id] = rest;
  const shared = await entryFolderRoutes(templates, request, method, rest);
  if (shared) return shared;
  if (!id && method === "GET") return jsonNoStore({ templates: await templates.list() });
  if (!id && method === "POST") {
    const { name, slices } = await body<{ name?: string; slices?: unknown }>(request);
    if (!isSlices(slices)) return json({ error: "slices is required" }, 400);
    return json(await templates.save(name ?? "", slices));
  }
  if (id && method === "PUT") {
    const { slices, baseSavedAt, name } = await body<{ slices?: unknown; baseSavedAt?: string; name?: string }>(request);
    if (!isSlices(slices) || typeof baseSavedAt !== "string")
      return json({ error: "slices and baseSavedAt are required" }, 400);
    const result = await templates.update(decodeURIComponent(id), slices, baseSavedAt, typeof name === "string" ? name : undefined);
    return json(result, result.ok ? 200 : result.code === "conflict" ? 409 : 404);
  }
  if (id && method === "DELETE") {
    await templates.remove(decodeURIComponent(id));
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

async function gitRoutes(built: Built, request: Request, method: string, rest: string[]): Promise<Response> {
  const { config, actions } = built;
  const [sub] = rest;
  if (!config.git) return json({ error: "Not found" }, 404);
  if (!sub && method === "GET") return (await requireRead(built)) ?? jsonNoStore(await config.git.outgoing());
  if (sub === "pending" && method === "GET") return jsonNoStore(await actions.pendingChanges());
  if (sub === "discard" && method === "POST") {
    const { paths } = await body<{ paths?: unknown }>(request);
    if (!isPaths(paths)) return json({ error: "paths is required" }, 400);
    await actions.discardChanges(paths);
    return json({ ok: true });
  }
  if (sub === "history" && method === "GET") {
    const q = new URL(request.url).searchParams;
    const slug = q.get("slug");
    if (!slug) return json({ error: "slug is required" }, 400);
    try {
      return jsonNoStore(await actions.pageHistory(slug, q.get("locale") ?? undefined, Number(q.get("limit") ?? 20)));
    } catch (e) {
      // An unsafe slug (the adapter) or a file outside the content (the repo).
      if (e instanceof GitError || (e instanceof Error && /^typren: (unsafe|unknown locale|refusing)/.test(e.message))) return json({ error: "Not a page of this site" }, 400);
      throw e;
    }
  }
  if (sub === "push" && method === "POST") {
    const { paths, slugs, settings } = await body<{ paths?: unknown; slugs?: unknown; settings?: unknown }>(request);
    // Either list may be empty when the other, or `settings`, carries the push.
    if (paths !== undefined && !isList(paths)) return json({ error: "paths must be a list of file paths" }, 400);
    if (slugs !== undefined && !isList(slugs)) return json({ error: "slugs must be a list of page slugs" }, 400);
    // `settings: true` pushes the settings doc's draft too, as its own commit.
    const more = settings === true ? [() => built.settings.publish()] : [];
    const result = await (paths || slugs || more.length ? actions.pushChanges(paths ?? [], slugs ?? [], undefined, more) : actions.push());
    // The one route that echoes an error: a rejected push's own text
    // (non-fast-forward, credentials) is what the person pushing must see.
    return result.ok ? json(result) : json(result, 502);
  }
  return json({ error: "Not found" }, 404);
}

const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((p) => typeof p === "string");
const isPaths = (v: unknown): v is string[] => isList(v) && v.length > 0;

/** Page folders kept without pages (see `ContentAdapter.createFolder`). */
async function folderRoutes(built: Built, request: Request, method: string, rest: string[], locale?: string): Promise<Response> {
  const { actions } = built;
  const folder = rest[0] && decodeURIComponent(rest[0]);
  if (!folder && method === "GET") return jsonNoStore({ folders: await actions.listPageFolders(locale) });
  if (!folder && method === "POST") {
    const { path } = await body<{ path?: string }>(request);
    if (!path) return json({ error: "path is required" }, 400);
    await actions.createPageFolder(path, locale);
    return json({ ok: true }, 201);
  }
  if (folder && method === "DELETE") {
    try {
      await actions.deletePageFolder(folder, locale);
    } catch (e) {
      if (e instanceof Error && /is not empty/.test(e.message)) return json({ error: "The folder is not empty" }, 409);
      throw e;
    }
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
