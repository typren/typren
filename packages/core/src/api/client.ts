import type { PageActions, PageFlows, RenameResult, SaveResult } from "../actions";
import type { CollectionRecordInfo, MediaAsset, MediaUse, PageContent, PageInfo } from "../types";
import type { SiteSettings, SiteSettingsBootstrap, SiteSettingsRuntime } from "../settings";
import type { GitLogEntry, GitOutgoing, GitPendingChange } from "../git";
import type { FolderedLibrary, LibraryFolders, LibraryUpdateResult, PageTemplate, SavedSlice, TemplateUpdateResult } from "../library";

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
  getPage(slug: string, locale?: string): Promise<{ page: PageContent; version: string | null; hasDraft: boolean }>;
  // Not part of PageActions (see its doc comment): no shipped UI shell calls
  // these yet, so they're declared here directly rather than forcing every
  // host's hand-reconstructed PageActions literal to grow a stub.
  renamePage(slug: string, newSlug: string): Promise<RenameResult>;
  duplicatePage(slug: string, locale?: string): Promise<string>;
  /** Page folders kept without pages (see `ContentAdapter.createFolder`). */
  listPageFolders(locale?: string): Promise<string[]>;
  createPageFolder(folder: string, locale?: string): Promise<void>;
  deletePageFolder(folder: string, locale?: string): Promise<void>;
  listMedia(): Promise<MediaAsset[]>;
  /** Refused (422) while content uses the asset, unless `opts.force`. */
  deleteMedia(id: string, opts?: { force?: boolean }): Promise<void>;
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

  /** `move` and `folders` under `root` ("/library" or "/library/templates"). */
  function libraryFolders<R>(root: string): { move: (id: string, folder: string, baseSavedAt?: string) => Promise<R>; folders: LibraryFolders } {
    const post = (path: string, payload: unknown) => call(`${root}${path}`, { method: "POST", body: JSON.stringify(payload) });
    return {
      move: (id, folder, baseSavedAt) =>
        call<R>(`${root}/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ folder, baseSavedAt }) }),
      folders: {
        list: () => call<{ folders: string[] }>(`${root}/folders`).then((r) => r.folders),
        async create(folder) {
          await post("/folders", { folder });
        },
        async rename(folder, to) {
          await post("/folders/rename", { folder, to });
        },
        async delete(folder) {
          await call(`${root}/folders?folder=${encodeURIComponent(folder)}`, { method: "DELETE" });
        },
      },
    };
  }

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
    async createPage(title, locale, opts) {
      const { slug } = await call<{ slug: string }>(`${base}${query(locale)}`, {
        method: "POST",
        body: JSON.stringify({ title, ...opts }),
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
    async listPageFolders(locale) {
      return (await call<{ folders: string[] }>(`/folders${query(locale)}`)).folders;
    },
    async createPageFolder(folder, locale) {
      await send(`/folders${query(locale)}`, "POST", { path: folder });
    },
    async deletePageFolder(folder, locale) {
      // `call` hands a 409 back as a body, not a throw; a refused delete is an error here.
      const r = await call<{ ok?: boolean; error?: string }>(`/folders/${encodeURIComponent(folder)}${query(locale)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new TyprenApiError(r.error ?? "409 Conflict", 409);
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

    // ---- flows (one implementation in makeActions, shared with the CLI) ----
    async createPageFrom(title, slug, slices, locale) {
      const r = await call<{ slug: string }>(`/pages${query(locale)}`, { method: "POST", body: JSON.stringify({ title, slug, slices }) });
      return r.slug;
    },
    insertSection(slug, slice, at, baseVersion, locale) {
      return send(`/pages/${encodeURIComponent(slug)}/sections${query(locale)}`, "POST", { slice, at, baseVersion });
    },
    updatePageMeta(slug, patch, baseVersion, locale) {
      return send(`/pages/${encodeURIComponent(slug)}/meta${query(locale)}`, "PUT", { patch, baseVersion });
    },
    commitPage(slug, page, baseVersion, locale) {
      return send(`/pages/${encodeURIComponent(slug)}/commit${query(locale)}`, "POST", { page, baseVersion });
    },
    async publishAll(locale) {
      return (await call<{ slugs: string[] }>(`/pages/publish-all${query(locale)}`, { method: "POST" })).slugs;
    },

    // ---- git (local studio) -------------------------------------------------
    gitOutgoing: () => call<GitOutgoing>("/git"),
    async gitPush(paths, slugs, settings) {
      await call("/git/push", { method: "POST", ...((paths || slugs || settings) && { body: JSON.stringify({ paths, slugs, settings }) }) });
    },
    gitPending: () => call<GitPendingChange[]>("/git/pending"),
    gitHistory: (slug, locale) =>
      call<GitLogEntry[]>(`/git/history?${new URLSearchParams({ slug, ...(locale && { locale }) })}`),
    async gitDiscard(paths) {
      await call("/git/discard", { method: "POST", body: JSON.stringify({ paths }) });
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
    async deleteMedia(id, opts) {
      await call(`/media/${id.split("/").map(encodeURIComponent).join("/")}${opts?.force ? "?force=1" : ""}`, { method: "DELETE" });
    },
    async uploadMedia(file, folder) {
      const form = new FormData();
      form.set("file", file);
      if (folder) form.set("folder", folder);
      return call<MediaAsset>("/media", { method: "POST", body: form });
    },
    async listMediaFolders() {
      const { folders } = await call<{ folders: string[] }>("/media/folders");
      return folders;
    },
    async createMediaFolder(folder) {
      await send("/media/folders", "POST", { folder });
    },
    async deleteMediaFolder(folder) {
      await call(`/media/folders?folder=${encodeURIComponent(folder)}`, { method: "DELETE" });
    },
    async moveMedia(id, folder, name) {
      return send<MediaAsset>("/media/move", "POST", { id, folder, name });
    },
    async renameMediaFolder(folder, to) {
      await send("/media/folders/rename", "POST", { folder, to });
    },
    async mediaUsage() {
      const { usage } = await call<{ usage: Record<string, MediaUse[]> }>("/media/usage");
      return usage;
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
    async discardSettingsDraft(locale) {
      await call(`/settings/draft${query(locale)}`, { method: "DELETE" });
    },
    settingsHistory: (locale) => call<GitLogEntry[]>(`/settings/history${query(locale)}`),
    async writeBootstrap(patch) {
      await call("/settings/bootstrap", { method: "PUT", body: JSON.stringify({ patch }) });
    },
    library: {
      ...libraryFolders<LibraryUpdateResult>("/library"),
      list: () => call<{ saved: SavedSlice[] }>("/library").then((r) => r.saved),
      save: (name, slice) => call<SavedSlice>("/library", { method: "POST", body: JSON.stringify({ name, slice }) }),
      update: (id, slice, baseSavedAt, name) =>
        call<LibraryUpdateResult>(`/library/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ slice, baseSavedAt, name }) }),
      async remove(id) {
        await call(`/library/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
      templates: {
        ...libraryFolders<TemplateUpdateResult>("/library/templates"),
        list: () => call<{ templates: PageTemplate[] }>("/library/templates").then((r) => r.templates),
        save: (name, slices) =>
          call<PageTemplate>("/library/templates", { method: "POST", body: JSON.stringify({ name, slices }) }),
        update: (id, slices, baseSavedAt, name) =>
          call<TemplateUpdateResult>(`/library/templates/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ slices, baseSavedAt, name }),
          }),
        async remove(id) {
          await call(`/library/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
        },
      },
    },
  };
}

export { TyprenApiError };
