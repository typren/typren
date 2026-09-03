# @typren/core

## 0.2.1

## 0.2.0

### Minor Changes

- 38548ca: Add `content: "slices"` to `createNotionAdapter`: a Notion page now reads as
  a full typren page record whose `PageContent.slices` come from running the
  page's block tree through `blocksToSegments`/`pageRecordFrom` (prose runs
  become a `"prose"` markdown slice, `::componentName` directives become named
  slices, in document order) — the `content: "blocks"` mode's plumbing, now
  also wired into a real `slices` array instead of only a flattened markdown
  `body`. The host's own slice registry resolves each name at render time; an
  unregistered name is that registry's fallback to handle (unchanged), never
  a throw from this adapter. Read-only for now: `writeRaw`/`writeDraftRaw`
  still only push `properties`, with a loud one-time `typren:` console warning
  (not a silent drop) when a write would have carried slice edits — mirroring
  `content: "blocks"`'s existing body-write warning. Additive; no behavior
  change for `content: "none"` or `"blocks"` collections.
- 5d27c77: Added `buildRedirects(store, opts?)`, a framework-agnostic redirects API driven by page frontmatter: a page declares its own old URLs via `aliases: string[]` instead of every host hand-maintaining a redirect config. Validates absolute paths, rejects an alias that shadows another page's canonical path (including a page aliasing itself), de-duplicates across the whole site, and caps total entries (`maxEntries`, default 1000). Hosts turn the returned `RedirectEntry[]` into whatever their infra wants — Next `redirects()`, a Netlify/Cloudflare `_redirects` file, `vercel.json`, an nginx map, or a CloudFront KeyValueStore (see the new `@typren/adapter-cloudfront`).

### Patch Changes

- a6e618b: Add a Notion-backed `ContentAdapter` (`createNotionAdapter`,
  `createFetchNotionClient`) and let a `CollectionSection` take a pre-built
  `adapter` instead of `dir` for non-filesystem backends. The Notion adapter's
  property mapping is generic (driven entirely by a caller-supplied
  property-type map, no site/entity knowledge); `content: "blocks"` optionally
  reads a page's own block content (paragraphs, headings, lists, tables,
  toggles, ...) as markdown via a new pure block converter
  (`blocksToMarkdown`/`blocksToSegments`/`pageRecordFrom` in `notion-blocks.ts`),
  including a generic `::componentName` directive convention for calling a
  site's own components from inside a Notion page. Block writes are
  read-only for now (a loud `typren:` TODO marks the deferred write-back).
  All additive, no behaviour change for existing markdown-backed collections.

## 0.1.4

### Patch Changes

- 8cfe390: Bump dependencies: sharp 0.35.4, and dev-only updates (@types/node 26, next 16.3.4, @testing-library/react 16.3.3, @types/react-dom 19.2.5). No runtime behaviour change.

## 0.1.3

### Patch Changes

- cc9b5aa: Replace the polynomial dash-trim regex (`/^-+|-+$/g`) with an equivalent linear one in the three slugify sites (store, sections, media). Behavior is unchanged — after the alnum collapse consecutive dashes cannot occur — but hostile input can no longer trigger quadratic backtracking. Closes the three CodeQL alerts.

## 0.1.2

### Patch Changes

- Prepare the `typren` CLI for its first npm release, and align the `typren init` scaffold with what is actually published. The scaffold no longer emits the unpublished `@typren/editor` UI: the editor routes are gone, the content Server Actions now live in `cms-actions.ts`, and the media upload route now lives at `app/media/upload/route.ts`. The CLI gains `--version`, a `typren telemetry on|off` command (inert until a collector endpoint exists, disabled by `DO_NOT_TRACK`, `TYPREN_TELEMETRY=0`, or `CI`), and `typren review` now detects its paths instead of assuming a fixed layout, overridable via a `review` key in `typren.config.json`. CLI packaging is now npm-correct: `@typren/core` is declared as a semver range instead of `workspace:*`, and LICENSE and README ship in the package.
  
  This core release matters for the CLI even though the core API is unchanged: `buildTemplates` lives in `@typren/core/templates/init`, so the CLI must resolve a core version that contains the editor-free scaffold. Publishing the CLI against core 0.1.1 would scaffold imports of the unpublished editor package.

## 0.1.1

### Patch Changes

- Patch sharp to close four high-severity libvips CVEs (CVE-2026-33327,
  CVE-2026-33328, CVE-2026-35590, CVE-2026-35591). The fix shipped in sharp
  0.35.0, which `^0.34.5` could never reach, so this raises the range to
  `^0.35.3`.
  
  sharp 0.35 also folded AVIF detection into its heif decoder, so an AVIF upload
  now reports format `heif` with compression `av1` rather than a dedicated
  `avif` format. The upload guard checks compression alongside format, which
  keeps AVIF passthrough working without silently starting to accept plain HEIC.
  
  Adds a package README, so the npm page describes the package instead of
  showing nothing.
