# typren

## 0.2.1

### Patch Changes

- @typren/core@0.2.1

## 0.2.0

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
- Updated dependencies [a6e618b]
- Updated dependencies [38548ca]
- Updated dependencies [5d27c77]
  - @typren/core@0.2.0

## 0.1.4

### Patch Changes

- 8cfe390: Bump dependencies: sharp 0.35.4, and dev-only updates (@types/node 26, next 16.3.4, @testing-library/react 16.3.3, @types/react-dom 19.2.5). No runtime behaviour change.
- Updated dependencies [8cfe390]
  - @typren/core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [cc9b5aa]
  - @typren/core@0.1.3

## 0.1.2

### Patch Changes

- Prepare the `typren` CLI for its first npm release, and align the `typren init` scaffold with what is actually published. The scaffold no longer emits the unpublished `@typren/editor` UI: the editor routes are gone, the content Server Actions now live in `cms-actions.ts`, and the media upload route now lives at `app/media/upload/route.ts`. The CLI gains `--version`, a `typren telemetry on|off` command (inert until a collector endpoint exists, disabled by `DO_NOT_TRACK`, `TYPREN_TELEMETRY=0`, or `CI`), and `typren review` now detects its paths instead of assuming a fixed layout, overridable via a `review` key in `typren.config.json`. CLI packaging is now npm-correct: `@typren/core` is declared as a semver range instead of `workspace:*`, and LICENSE and README ship in the package.
  
  This core release matters for the CLI even though the core API is unchanged: `buildTemplates` lives in `@typren/core/templates/init`, so the CLI must resolve a core version that contains the editor-free scaffold. Publishing the CLI against core 0.1.1 would scaffold imports of the unpublished editor package.
- Updated dependencies
  - @typren/core@0.1.2
