---
title: SEO and AIO
description: Metadata, structured data, sitemap, robots, and the AI-crawler surfaces Typren ships.
category: Guides
order: 21
---

Everything in this guide lives under the `@typren/core/seo` subpath, kept
separate from the main entry so a non-Next consumer of `@typren/core` isn't
forced to pull in `next/server` or Next's `Metadata` types.

## Site Settings and `SeoConfig`

Site Settings (brand name, logo, SEO title template, description, social
image) are saved in the settings doc, editable in the studio and in the
studio. The SEO layer applies them through one pure function, so a saved value
changes what the site renders:

```ts
import { resolveSeoConfig } from "@typren/core/seo";

const seo = await resolveSeoConfig(codeSeoConfig, settingsStore, locale);
// then pass `seo` to buildRootMetadata, buildMetadata, organizationJsonLd, ...
```

`withSiteSettings(config, settings)` is the same merge without the read, for
when you already hold the settings. It merges field by field; a saved value
that is non-empty wins, and the code value is the fallback:

| Settings field      | `SeoConfig` field it overrides | Surfaces                                                      |
| ------------------- | ------------------------------ | ------------------------------------------------------------- |
| `brand.name`        | `siteName`                     | OpenGraph `siteName`, Organization and WebSite JSON-LD `name` |
| `seo.titleTemplate` | `titleTemplate`                | root `<title>` template                                       |
| `seo.description`   | `defaultDescription`           | root description, OpenGraph and Twitter                       |
| `seo.ogImage`       | `defaultOgImage`               | root OpenGraph image                                          |
| `brand.logo`        | `organization.logo`            | Organization JSON-LD `logo`                                   |

`brand.logoDark` is for dark admin surfaces and has no SEO surface. The
`SeoConfig` fields settings do not carry (`siteUrl`, `entityDescription`,
`defaultTitle`, `bareTitleSlugs`, `sameAs`, and so on) stay code-only. Because
the read is async and the builders are synchronous, resolve the config once
per request and pass the result in; a site that never calls
`resolveSeoConfig` keeps rendering from its code config alone. `typren init`
scaffolds a `seo.ts` that does this.

## Page metadata

```ts
import { buildRootMetadata, buildMetadata } from "@typren/core/seo";
```

`buildRootMetadata(config)` returns the root-layout `Metadata` defaults
(title template, OpenGraph, Twitter card) from a `SeoConfig`. `buildMetadata`
builds the per-page `Metadata` for a slug-routed page, reading
SEO fields directly off `PageContent.meta` (`title`, `description`,
`keywords`, `noindex`, `canonical`, `ogImage`) — there is no separate SEO
frontmatter file.

```ts
// app/[slug]/page.tsx
export async function generateMetadata({ params }, parent: ResolvingMetadata) {
  const { slug } = await params;
  const page = await store.getPublished(slug);
  return buildMetadata(page, slug, seoConfig, parent);
}
```

Pass `i18n` and the current `locale` to add `alternates.languages` hreflang
entries plus an `x-default` pointing at the default locale; with one locale
(or both omitted) the output is byte-identical to the non-i18n build.

## Structured data (JSON-LD)

```ts
import { JsonLd, organizationJsonLd, websiteJsonLd, breadcrumbJsonLd, collectSliceJsonLd } from "@typren/core/seo";

<JsonLd data={organizationJsonLd(seoConfig)} />
<JsonLd data={websiteJsonLd(seoConfig)} />
<JsonLd data={breadcrumbJsonLd(seoConfig, [{ name: "Home", path: "" }, { name: "About", path: "/about" }])} />
```

`JsonLd` escapes every `<` in the serialized payload so a value containing
`</script>` can never break out of the script tag — the standard mitigation
for embedding untrusted-shaped JSON in HTML. `collectSliceJsonLd` walks a
page's slices and collects whatever structured data a slice registry opts
each slice into (the same opt-in-registry shape the markdown flattener
below uses).

## Sitemap and robots

```ts
import { buildSitemap, buildRobots, DEFAULT_AI_CRAWLERS } from "@typren/core/seo";

export default async function sitemap() {
  return buildSitemap(store, seoConfig, { homeSlug: "home" });
}

export default function robots() {
  return buildRobots(seoConfig);
}
```

