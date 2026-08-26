import type { ReactNode } from "react";
import type {
  PageActions,
  SliceSchema,
  Section,
  SaveResult,
  SiteSettingsBootstrap,
  SiteSettingsRuntime,
} from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import type { FieldFormIcons } from "./icon-picker-field";

/** Client-safe subset of core's `SettingsStore` the Settings section needs to
 *  write: `saveDraft`/`publish` are already RPC-shaped (`Promise<SaveResult>`,
 *  same optimistic-lock contract as `PageActions`). `writeBootstrap` is typed
 *  `Promise<void>` here even though `SettingsAdapter.writeBootstrap` itself is
 *  a plain synchronous fs write — the host is expected to wire it through an
 *  auth-gated RPC (a "use server" action calling `authorize({action:"admin"})`
 *  first, or the HTTP client's `writeBootstrap`), since this package has no
 *  way to enforce that boundary itself, only to document the requirement (see
 *  `createSettingsStore`'s `guardAdmin`). `get()`/`currentVersion()` aren't
 *  part of this: they're synchronous server reads, so the host pre-fetches
 *  them and passes the result as data (`TyprenEditorProps.settingsSnapshot`),
 *  the same pattern `page`/`initialVersion` already use for Pages. */
export type TyprenEditorSettingsActions = {
  saveDraft: (next: SiteSettingsRuntime, baseVersion?: string, locale?: string) => Promise<SaveResult>;
  publish: (baseVersion?: string, locale?: string) => Promise<SaveResult>;
  writeBootstrap: (patch: Partial<SiteSettingsBootstrap>) => Promise<void>;
};

/**
 * Everything host-specific the editor needs, in one injected object: the
 * seam that lets `apps/studio` and a future hosted console mount the exact
 * same `@typren/editor` without drifting. Nothing in this package reaches
 * outside of `host` for a host-owned concern (auth, storage, the slice
 * registry).
 *
 * v1 scope was the Pages editing loop only; `sections`/`collections`/
 * `settings` below grow it into the SDUI admin shell core's `sections.ts`
 * anticipates (`resolveSections`/`SectionCtx`) — additive, so a host that
 * never sets `sections` keeps today's Pages-only picker/shell byte-identical.
 * `media`/`icons` already degrade gracefully when omitted (see FieldForm), so
 * a host with no media library or icon set configured needs nothing extra
 * here.
 */
export interface TyprenEditorHost {
  /** Auth-gated page CRUD/draft/publish handlers: bind these to Server
   *  Actions (or an equivalent RPC) on the host; see `makeActions()`. */
  actions: PageActions;
  /** Slice registry keys, for BlockList's "+ Add block" menu. The host
   *  renders the actual components in its own preview route. */
  sliceNames: string[];
  /** Starter props inserted when a slice is added, keyed by slice name. */
  defaults: Record<string, Record<string, unknown>>;
  /** Optional per-slice field hints (dropdowns for enum props, etc.). */
  fieldSchema?: Record<string, SliceSchema>;
  /** Route the editor iframes for live preview, e.g. "/editor/preview". */
  previewPath: string;
  /** Wires FieldForm's "image"/"media" control to a media library, and the
   *  Media section's grid/upload/delete when `sections` includes a "media"
   *  entry. Omit to degrade image fields to a plain text input and hide the
   *  Media section's content (see `MediaSection`). */
  media?: FieldFormMedia;
  /** Wires FieldForm's "icon" control to an icon picker. Omit to degrade to
   *  a plain text input (no icon library wired). */
  icons?: FieldFormIcons;
  /** Host-injected chrome (account switcher, marketplace link, agent-panel
   *  trigger, …), rendered at the right of the shell's header. The only
   *  extension seam this package has — no plugin framework, the host renders
   *  whatever it wants and @typren/editor just gives it a mount point. Only
   *  shown while a page is open (the picker screen has no header yet). */
  topBarSlot?: ReactNode;
  /** SDUI section config — core's `resolveSections()`-compatible list (Pages/
   *  Media/Settings/Collection/Custom). Omit → the v1 Pages-only picker/shell
   *  (byte-identical to a host that predates this field). A non-empty list
   *  switches `TyprenEditor` to the section-switcher shell (`SectionShell`):
   *  a left rail plus whichever section `TyprenEditorProps.sectionId` names.
   *  "custom" sections aren't rendered by this package (no plugin runtime
   *  here — see `docs/hosted-platform.md`'s "custom sections ship code"); a
   *  host that declares one is responsible for its own routing around it. */
  sections?: Section[];
  /** Per-collection-section write actions, keyed by section id — core's
   *  `buildCollectionActions(config)` output passes straight through. Only
   *  needed when `sections` includes a "collection" entry; a collection
   *  section with no matching entry here renders read-only (create/delete
   *  disabled) rather than throwing. */
  collections?: Record<string, PageActions>;
  /** Settings section write actions. Omit to hide the Settings section's
   *  content even when `sections` configures one (degrades like `media`). */
  settings?: TyprenEditorSettingsActions;
}
