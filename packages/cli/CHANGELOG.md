# typren

## 0.5.3

### Patch Changes

- Updated dependencies [a30827e]
- Updated dependencies [5dc7a16]
- Updated dependencies [121d0c1]
- Updated dependencies [5c11512]
  - @typren/core@0.5.3

## 0.5.2

### Patch Changes

- 63b4357: `typren init` now refuses to write a scaffold file when the target or one of its parent directories is a symlink, instead of writing through a symlinked parent or, with `--force`, overwriting whatever a symlinked target points at.
- 20e0cf5: `typren migrate` resolved the installed `@typren/core`'s `package.json` with `require.resolve(..., { paths: [cwd] })`, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because core's `exports` map never listed `./package.json` — crashing `migrate` on every project. It now locates the file by walking `node_modules` directly. `@typren/core`'s `exports` map also now lists `./package.json`, for any other caller relying on Node's own resolution.
- 718167e: `typren migrate --remote` now validates a remote note's `version` against a full semver-ish pattern instead of only checking its prefix, so a value like `0.6.0` followed by a terminal escape sequence is rejected rather than printed. It also strips control characters from untrusted index URLs and fetch/parse error messages before they reach the terminal, matching the stripping already done for a note's title and body.
- c455817: `typren review` scraped slice keys from the project's `seo-registry.ts` with a single regex over the whole (repo-controlled) file. It now scans the file line by line with plain string operations instead, so parsing it can't regress into regex backtracking blowup on adversarial content.
- Updated dependencies [20e0cf5]
- Updated dependencies [2272c4b]
- Updated dependencies [1aa05a6]
- Updated dependencies [e860046]
- Updated dependencies [7489416]
- Updated dependencies [8f9c06e]
  - @typren/core@0.5.2

## 0.5.1

### Patch Changes

- 086a883: `typren init` now binds `package.json`'s `dev` script to loopback (`next dev -H 127.0.0.1`), which the scaffolded `localAuth()` requires. The docs already claimed it did; it only printed advice, and `next dev` listens on all interfaces by default. A script it can't safely rewrite is left alone with a warning.
- Updated dependencies [e78fa80]
- Updated dependencies [d8b5925]
- Updated dependencies [dc12381]
- Updated dependencies [38ee2d8]
- Updated dependencies [8db92cc]
- Updated dependencies [bd91499]
- Updated dependencies [1d632a0]
- Updated dependencies [7183ffa]
  - @typren/core@0.5.1

## 0.5.0

### Minor Changes

- d054689: Add `typren migrate`: reads the migration notes bundled with the installed
  `@typren/core` (`migrations/`, packed at build time from `docs/migrations/`)
  and checks the project against each one's `detect` patterns, printing
  file:line matches plus the note's Fix/Verify steps. `--remote` additionally
  checks `https://typren.com/migrations/index.json` for notes newer than the
  install, labelled unverified since they aren't pinned by the lockfile.
  
  `@typren/core` ships the `migrations/` directory (now in its package `files`)
  but no notes yet; this is a non-breaking addition and bumps patch.
  
  Also adds the breaking-change migration gate (`bun run check:migrations`,
  wired into `bun run verify`): a changeset whose body starts with `BREAKING:`
  must have a `docs/migrations/<package>-<version>.md` ahead of that package's
  current version, or `verify` fails with the missing file named.

### Patch Changes

