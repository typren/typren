---
"@typren/studio-local": minor
---

The local host behind `typren studio` is now `@typren/studio-local` (was `@typren/studio`). It mounts `@typren/studio`, serves the content API from its own process and frames the site's dev server as the live preview, so a site mounts no studio or API routes. It keeps the page and edit mode in the URL, edits `studio.nestedLayouts` pages on their real routes, refuses to be framed, and serves proxied site images under a sandboxing CSP.
