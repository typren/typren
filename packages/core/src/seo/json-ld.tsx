import type { SeoConfig } from "./types";

/**
 * Renders a JSON-LD <script> tag. Escapes `<` so a `</script>` (or any other
 * tag) can never appear literally inside the payload and break out of the
 * script context. This is the standard mitigation for embedding untrusted-shaped
 * JSON in HTML (OWASP "JSON in HTML" guidance).
 */
export function JsonLd({ data }: Readonly<{ data: object }>) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export function organizationJsonLd(config: SeoConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: config.siteName,
    ...(config.organization?.alternateName ? { alternateName: config.organization.alternateName } : {}),
    url: config.siteUrl,
    ...(config.organization?.logo ? { logo: config.organization.logo } : {}),
    description: config.entityDescription,
    ...(config.organization?.parentOrganization
      ? { parentOrganization: { "@type": "Organization", name: config.organization.parentOrganization } }
      : {}),
    ...(config.organization?.sameAs?.length ? { sameAs: config.organization.sameAs } : {}),
  };
}

export function websiteJsonLd(config: SeoConfig) {
  return { "@context": "https://schema.org", "@type": "WebSite", name: config.siteName, url: config.siteUrl };
}

/** items: ordered list, position is 1-based index + 1. First item is
 *  conventionally the site's Home page. Pass `path: ""` for it so its
 *  `item` URL is the bare site root, not `${siteUrl}/`. */
export function breadcrumbJsonLd(config: SeoConfig, items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${config.siteUrl}${item.path}`,
    })),
  };
}
