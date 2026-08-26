import type { Messages } from "../i18n";

/** English editor-UI strings shipped by the package. Flat, dot-namespaced keys.
 *  `{var}` placeholders are filled by `useT(key, vars)`. A host overrides any
 *  subset via `CmsConfig.i18n.messages[uiLocale]`. */
export const defaultMessages: Messages = {
  // Left nav (pages-nav)
  "nav.brand": "@typren/core",
  "nav.pages": "Pages",
  "nav.newPage": "New page",
  "nav.pageName": "Page name",
  "nav.add": "Add",
  "nav.siteSettings": "Site settings",
  "nav.mediaLibrary": "Media library",
  "nav.deletePage": "Delete {slug}",
  "nav.confirmDelete": "Delete page “{slug}”? This cannot be undone.",
  "nav.selectToEdit": "Select a page to edit, or add a new one.",

  // Editor shell chrome
  "shell.publish": "Publish",
  "shell.discardDraft": "Discard draft",
  "shell.saveDraft": "Save draft",
  "shell.unsaved": "Unsaved changes",
  "shell.upToDate": "Up to date",
  "shell.draftSaved": "Draft saved",
  "shell.publishing": "Publishing…",
  "shell.publishFailed": "Publish failed: {error}",
  "shell.properties": "Properties",
  "shell.selectBlock": "Select a block to edit its fields.",
  "shell.toggleTheme": "Toggle editor theme",
  "shell.confirmDiscard": "Discard this draft and revert to the published version?",

  // Conflict banner
  "shell.conflict":
    "Someone else changed this page. Reload to get their version (you’ll lose your unsaved edits), or overwrite it with yours.",
  "shell.reload": "Reload",
  "shell.overwrite": "Overwrite",
  "shell.overwriting": "Overwriting…",

  // Locale switcher + translation
  "shell.locale": "Locale",
  "shell.translate": "Translate",
  "shell.translateTo": "Translate to {locale}",
  "shell.fallbackBanner":
    "Showing {defaultLocale} content, not yet translated. Edits start a {locale} translation.",

  // Site settings
  "site.title": "Site settings",
  "site.blurb": "Header nav, call-to-action and footer shown across the whole site.",
  "site.confirmDiscard": "Discard site-settings draft and revert to published?",

  // Media library
  "media.title": "Media library",
  "media.uploading": "Uploading…",
  "media.uploadFailed": "Upload failed: {error}",
  "media.confirmDelete": "Delete “{name}”? This cannot be undone.",

  // Settings section (SDUI shell — distinct from the legacy `site.*` keys above)
  "settings.title": "Settings",
  "settings.blurb": "Brand, SEO and theme — saved as a draft, live once published.",
  "settings.advanced": "Advanced",
  "settings.advancedBlurb":
    "Locale allowlist, routing mode and the admin route reparameterize what the next boot trusts — saving here writes immediately, but needs a redeploy to take effect.",
  "settings.saveAdvanced": "Save advanced settings",
  "settings.adminRouteChanged": "Admin route change pending — redeploy for it to take effect.",

  // Collections section
  "collection.new": "New {label}",
  "collection.create": "Create",
  "collection.cancel": "Cancel",
  "collection.back": "Back",
  "collection.save": "Save",
  "collection.confirmDiscard": "Discard unsaved changes?",
};
