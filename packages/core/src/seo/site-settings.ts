import type { SettingsStore, SiteSettingsRuntime } from "../settings";
import type { SeoConfig } from "./types";

/** Overlays the saved Site Settings onto a code `SeoConfig`, field by field.
 *  A non-empty saved value wins; the code value is the fallback, so a site
 *  with no settings doc (or blank fields) renders exactly as it did before.
 *  Pure: no I/O. Mapping: brand.name -> siteName, brand.logo ->
 *  organization.logo (Organization JSON-LD), seo.titleTemplate ->
 *  titleTemplate, seo.description -> defaultDescription, seo.ogImage ->
 *  defaultOgImage. `brand.logoDark` has no SEO surface and is not read. */
export function withSiteSettings(config: SeoConfig, settings: Partial<SiteSettingsRuntime> | undefined): SeoConfig {
  const name = settings?.brand?.name?.trim();
  const logo = settings?.brand?.logo?.url;
  const titleTemplate = settings?.seo?.titleTemplate?.trim();
  const description = settings?.seo?.description?.trim();
  const ogImage = settings?.seo?.ogImage?.url;
  return {
    ...config,
    ...(name ? { siteName: name } : {}),
    ...(titleTemplate ? { titleTemplate } : {}),
    ...(description ? { defaultDescription: description } : {}),
    ...(ogImage ? { defaultOgImage: ogImage } : {}),
    ...(logo ? { organization: { ...config.organization, logo } } : {}),
  };
}

/** Reads the published settings and overlays them (see `withSiteSettings`).
 *  Call once per request in `generateMetadata`, the root layout, sitemap and
 *  robots; the store read is cheap and the result is never cached here. */
export async function resolveSeoConfig(
  config: SeoConfig,
  settings: Pick<SettingsStore, "get">,
  locale?: string
): Promise<SeoConfig> {
  return withSiteSettings(config, await settings.get(locale));
}
