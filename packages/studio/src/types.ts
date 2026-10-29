import type { ReactNode } from "react";
import type {
  GitOutgoing,
  GitPendingChange,
  GitLogEntry,
  PageActions,
  PageContent,
  PageFlows,
  RenameResult,
  SliceSchema,
  Section,
  SaveResult,
  StyleMap,
  SiteSettingsBootstrap,
  SiteSettingsRuntime,
  SliceLibrary,
} from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import type { FieldFormIcons } from "./icon-picker-field";

/** Client-safe subset of core's `SettingsStore` the Settings section needs to
 *  write: `saveDraft`/`publish` are already RPC-shaped (`Promise<SaveResult>`,
 *  same optimistic-lock contract as `PageActions`). `writeBootstrap` is typed
 *  `Promise<void>` here even though `SettingsAdapter.writeBootstrap` itself is
 *  a plain synchronous fs write, the host is expected to wire it through an
 *  auth-gated RPC (a "use server" action calling `authorize({action:"admin"})`
 *  first, or the HTTP client's `writeBootstrap`), since this package has no
 *  way to enforce that boundary itself, only to document the requirement (see
 *  `createSettingsStore`'s `guardAdmin`). `get()`/`currentVersion()` aren't
 *  part of this: they're synchronous server reads, so the host pre-fetches
 *  them and passes the result as data (`TyprenStudioProps.settingsSnapshot`),
 *  the same pattern `page`/`initialVersion` already use for Pages. */
export type TyprenStudioSettingsActions = {
  saveDraft: (next: SiteSettingsRuntime, baseVersion?: string, locale?: string) => Promise<SaveResult>;
  publish: (baseVersion?: string, locale?: string) => Promise<SaveResult>;
  /** Drops the settings draft. Omit and Review can't discard it. */
  discardDraft?: (locale?: string) => Promise<void>;
  /** Whether the settings doc has a draft now, for Review's list; without
   *  it Review goes by what this studio saved. */
  hasDraft?: (locale?: string) => Promise<boolean>;
  /** The settings doc's commits, newest first, for the save status. */
  history?: (locale?: string) => Promise<GitLogEntry[]>;
  /** Omit and the Advanced bootstrap fields are hidden (a site with no
   *  `typren.config.json` has nowhere to write them). */
  writeBootstrap?: (patch: Partial<SiteSettingsBootstrap>) => Promise<void>;
  /** Hides the admin-route field (and skips its validation) for hosts where
   *  there is no admin route, such as the local studio. */
  hideAdminRoute?: boolean;
};

/**
 * Everything host-specific the studio needs, in one injected object: the
 * seam that lets `apps/studio` and a future hosted console mount the exact
 * same `@typren/studio` without drifting. Nothing in this package reaches
 * outside of `host` for a host-owned concern (auth, storage, the slice
 * registry).
 *
 * `media`/`icons` degrade gracefully when omitted (see FieldForm), so a host
 * with no media library or icon set configured needs nothing extra here.
 */
