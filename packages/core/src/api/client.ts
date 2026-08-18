import type { PageActions, RenameResult, SaveResult } from "../actions";
import type { CollectionRecordInfo, MediaAsset, PageContent, PageInfo } from "../types";
import type { SiteSettings, SiteSettingsBootstrap, SiteSettingsRuntime } from "../settings";

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
  getPage(slug: string, locale?: string): Promise<{ page: PageContent; version: string | null; hasDraft: boolean }>;
  // Not part of PageActions (see its doc comment): no shipped UI shell calls
  // these yet, so they're declared here directly rather than forcing every
  // host's hand-reconstructed PageActions literal to grow a stub.
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
    getRecord(slug: string, locale?: string): Promise<{ page: PageContent; version: string | null; hasDraft: boolean }>;
  };
}

class TyprenApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TyprenApiError";
  }
}

export function createTyprenClient(options: TyprenClientOptions): TyprenClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const query = (locale?: string) => (locale ? `?locale=${encodeURIComponent(locale)}` : "");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
        ...options.headers,
        ...init?.headers,
      },
    });

    // A 409 is a real answer (optimistic-lock conflict), not an error: the body
    // is the SaveResult the caller branches on, so it must not throw.
    if (response.status === 409) return (await response.json()) as T;

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}) as { error?: string });
      throw new TyprenApiError(detail.error ?? `${response.status} ${response.statusText}`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // Generic over T (defaults to SaveResult) so renamePage can reuse it for its
  // own conflict-shaped result without a second near-identical helper.
  const send = <T = SaveResult>(path: string, method: string, payload?: unknown) =>
    call<T>(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

  // The 5 PageActions methods that map 1:1 onto a "/<base>[/:slug]" resource,
  // shared between the top-level Pages methods (`base = "/pages"`) and
  // `collection(id)` (`base = "/collections/:id"`), same routes.ts conventions
  // either way. createTranslation/deleteTranslation aren't here: Pages has real
  // routes for them, collections (see collection()) don't.
  const pageActionsOver = (
    base: string
  ): Pick<PageActions, "saveDraft" | "discardDraft" | "publish" | "createPage" | "deletePage"> => ({
    async saveDraft(slug, page, baseVersion, locale) {
      return send(`${base}/${encodeURIComponent(slug)}/draft${query(locale)}`, "PUT", { page, baseVersion });
    },
    async discardDraft(slug, locale) {
      await call(`${base}/${encodeURIComponent(slug)}/draft${query(locale)}`, { method: "DELETE" });
    },
    async publish(slug, baseVersion, locale) {
      return send(`${base}/${encodeURIComponent(slug)}/publish${query(locale)}`, "POST", { baseVersion });
    },
    async createPage(title, locale) {
      const { slug } = await call<{ slug: string }>(`${base}${query(locale)}`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      return slug;
    },
    async deletePage(slug) {
      await call(`${base}/${encodeURIComponent(slug)}`, { method: "DELETE" });
    },
  });

  return {
    // ---- PageActions (identical signatures to makeActions') -----------------
    ...pageActionsOver("/pages"),
    async renamePage(slug, newSlug) {
      return send<RenameResult>(`/pages/${encodeURIComponent(slug)}/rename`, "POST", { newSlug });
    },
    async duplicatePage(slug, locale) {
      const { slug: newSlug } = await call<{ slug: string }>(
        `/pages/${encodeURIComponent(slug)}/duplicate${query(locale)}`,
        { method: "POST" }
      );
      return newSlug;
    },
    async createTranslation(slug, toLocale) {
      await call(`/pages/${encodeURIComponent(slug)}/translations`, {
        method: "POST",
        body: JSON.stringify({ toLocale }),
      });
    },
    async deleteTranslation(slug, locale) {
      await call(`/pages/${encodeURIComponent(slug)}/translations/${encodeURIComponent(locale)}`, {
        method: "DELETE",
      });
    },

    // ---- collections --------------------------------------------------------
    async listCollectionRecords(sectionId, locale) {
      const { records } = await call<{ records: CollectionRecordInfo[] }>(
        `/collections/${encodeURIComponent(sectionId)}${query(locale)}`
      );
      return records;
    },
    collection(sectionId) {
      const base = `/collections/${encodeURIComponent(sectionId)}`;
      return {
        ...pageActionsOver(base),
        // ponytail: collection records aren't locale-switcher aware yet (see
        // CollectionRecordInfo's doc comment) and routes.ts deliberately has
        // no /translations routes for them. These throw rather than silently
        // no-op. Add the routes + real implementations if a host needs it.
        async createTranslation() {
          throw new Error("typren: collection translations are not supported over HTTP");
        },
        async deleteTranslation() {
          throw new Error("typren: collection translations are not supported over HTTP");
        },
        async getRecord(slug, locale) {
          return call(`${base}/${encodeURIComponent(slug)}${query(locale)}`);
        },
      };
    },

    // ---- reads + media + settings ------------------------------------------
    async listPages(locale) {
      const { pages } = await call<{ pages: PageInfo[] }>(`/pages${query(locale)}`);
      return pages;
    },
    async getPage(slug, locale) {
      return call(`/pages/${encodeURIComponent(slug)}${query(locale)}`);
    },
    async listMedia() {
      const { media } = await call<{ media: MediaAsset[] }>("/media");
      return media;
    },
    async deleteMedia(id) {
      await call(`/media/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async uploadMedia(file) {
      const form = new FormData();
      form.set("file", file);
      return call<MediaAsset>("/media", { method: "POST", body: form });
    },
    async getSettings(locale) {
      return call(`/settings${query(locale)}`);
    },
    async saveSettingsDraft(next, baseVersion, locale) {
      return send(`/settings/draft${query(locale)}`, "PUT", { settings: next, baseVersion });
    },
    async publishSettings(baseVersion, locale) {
      return send(`/settings/publish${query(locale)}`, "POST", { baseVersion });
    },
    async writeBootstrap(patch) {
      await call("/settings/bootstrap", { method: "PUT", body: JSON.stringify({ patch }) });
    },
  };
}

export { TyprenApiError };
