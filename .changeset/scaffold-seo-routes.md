---
"@typren/core": minor
"typren": minor
---

`typren init` scaffolds `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt/route.ts` and `app/llms-full.txt/route.ts`, wired to the scaffolded `seo.ts`, and sets `homeSlug: "home"` there. A new site serves its crawler surfaces from the first build instead of after hand-wiring. Existing files are never overwritten.
