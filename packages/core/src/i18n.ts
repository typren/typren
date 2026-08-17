// Pure locale/routing logic. NO node imports (fs, path, next/server) — this
// module is safe to import from the edge (proxy.ts) and the host's edge-safe
// locale constants. Everything content-storage-related lives in the adapter.

/** Flat, dot-namespaced editor-UI strings. */
export type Messages = Record<string, string>;

/** How locales map onto URLs. A consumer picks one preset on onboarding.
 *  - `prefix-except-default`: default locale is UNPREFIXED (`/about`), others
 *    are prefixed (`/es/about`). Preserves existing single-locale URLs/SEO.
 *  - `prefix-all`: every locale is prefixed (`/en/about`, `/es/about`). */
export type RoutingMode = "prefix-except-default" | "prefix-all";

/** The one i18n block on CmsConfig. `messages` are per-UI-locale overrides
 *  deep-merged onto the package's English defaults (see ui/messages.ts). */
export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  routing: RoutingMode;
  messages?: Record<string, Partial<Messages>>;
}

/** Validate + fill defaults. A missing/empty i18n block collapses to a single
 *  implicit locale so single-locale consumers ship byte-identical behavior.
 *  Throws early if `defaultLocale` isn't in `locales` (misconfig, fail loud). */
export function resolveI18n(i18n?: Partial<I18nConfig>): I18nConfig {
  const defaultLocale = i18n?.defaultLocale ?? "en";
  const locales = i18n?.locales?.length ? i18n.locales : [defaultLocale];
  if (!locales.includes(defaultLocale))
    throw new Error(`typren: defaultLocale "${defaultLocale}" not in locales [${locales.join(", ")}]`);
  return { locales, defaultLocale, routing: i18n?.routing ?? "prefix-except-default", messages: i18n?.messages };
}

/** True when the default locale carries no URL prefix (its files live flat at
 *  the content-dir root and its public URLs are bare). */
export const defaultIsUnprefixed = (i18n: I18nConfig) => i18n.routing === "prefix-except-default";

/** Public path for a leading-slash path under a locale + routing preset.
 *  `/about` → `/es/about` (es) or `/about` (en, prefix-except-default). */
export function localizedPath(i18n: I18nConfig, path: string, locale: string): string {
  const raw = path || "/";
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  if (defaultIsUnprefixed(i18n) && locale === i18n.defaultLocale) return p;
  return p === "/" ? `/${locale}` : `/${locale}${p}`;
}

/** Like localizedPath but leaves external/anchor/mailto hrefs untouched. */
export function localizedHref(i18n: I18nConfig, href: string, locale: string): string {
  // Only internal, leading-slash paths get localized; external / #anchor /
  // mailto: / tel: pass through unchanged.
  if (href.startsWith("/")) return localizedPath(i18n, href, locale);
  return href;
}

export type LocaleRoute =
  | { type: "next" }
  | { type: "redirect"; pathname: string }
  | { type: "rewrite"; pathname: string };

/** Decide how the proxy should route a pathname under the preset. Pure, so the
 *  edge proxy just maps the verdict onto a NextResponse. Never rewrites to a
 *  route that can't exist for the preset. */
export function routeLocale(i18n: I18nConfig, pathname: string): LocaleRoute {
  const seg = pathname.split("/")[1] ?? "";
  if (defaultIsUnprefixed(i18n)) {
    // Kill duplicate content: the default locale is served unprefixed, so an
    // explicit `/en/x` canonicalizes to `/x`.
    if (seg === i18n.defaultLocale) {
      const stripped = pathname.slice(`/${i18n.defaultLocale}`.length) || "/";
      return { type: "redirect", pathname: stripped };
    }
    // Known non-default locale prefix → the [locale] route serves it as-is.
    // Anything else is a bare default-locale path → serve as-is.
    return { type: "next" };
  }
  // prefix-all: bare paths get rewritten under the default locale prefix.
  if (i18n.locales.includes(seg)) return { type: "next" };
  return { type: "rewrite", pathname: `/${i18n.defaultLocale}${pathname === "/" ? "" : pathname}` };
}
