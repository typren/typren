import type { PageContent } from "./types";

/** Merge a locale-specific page over the default-locale base.
 *  - meta: field-level (a translation can override just title/description and
 *    inherit the rest).
 *  - slices: whole-array (positional cross-locale merge is a footgun); the
 *    locale file's slices replace the base's, or fall back when it has none.
 *  - body: falls back to the base when the locale file omits it.
 *  The store AND the host public read path both call THIS, so their fallback
 *  rules cannot drift. `null` loc = page-level fallback (serve base as-is).
 *  // ponytail: slices are whole-array per locale; per-slice/per-field merge
 *  // only if partial translation is demanded: key slices by an id and merge then. */
export function mergeLocalized(base: PageContent, loc: PageContent | null): PageContent {
  if (!loc) return base;
  return {
    meta: { ...base.meta, ...loc.meta },
    slices: loc.slices.length ? loc.slices : base.slices,
    body: loc.body || base.body,
  };
}

/** Path segment for a locale's content, matching the adapter's on-disk layout:
 *  the default locale lives FLAT at the content root ("", so a single-locale
 *  site needs no file moves), non-default locales under "<locale>/". Shared so
 *  the adapter and the host read path resolve the same file. */
export function localeSubdir(locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? "" : locale;
}