- 84ae104: Harden `typren review`'s git handling and PR-body generation:
  
  - `--base <ref>` (and a brief's stored `baseRef`) now rejects a value
    starting with `-`, so it can never be parsed as a git option instead of a
    revision; every git call that still takes the ref also passes
    `--end-of-options` as defense in depth.
  - `--pr`'s PR body writes to a fresh `mkdtempSync` directory instead of a
    predictable `typren-review-<slug>-<timestamp>.md` path directly under the
    shared temp dir.
  - The PR body's embedded JSON code fence is now sized past the longest
    backtick run already present in the diff content it wraps.
  - `typren init` no longer writes through a dangling symlink at a scaffold
    target; it's skipped like an existing file unless `--force`.
- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).
- 1130d81: Hardening pass on `typren migrate` and the breaking-change migration gate,
  all bug fixes with no API change:
  
  - `typren migrate` now drops (with a warning) a `--remote` note whose
    package/version isn't validly shaped, strips control characters from a
    remote note's title/body, and caps the remote fetch to 1 MB while
    streaming instead of after buffering the whole response.
  - `@typren/core`'s published package now also carries a `migrations/.min-version`
    file (the oldest migration note it kept); `migrate` reads it and warns
    (exiting non-zero) when a project's `--from` predates it, since older
    notes it may have needed were dropped from this release.
  - The project file walk `migrate` runs to detect matches no longer follows
    symlinks, caps per-file reads at 1 MB, reads each file once regardless of
    how many detect patterns/notes apply to it, and ignores a few more
    generated-output directories (`coverage`, `build`, `.turbo`, `.vercel`,
    `.svelte-kit`, `.output`).
  - Every `execFileSync("git", ...)` call in the CLI (`review`'s git-backed
    checks, and `--pr`'s checkout/commit/push) now runs with `envWithoutGit()`,
    closing the same inherited-`GIT_DIR` hazard `migrate`'s own git calls were
    already guarded against.
  - `bun run check:migrations` is now part of the local `pre-push` gate (it was
    already part of `bun run verify`, so CI already ran it); the gate itself
    now requires a migration note's version to exactly match the version a
    changeset's bump produces (not just any later version), tolerates
    CRLF/unquoted-or-single-quoted changeset frontmatter, and only enforces
    itself against packages whose notes are actually packed into the CLI
    (`@typren/core`; others get an informational note instead of a failure).
- 87ec75b: Front matter now refuses YAML aliases (`*ref`) and blocks over 256 KB, so a content file can no longer
  expand into gigabytes of objects (billion laughs) when it is parsed. Timestamps, merge keys and every other
  value parse exactly as before.
- Updated dependencies [b0aa508]
- Updated dependencies [d2c9f03]
- Updated dependencies [11b4619]
- Updated dependencies [3e432fe]
- Updated dependencies [07a5280]
- Updated dependencies [52e172a]
- Updated dependencies [1130d81]
- Updated dependencies [e20d2b8]
- Updated dependencies [f5ec0c8]
- Updated dependencies [f5580aa]
- Updated dependencies [b95f3cd]
- Updated dependencies [c6f38fa]
- Updated dependencies [8be319f]
- Updated dependencies [87ec75b]
- Updated dependencies [d054689]
  - @typren/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [7e13dc1]
  - @typren/core@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [aa2ebce]
  - @typren/core@0.3.3

## 0.3.2

### Patch Changes

- b345415: `typren review` refuses gray-matter's `javascript` front-matter engine, which
  eval()s the front-matter block: review runs on writer-supplied markdown, and
  content is data, never code.
- @typren/core@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [ff519d8]
  - @typren/core@0.3.1

## 0.3.0

### Patch Changes

- 4a519e8: Security and correctness fixes from a repo-wide audit. adapter-cloudfront: the viewer-request function no longer emits protocol-relative redirect Locations (open redirect), preserves query strings on 301s, and emits canonical single-hop KVS targets; `setViewerRequestFunction` merges function associations instead of overwriting every event type. core: the locale router's redirect pathname collapses leading slashes (same open-redirect class), settings fall back to the default locale and detect draft-only versions, `listSlugs` skips non-slug filenames instead of throwing, `filePolicy` wildcard rules no longer apply to identities without an `@`, and the Notion adapter passes its token over stdin instead of child-process argv. cli: shared version read.
- Updated dependencies [4a519e8]
- Updated dependencies [fdb04a5]
  - @typren/core@0.3.0

## 0.2.2

### Patch Changes

- e7c422f: Update all dependencies to latest, consolidating the open Dependabot PRs (#57–#61): js-yaml 5 (named exports, bundled types), jsdom 30, vitest 5, TypeScript 6 (typescript-eslint does not support TS 7.0 yet), @types/node 26, eslint 10.10 / @eslint/js 10, plus minor and patch bumps across the workspace. Package tsconfigs now declare `"types": ["node"]` explicitly, as TS 6+ no longer auto-includes hoisted @types packages.
- Updated dependencies [e7c422f]
  - @typren/core@0.2.2

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
