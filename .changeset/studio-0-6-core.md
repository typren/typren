---
"@typren/core": minor
---

Core now carries every flow the v3 studio, its local host and the CLI share, so each front end stays a thin call into `makeActions` and the HTTP API.

Breaking: the admin route is named after the studio. `adminRoute` defaults to `"studio"` (was `"editor"`), the proxy helpers rewrite a renamed route to `/studio/**`, and `typrenBlocksDirectEditorAccess` is now `typrenBlocksDirectStudioAccess`. `currentAdminRoute`, `typrenProxyRewrite` and `previewPathFor` keep their names, and a stored `adminRoute` still wins.

Breaking: `typren init` scaffolds the site side only, because the studio runs beside the site in `typren studio`. The init templates no longer write `next.config.ts` (the admin-route rewrite), `cms-actions.ts` or `app/media/upload/route.ts`, and `typren.config.json` no longer carries `adminRoute`. They add the dev-only studio preview hooks (`getPage()` and `studioPreview` in `cms.config.ts`), the section canvas page, `seo.ts` and `site-style.tsx` instead. `TYPREN_REWRITE_MARKER` is gone.

Breaking: the settings `"admin"` authorization check now carries the `locale` being written, so a per-locale `AuthAdapter` policy holds for settings draft saves and publishes as it already did for content writes. No adapter change is needed, but a policy that keyed off a missing locale will now see one.

Run `typren migrate` and see `docs/migrations/core-0.6.0.md` for the upgrade steps.

What's new:

- **Pages in makeActions.** Reads (`listPages`, `getPage`, `listPageFolders`) and flows (`createPageFrom`, `insertSection`, `updatePageMeta`, `commitPage`, `publishAll`, `push`, `uploadMedia`) behind the usual guards, served over HTTP. A refused flow throws `ActionRefusedError` and answers 422 with a plain-language reason. Pages can nest (`event/1`), start as drafts, and live in kept page folders. `renamePage` keeps folder segments, refuses the home page (`CmsConfig.homeSlug`) and pages with children; `deletePage` refuses the home page and unknown slugs. `duplicatePage` and `createTranslation` require read access to the source.
- **Git-backed content.** `createGitRepo` and `CmsConfig.git` commit, list outgoing commits and push; `pending()`, `pushPaths()` and `discardPaths()` give per-file review limited to the content roots, a selective push sends one commit per page, and `GitRepo.history`, `pageHistory` and `GET /git/history` read a page's version history. `commitOrRestore` and `CmsConfig.withCommit` commit a write as one change and put the checkout back when the commit fails; a detached HEAD is refused before anything is written, and git failures are explained in plain words (`GitError`, `explainGitError`).
- **Settings through Review.** `SettingsStore` gains `open`, `discardDraft`, `history` and a validated `writeBootstrap`; `POST /git/push { settings: true }` publishes the settings draft as its own commit. Settings reads return only the editable bootstrap keys. Saved Site Settings feed the SEO layer (`withSiteSettings`, `resolveSeoConfig`).
- **Site style.** A `--typren-*` style token model (`STYLE_TOKENS`, `styleCss`, `sanitizeStyle`, `STYLE_MAP_DEFAULT`) maps saved tokens onto the site's own custom properties; `@typren/core/ui/typren-style` renders them on the live site. Values that could fetch outside URLs or break the stylesheet are refused.
- **Navigation.** The site doc's header menu has a contract (`SITE_SLUG`, `NavItem`, `navHrefError`, `assertSafeNav`, `readMenu`, `linksTo`, `unlink`), refuses unsafe links and nesting past eight levels, and stays in step when a page is renamed or deleted.
- **Library.** `createSliceLibrary` keeps saved sections and page templates, in folders, with conflict-checked updates and renames, committed in a git checkout.
- **Media.** Optional folder support on `MediaAdapter` (implemented by the fs adapter), moves and renames that rewrite references (`CmsConfig.onMediaMove`), `mediaUsage()`, and `deleteMedia` refusing an asset content still uses unless forced. The fs adapter refuses paths through symlinks, and an unauthorized upload answers 403.
- **Local sites.** `createLocalSiteConfig` builds the `CmsConfig` for a site on disk, with every commit hook the studio needs.
- **Section canvas and preview bridge.** `@typren/core/ui/section-canvas` renders one slice, many slices, or a whole page in a persistent page mode (`createCanvas`, `createReactRenderer`), also on static exports, with every posted prop treated as untrusted (`parseSectionQuery`, `parseSectionDocument`). The preview bridge signs messages with the studio's session nonce, draws section outlines inside the page, reports navigation and the site's computed style, applies style live, and stays inert on an unsafe origin.
- **Theme.** `theme.css` is restructured after WinUI 3's Fluent tokens (text, fills, strokes, layers, a coral accent), with concentric squircle corners, hover and selected surfaces, reveal and grain tokens; the shadcn-named tokens alias onto them, so overrides keep working.
- **Names.** `slugError` and `nameError` word the slug and media-name rules the same way in every front end.
