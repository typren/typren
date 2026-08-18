import { makeActions } from "../actions";
import { resolveAuth } from "../auth-adapter";
import { buildCollectionActions, listCollectionRecords, makeCollectionAdapter } from "../collection";
import { handleMediaUpload } from "../media";
import { resolveSections, type CollectionSection } from "../sections";
import { createSettingsStore } from "../settings";
import { createStore, type ContentStore } from "../store";
import type { CmsConfig, ContentAdapter, PageContent } from "../types";
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

const RESOURCES = ["pages", "media", "settings", "collections"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function json(body: unknown, status = 200): Response {
  return Response.json(body as Record<string, unknown>, { status });
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

function sameOrigin(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser caller; no ambient credentials to abuse
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
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
 */
export function createTyprenApi(config: CmsConfig, options: TyprenApiOptions = {}) {
  const actions = makeActions(config);
  const store = createStore(config.adapter, { onPublish: config.onPublish });
  const settings = createSettingsStore(config);
  const auth = resolveAuth(config);
  const allowed = options.allowedOrigins ?? [];

  // One PageActions per collection (writes) plus this route layer's own
  // adapter/store per collection (reads), the same actions/store split the
  // Pages resource makes above, since PageActions has no read method (see
  // actions.ts) any more than makeActions' internal store is exposed for Pages.
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

  async function handler(request: Request): Promise<Response> {
    if (!SAFE_METHODS.has(request.method) && !sameOrigin(request, allowed)) {
      return json({ error: "Cross-origin request refused" }, 403);
    }

    const url = new URL(request.url);
    const [resource, ...rest] = segments(url, options.basePath);
    const locale = url.searchParams.get("locale") ?? undefined;
    const method = request.method;

    try {
      if (resource === "pages") return await pages(request, method, rest, locale);
      if (resource === "media") return await media(request, method, rest);
      if (resource === "settings") return await settingsRoutes(request, method, rest, locale);
      if (resource === "collections") return await collections(request, method, rest, locale);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      if (isUnauthorized(e)) return json({ error: "Unauthorized" }, 403);
      return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
    }
  }

  async function requireRead(): Promise<Response | null> {
    return (await auth.authorize({ action: "read" })) ? null : json({ error: "Unauthorized" }, 403);
  }

  /** A conflict is a normal outcome of optimistic locking, not a failure: it
   *  comes back as `{ ok: false, code: "conflict" }`. Surfaced as 409 so HTTP
   *  callers can branch on status, with the body kept intact for the client. */
  function saveResult(result: { ok: boolean; code?: string }): Response {
    return json(result, result.ok ? 200 : result.code === "conflict" ? 409 : 400);
  }

  async function pages(request: Request, method: string, rest: string[], locale?: string): Promise<Response> {
    const [slug, sub, subId] = rest;

    if (!slug) {
      if (method === "GET") {
        const denied = await requireRead();
        return denied ?? json({ pages: store.listPages(locale) });
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
        const denied = await requireRead();
        if (denied) return denied;
        if (!config.adapter.exists(slug, config.adapter.defaultLocale)) return json({ error: "Not found" }, 404);
        const draft = store.getDraft(slug, locale);
        const published = store.getPublished(slug, locale);
        return json({
          page: draft ?? published,
          version: store.currentVersion(slug, locale),
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
  async function collections(request: Request, method: string, rest: string[], locale?: string): Promise<Response> {
    const [id, slug, sub] = rest;
    const section = collectionSections.get(id);
    const actions = collectionActions[id];
    if (!section || !actions) return json({ error: "Not found" }, 404);

    if (!slug) {
      if (method === "GET") {
        const denied = await requireRead();
        return denied ?? json({ records: listCollectionRecords(config, section, locale) });
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
        const denied = await requireRead();
        if (denied) return denied;
        const adapter = collectionAdapters.get(id)!;
        if (!adapter.exists(slug, adapter.defaultLocale)) return json({ error: "Not found" }, 404);
        const collectionStore = collectionStores.get(id)!;
        const draft = collectionStore.getDraft(slug, locale);
        const published = collectionStore.getPublished(slug, locale);
        return json({
          page: draft ?? published,
          version: collectionStore.currentVersion(slug, locale),
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

  async function media(request: Request, method: string, rest: string[]): Promise<Response> {
    const [id] = rest;
    if (!id) {
      if (method === "GET") return json({ media: await actions.listMedia() });
      // Delegated: upload owns its own validation, conversion and auth action.
      if (method === "POST") return handleMediaUpload(config, request);
      return json({ error: "Method not allowed" }, 405);
    }
    if (method === "DELETE") {
      await actions.deleteMedia(decodeURIComponent(id));
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  async function settingsRoutes(
    request: Request,
    method: string,
    rest: string[],
    locale?: string
  ): Promise<Response> {
    const [sub] = rest;

    if (!sub && method === "GET") {
      const denied = await requireRead();
      // `version` completes the optimistic-lock loop: a client had no way to read
      // it, so its first save sent no baseVersion and could not conflict-detect.
      return (
        denied ??
        json({
          ...settings.get(locale),
          bootstrap: settings.bootstrap.readBootstrap(),
          version: settings.currentVersion(locale),
        })
      );
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
    if (sub === "bootstrap" && method === "PUT") {
      // Bootstrap writes reparameterize what the next boot trusts, and
      // SettingsAdapter has no gate of its own, so it's checked here.
      if (!(await auth.authorize({ action: "admin" }))) return json({ error: "Unauthorized" }, 403);
      const { patch } = await body<{ patch?: Partial<SiteSettingsBootstrap> }>(request);
      if (!patch) return json({ error: "patch is required" }, 400);
      settings.bootstrap.writeBootstrap(patch);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
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
