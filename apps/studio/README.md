# @typren/studio-local

The studio as its own app. `typren studio`, run from a site's root, starts this
Next.js app on `127.0.0.1:4400`. It mounts `@typren/studio`, serves the content
API from its own process (`createTyprenApi` under `/api/typren`), and frames the
site's own dev server as the live preview. The site mounts no studio or API
routes. See `docs/site/studio.md` for the site side.

The CLI passes the site's data in the `TYPREN_STUDIO` environment variable (see
`lib/config.ts`), so this app has no config file of its own. To work on it from
the monorepo, run the CLI from a site directory:

```bash
node /path/to/typren/packages/cli/dist/cli.js studio --site-url http://127.0.0.1:3000
```
