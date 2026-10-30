// Server-safe core. Client editor UI lives in the separate @typren/studio package.
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
  MediaMove,
  MediaUse,
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
  STYLE_MAP_DEFAULT,
  STYLE_TOKENS,
  mappedName,
  sanitizeStyle,
  styleCss,
  styleMapError,
  styleVars,
  type StyleMap,
  type StyleToken,
  type StyleTokenGroup,
  type StyleTokenKind,
} from "./style";
export { GitError, GIT_NO_BRANCH } from "./git-error";
export { commitOrRestore, createGitRepo, explainGitError, type GitRepo, type GitCommit, type GitOutgoing, type GitPendingChange, type GitPushResult, type GitLogEntry } from "./git";
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
export { createLocalSiteConfig, rewriteSiteFiles, type LocalSite } from "./local-site";
export {
  loadStudio,
  loadStudioProps,
  previewBase,
  sectionRouteUrl,
  siteTrailingSlash,
  studioSiteConfig,
  type StudioData,
  type StudioManifest,
  type StudioProps,
  type StudioSiteProps,
} from "./studio-site";
export { createGithubAdapter, isAllowedRepoPath, type GithubAdapterOptions } from "./github-adapter";
export { processUpload, handleMediaUpload, MAX_UPLOAD_BYTES } from "./media";
export { createStore, slugify, type ContentStore } from "./store";
export { SITE_SLUG, assertSafeNav, linksTo, navHrefError, readMenu, unlink, type NavItem } from "./nav";
export { nameError, slugError, libraryFolderError, BUILT_IN_FOLDER } from "./names";
export {
  findMediaRefs,
  makeActions,
  mediaRefSwapper,
  rewriteMediaRefs,
  ActionRefusedError,
  type CmsActions,
  type OpenedPage,
  type PageActions,
  type PageFlows,
  type PageMetaPatch,
  type RenameResult,
  type SaveResult,
  type UploadResult,
} from "./actions";
export {
  resolveAuth,
  legacyAuthAdapter,
  withPolicy,
  type AuthAdapter,
  type AuthAction,
  type AuthContext,
  type AuthUser,
  type Policy,
} from "./auth-adapter";
export { filePolicy, type AccessPolicyFile } from "./file-policy";
export { versionOf, ConflictError } from "./version";
export {
  serializeFieldSchema,
  parseFieldSchema,
  isFieldSchema,
  type SerializedFieldSchema,
} from "./field-schema";
// SDUI admin shell: server-safe helpers (node:fs-backed) + their contracts.
// The client UI (built fresh in React + Base UI) lives in @typren/studio.
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
  type LibrarySection,
  type FieldFormMedia,
} from "./sections";
export {
  createSettingsStore,
  createFsSettingsAdapter,
  validateBootstrap,
  BOOTSTRAP_KEYS,
  type SiteSettings,
  type SiteSettingsRuntime,
  type SiteSettingsBootstrap,
  type SettingsAdapter,
  type SettingsStore,
} from "./settings";
export {
  createSliceLibrary,
  type FolderedLibrary,
  type LibraryFolders,
  type LibraryUpdateResult,
  type PageTemplate,
  type PageTemplateLibrary,
  type SavedSlice,
  type SliceLibrary,
  type TemplateUpdateResult,
} from "./library";
export { makeCollectionActions, makeCollectionAdapter, buildCollectionActions, listCollectionRecords } from "./collection";
export { buildRedirects, type RedirectEntry, type BuildRedirectsOptions, type PageRedirectMeta } from "./redirects";
export {
  scanContentStore,
  loadRedirectMap,
  mergeRedirectEntries,
  toRedirectPairs,
  type RedirectMapEntry,
  type ToRedirectPairsOptions,
} from "./redirect-sources";
export {
  resolveStaticHostRequest,
  isUnsafeRedirectTarget,
  STATIC_HOST_PASSTHROUGH,
  REDIRECT_STATUSES,
  type StaticHostDecision,
  type RedirectLookup,
  type RedirectStatus,
} from "./static-host";
