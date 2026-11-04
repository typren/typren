---
"@typren/core": minor
---

`SeoConfig.homeSlug` names the page served at the site root. `buildMetadata` now gives it the canonical `/` instead of `/home`, and `buildSitemap` uses it when its own `homeSlug` option is omitted, so the canonical and the sitemap URL agree.