`buildSitemap` emits one entry per page in the store (via
`store.listSlugs()`), honoring per-page `noindex`/`sitemap` frontmatter
overrides, with up to 8 concurrent `getPublished` reads
(`mapLimit`, see [cost-and-rate-limits](./cost-and-rate-limits.md)). It does
not know about anything outside the CMS store (a separate hosted-resources
collection, say) — concat those yourself. Pass `i18n` with more than one
locale to emit one entry per `(locale, slug)` with `alternates.languages`.

`buildRobots` always allows `/` for `*` and for an explicit allowlist of
named AI/answer-engine crawlers (`DEFAULT_AI_CRAWLERS`: GPTBot, ChatGPT-User,
ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Google-Extended, CCBot),
overridable via `config.aiCrawlers`. The allowlist is redundant with the
wildcard `allow: "/"` today — it exists as a one-line revert point if a site
later decides to block training crawlers.

## AIO: markdown mirror and llms-full.txt

```ts
import {
  createMarkdownRouteHandler,
  createMarkdownMirrorMiddleware,
  matchMarkdownMirrorSlug,
  generateLlmsFullTxt,
  renderSlicesAsMarkdown,
} from "@typren/core/seo";
```

`createMarkdownRouteHandler(store)` returns a Next Route Handler `GET` that
serves `# Title\n\n<flattened slices>` as `text/markdown` for a known slug,
404 otherwise. Mount it anywhere (e.g. `src/app/md/[slug]/route.ts`) and pair
it with `createMarkdownMirrorMiddleware(mirrorPath)` — a proxy/middleware
function rewriting `/<slug>.md` to `<mirrorPath>/<slug>` — to expose it at
the clean `/<slug>.md` URL a crawler expects.

`generateLlmsFullTxt(store)` renders every page in the store as one
markdown document (`llms-full.txt`), the detailed companion to a
hand-curated `llms.txt` (this function does not replace a curated summary;
`llms.txt` itself still needs a human author for marketing copy). Both use
the same `renderSlicesAsMarkdown` flattener: a best-effort generic
heading/body/repeating-item renderer. A slice shape it can't flatten well
gets its own override via the `renderOverrides` registry:

```ts
const overrides = { pricingTable: (props) => `## Pricing\n\n${/* ... */ ""}` };
await generateLlmsFullTxt(store, overrides);
```

## Redirects

```ts
import { buildRedirects, type RedirectEntry } from "@typren/core";
```

`buildRedirects(store)` turns per-page `aliases: string[]` frontmatter into
validated `RedirectEntry[]`, throwing loud (never silently dropping an
entry) on a malformed alias, an alias shadowing a real page's own canonical
path (including a page aliasing itself — a redirect loop), a duplicate
alias claimed by two pages, or more total aliases than `maxEntries` (default
1000). It is framework-agnostic: turn the result into whatever your host's
infra wants.

For everything a frontmatter alias can't describe — legacy platform URLs,
removed pages, paths that moved entirely off-site — merge in a host-supplied
redirect map file:

```ts
import { loadRedirectMap, mergeRedirectEntries, toRedirectPairs } from "@typren/core";

const content = await buildRedirects(store, { homeSlug: "home" });
const map = await loadRedirectMap(process.cwd(), "redirects.json");
const merged = mergeRedirectEntries(content, map, content.map((e) => e.to));
const pairs = toRedirectPairs(merged); // { key, value }[], ready for a redirect store
```

`loadRedirectMap` accepts a `.json` array of `{ from, to }`, or a `.mjs`/`.js`
module whose default (or `REDIRECTS`/`redirects`) export is that array.
`mergeRedirectEntries` throws if a map entry's `from` is claimed by both
sources, or shadows a live page's own path. `toRedirectPairs` percent-encodes
`from` and applies the site's trailing-slash convention to on-site `to`
targets; pass `{ appendSlash: false }` for a site whose canonical URLs are
bare.

> **Cost:** `buildRedirects`, like `buildSitemap`, reads one page per slug at
> up to 8 concurrent adapter calls. See
> [cost-and-rate-limits](./cost-and-rate-limits.md) for exact call counts
> against the GitHub adapter.
