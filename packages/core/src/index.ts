// Server-safe core. Client editor UI lives in the separate @typren/editor package.
export type {
  Slice,
  PageContent,
  LocalizedPage,
  PageInfo,
  CollectionRecordInfo,
  ContentAdapter,
  CmsConfig,
  FieldDef,
  SliceSchema,
  MediaAsset,
  MediaAdapter,
  PreparedFile,
} from "./types";
// Locale/routing helpers (pure, also re-exported from the edge-safe "./i18n"
// subpath for middleware/proxy, which must not pull in node:fs).
export {
  resolveI18n,
  localizedPath,
  localizedHref,
  routeLocale,
  defaultIsUnprefixed,
  type I18nConfig,
  type Messages,
  type RoutingMode,
  type LocaleRoute,
} from "./i18n";
export { mergeLocalized, localeSubdir } from "./localize";
export { createMarkdownAdapter, type MarkdownAdapterOptions } from "./markdown-adapter";
export {
  createNotionAdapter,
  createFetchNotionClient,
  type NotionAdapterOptions,
  type NotionClient,
  type NotionPage,
  type NotionPropertyMap,
  type NotionPropertyType,
} from "./notion-adapter";
export {
  blocksToMarkdown,
  blocksToSegments,
  pageRecordFrom,
  richTextToMarkdown,
  type NotionBlock,
  type NotionSegment,
  type ProseSegment,
  type ComponentSegment,
} from "./notion-blocks";
export { createFsMediaAdapter, type FsMediaAdapterOptions } from "./fs-media-adapter";
export { processUpload, handleMediaUpload, MAX_UPLOAD_BYTES } from "./media";
export { createStore, type ContentStore } from "./store";
export { makeActions, type CmsActions, type PageActions, type SaveResult } from "./actions";
export {
  resolveAuth,
  legacyAuthAdapter,
  type AuthAdapter,
  type AuthAction,
  type AuthContext,
  type AuthUser,
} from "./auth-adapter";
export { versionOf, ConflictError } from "./version";
// SDUI admin shell: server-safe helpers (node:fs-backed) + their contracts.
// The client UI (built fresh in React + Base UI) lives in @typren/editor.
export {
  resolveSections,
  DEFAULT_SECTIONS,
  SECTION_API_VERSION,
  type Section,
  type SectionKind,
  type SectionCtx,
  type ResolvedSection,
  type PagesSection,
  type MediaSection,
  type SettingsSection,
  type CollectionSection,
  type CustomSection,
  type FieldFormMedia,
} from "./sections";
export {
  createSettingsStore,
  createFsSettingsAdapter,
  type SiteSettings,
  type SiteSettingsRuntime,
  type SiteSettingsBootstrap,
  type SettingsAdapter,
  type SettingsStore,
} from "./settings";
export { makeCollectionActions, makeCollectionAdapter, buildCollectionActions, listCollectionRecords } from "./collection";