export interface TyprenStudioHost {
  /** Auth-gated page CRUD/draft/publish handlers and the studio's page
   *  flows (the HTTP client has them all): bind these to Server Actions (or
   *  an equivalent RPC) on the host; see `makeActions()`. */
  actions: PageActions & PageFlows;
  /** Slice registry keys, for BlockList's "+ Add block" menu. The host
   *  renders the actual components in its own preview route. */
  sliceNames: string[];
  /** Starter props inserted when a slice is added, keyed by slice name. */
  defaults: Record<string, Record<string, unknown>>;
  /** Optional per-slice field hints (dropdowns for enum props, etc.). */
  fieldSchema?: Record<string, SliceSchema>;
  /** Route the studio iframes for live preview, e.g. "/studio/preview".
   *  The frame loads `${previewPath}/${slug}` unless `previewUrl` is set. */
  previewPath: string;
  /** Preview URL for a page, overriding `previewPath`. May be absolute and
   *  cross-origin (the studio frames the site's own dev server), and should
   *  follow the site's routing rules, e.g. a trailing slash: sandboxed
   *  frames do not reliably follow the redirect otherwise. */
  previewUrl?: (slug: string) => string;
  /** Reads a page's content for the universal search. Omit and search
   *  matches page titles only. */
  readPage?: (slug: string) => Promise<PageContent>;
  /** A page's content with its optimistic-lock version (the HTTP client's
   *  `getPage`). Sections inserts against that version, so a change made
   *  meanwhile is a conflict instead of being overwritten. */
  getPage?: (slug: string) => Promise<{ page: PageContent; version: string | null; hasDraft?: boolean }>;
  /** Slug of the home page, shown with a house icon and as "/" in the page
   *  pill. Default "home". */
  homeSlug?: string;
  /** Wires FieldForm's "image"/"media" control to a media library, and the
   *  Media section's grid/upload/delete when `sections` includes a "media"
   *  entry. Omit to degrade image fields to a plain text input and hide the
   *  Media section's content (see `MediaSection`). */
  media?: FieldFormMedia;
  /** Keeps and removes page folders that hold no page yet (bind to
   *  `createPageFolder`/`deletePageFolder`). Omit and the new-page wizard
   *  offers no "Folder only". */
  pageFolders?: { create(folder: string): Promise<void>; delete(folder: string): Promise<void> };
  /** Renames (moves) a page, its drafts and translations included (bind to
   *  `renamePage`). Omit and the page settings popover shows the slug
   *  read-only. */
  renamePage?: (slug: string, newSlug: string) => Promise<RenameResult>;
  /** Wires FieldForm's "icon" control to an icon picker. Omit to degrade to
   *  a plain text input (no icon library wired). */
  icons?: FieldFormIcons;
  /** Host-injected chrome (account switcher, marketplace link, agent-panel
   *  trigger, …), rendered at the right of the top bar. The only extension
   *  seam this package has, no plugin framework: the host renders whatever it
   *  wants and @typren/studio just gives it a mount point. */
  topBarSlot?: ReactNode;
  /** Rail entries, core's `resolveSections()`-compatible list, grouped at
   *  rail level 0 in config order. Pages always sits in the Website group.
   *  Omit for Website → Pages only. "custom" sections aren't rendered by
   *  this package (no plugin runtime here, see `docs/hosted-platform.md`'s
   *  "custom sections ship code"); the host renders those itself. */
  sections?: Section[];
  /** Per-collection-section write actions, keyed by section id, core's
   *  `buildCollectionActions(config)` output passes straight through. Only
   *  needed when `sections` includes a "collection" entry; a collection
   *  section with no matching entry here renders read-only (create/delete
   *  disabled) rather than throwing. */
  collections?: Record<string, PageActions>;
  /** Settings section write actions. Omit to hide the Settings section's
   *  content even when `sections` configures one (degrades like `media`). */
  settings?: TyprenStudioSettingsActions;
  /** Which of the site's own custom properties each Style token drives (the
   *  site's `studio.style` in `typren.config.json`). Omit for core's shadcn
   *  default, `STYLE_MAP_DEFAULT`. */
  styleMap?: StyleMap;
  /** The Sections library: the page editor's "Save to Sections" writes to
   *  it and a "library" section browses it (core's `createSliceLibrary`, or
   *  the HTTP client's `library`). Omit to disable both. */
  library?: SliceLibrary;
  /** The site's section route, which renders the one slice whose props
   *  arrive as JSON in `?slice=` (preview mode only, through a SliceZone so
   *  the preview bridge reports its box). Sections then shows real renders;
   *  omit, or a site without the route, and it shows schematic cards. */
  sectionPreviewUrl?: string;
  /** Page paths (`/` plus the slug) whose route adds its own layout, by
   *  prefix: those pages preview on their real route, with its reloads,
   *  instead of the persistent page canvas on `sectionPreviewUrl`, which
   *  renders slices under the root layout only. */
  nestedLayouts?: string[];
  /** Set by a host whose content lives in a local git checkout (the local
   *  studio, whose `actions.publish` commits the page). Edits autosave to
   *  the page's draft as on any host, and Publish becomes Review: a panel
   *  listing pages with a draft and `pending()` files, which pushes the ones
   *  picked (`push(paths, slugs)`, one commit per page) or discards them
   *  (`discard(paths)`, or the page's draft), throwing a plain-language
   *  reason on failure. `outgoing()` tells a missing branch or upstream;
   *  `history(slug)` is the page's version history, newest first. Omit for
   *  the Publish lifecycle. */
  git?: {
    outgoing(): Promise<GitOutgoing>;
    pending(): Promise<GitPendingChange[]>;
    /** `settings` pushes the settings doc's draft too, as its own commit. */
    push(paths: string[], slugs?: string[], settings?: boolean): Promise<void>;
    discard(paths: string[]): Promise<void>;
    history?(slug: string, locale?: string): Promise<GitLogEntry[]>;
  };
}
