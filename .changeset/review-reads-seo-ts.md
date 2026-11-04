---
"typren": patch
---

`typren review` reads the `seo.ts` that `typren init` scaffolds, and takes `siteUrl` and `entityDescription` from its config object. On a freshly scaffolded site the canonical-consistency and entity-description checks used to skip because they looked only for a predecessor `app/seo.tsx`; they now run. `app/seo.tsx` with `SITE_URL` / `SITE_ENTITY_DESCRIPTION` consts still works.
