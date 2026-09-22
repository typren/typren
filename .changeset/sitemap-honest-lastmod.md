---
"@typren/core": minor
---

`buildSitemap` no longer stamps build time as every page's `lastmod`. A page
that declares `sitemap.lastModified` in frontmatter (`YYYY-MM-DD` or full ISO
datetime) has it passed through verbatim; every other page now omits `lastmod`
entirely. Stamping build time told crawlers the whole site changed on every
deploy, which teaches them to discount the signal — omission is valid per the
sitemap protocol and honest. Breaking for anyone relying on the old build-time
`lastModified` being present on every entry.
