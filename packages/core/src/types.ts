import type { ComponentType } from "react";
import type { AuthAdapter } from "./auth-adapter";
import type { GitRepo } from "./git";
import type { I18nConfig } from "./i18n";
import type { Section } from "./sections";
import type { SettingsAdapter } from "./settings";

/** A single content block. `slice` is the registry key; the rest are its props. */
export type Slice = { slice: string } & Record<string, unknown>;

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
export type LocalizedPage = PageContent & { locale: string; isFallback: boolean };

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
  type?:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "yaml"
    | "image" // media picker for a bare string or `{src, alt}` prop, alias of "media" kept for back-compat, identical control
    | "media" // same control as "image"; the name new schemas should reach for
    | "richtext" // multi-line formatted copy, a textarea today (no editor dependency added); distinct from "textarea" so a schema can say "this holds markdown" ahead of a future upgrade
    | "icon" // a name from the host's icon library: searchable picker, see FieldForm's `icons` prop (FieldFormIcons); the package never imports an icon library itself
    | "color" // a token choice rendered as a real swatch, not the word: reuses `options`; each token resolves through a host-defined `--typren-swatch-<token>` CSS custom property (the package can't know the host's palette any more than it can its icon library)
    | "link" // `{label, href, external?}` authored as one control (text + url + a "opens in new tab" toggle)
    | "slot"; // a repeatable list of typed sub-items, see `of`/`itemLabel` below; recursive (an item can itself declare an "icon"/"link"/"slot" field)
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
  id: string; // adapter-defined stable key (fs adapter: the path under the media dir)
  url: string; // public URL, e.g. "/img/foo-a1b2c3d4.webp"
  name: string; // display name (original upload filename, not the storage key)
  size: number; // bytes
  width?: number;
  height?: number;
  mime: string; // "image/webp" | "image/avif" | "image/svg+xml" | ...
  createdAt: string; // ISO 8601, for "newest first" sorting
  /** Folder the asset sits in, "/"-joined ("events/2025"); "" or absent at
   *  the root. Only adapters with folder support set it. */
  folder?: string;
};

/** One asset's public URL before and after a move or rename. */
export type MediaMove = { from: string; to: string };

/** Where one asset URL is referenced: a page (or "settings") in a locale,
 *  and how many times. */
export type MediaUse = { slug: string; locale: string; count: number };

/** A file that has already passed validation + web-optimization (see
 *  media.ts's processUpload) and is ready to persist. Adapters never see
 *  raw client uploads, only this. */
export type PreparedFile = {
  name: string; // slugified base name, already carrying the final extension
  mime: string; // final mime AFTER conversion
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
  move?(id: string, folder: string, name?: string): Promise<{ from: string; to: MediaAsset }>;
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
  writeRaw(slug: string, raw: string, locale?: string, opts?: { expectedVersion?: string }): Promise<void>;
  /** Delete the published source (and let the store also drop any draft). */
  deletePublished(slug: string, locale?: string): Promise<void>;
  /** Raw draft source, or null when no draft is checked out. */
  readDraftRaw(slug: string, locale?: string): Promise<string | null>;
  writeDraftRaw(slug: string, raw: string, locale?: string, opts?: { expectedVersion?: string }): Promise<void>;
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
  /** Route the editor iframes for live preview, e.g. "/studio/preview". */
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

export type { I18nConfig, Messages, RoutingMode } from "./i18n";
