# typren

The CLI for [Typren](https://github.com/typren/typren). It scaffolds a
Next.js project onto typren's content layer, keeps that project's settings in
sync with `typren.config.json`, and reviews markdown content before it ships.

## Install

```bash
npm install typren
```

It can also be run without installing it first:

```bash
npx typren init
```

## Commands

### `typren init`

This is the default command, so `npx typren` on its own runs it. It detects a
Next.js App Router project (a `src/app` or `app` directory in the current
directory) and scaffolds typren's content layer into it: markdown content
files and frontmatter conventions, a slice registry for your own components,
SEO/AIO wiring, and the programmatic actions your code, or an agent, calls to
read and write content. `@typren/editor`, the React editor UI that would call
those same actions from a visual UI, is a separate package and is not
published to npm yet.

It never overwrites a file that already exists unless you pass `--force`.

```bash
npx typren init [--force]
```

### `typren apply-settings`

This command reconciles your project's `next.config.*` and `cms.config.*`
with the bootstrap settings in `typren.config.json` (`adminRoute`, `locales`,
`defaultLocale`). It validates that config first, so it never writes anything
when the config is invalid, and it is safe to run again after every edit to
`typren.config.json`.

- If no `next.config.*` exists yet, it writes one that reads
  `typren.config.json` directly.
- If one exists and already reads `typren.config.json`, it leaves the file
  alone.
- If one exists and does not, it prints the exact snippet to add rather than
  editing your file for you.
- `cms.config.*` is handled the same way.

```bash
npx typren apply-settings
```

### `typren review`

This command runs a set of deterministic checks against your markdown content,
covering things like SEO title and description length, canonical URL
consistency, alt text on media, and whether a page is reachable from
`llms.txt`, then prints a pass, warn, fail, or skip summary per page. Which
checks run is expected to change over time, so treat the current set as a
starting point rather than a fixed list.

Paths are detected rather than assumed: `src/content` when the project has a
`src/` directory, otherwise `content` at the root, matching how `typren init`
picks its own base directory. Override any of them in `typren.config.json`:

```json
{
  "review": {
    "contentDir": "src/content",
    "resourcesDir": "src/content/resources",
    "seoFile": "src/app/seo.tsx",
    "seoRegistryFile": "src/slices/seo-registry.ts"
  }
}
```

Every key is optional. Checks that depend on a file you do not have report
`skip` with the resolved path in the message, so a missing optional file never
reads as a silent pass.

With no slug given, it reviews every content file that changed against
`--base` (`origin/main` by default; uncommitted working-tree edits are
included). With a slug, it reviews only that page.

```bash
npx typren review [slug] [--base <ref>] [--json] [--pr]
npx typren review --update-pr <number> --body-file <path>
```

- `--base <ref>` compares against this ref instead of `origin/main`.
- `--json` prints the raw review-brief JSON instead of a table.
- `--pr` also opens or updates a `content/<slug>` pull request with the brief
  in its body. This needs the `gh` CLI installed and authenticated.
- `--update-pr <number> --body-file <path>` posts an existing pull request's
  body from a file, without running a new review. It exists so a separate
  judgment pass, on voice, brand, or SEO prose, can layer its own output on
  top of the deterministic brief that `--pr` already opened.

### `typren telemetry`

The CLI can report anonymous usage: a random install id, the CLI and Node
versions, your OS platform, and which command ran. No file paths, project or
repo names, or file contents are ever collected, and the library packages
never send anything at all.

**As of this release nothing is sent.** No collector endpoint is configured,
so the beacon is inert and makes no network call whatsoever. The controls
below exist so the preference is yours to set before that changes, and the
first-run notice appears only once a collector actually exists.

```bash
npx typren telemetry        # print the current state
npx typren telemetry off    # opt out
npx typren telemetry on     # opt back in
```

It is also disabled by `DO_NOT_TRACK=1`, by `TYPREN_TELEMETRY=0`, and
automatically whenever `CI` is set.

### `typren migrate`

```bash
npx typren migrate
npx typren migrate --from 0.4.0 --to 0.5.0
npx typren migrate --json
npx typren migrate --remote
```

After upgrading `@typren/core`, run this and follow it until it exits `0`.
It reads the migration notes bundled with the installed `@typren/core`
(each one ships under that package's own `migrations/` directory), figures
out which ones apply between the version your project was last committed
against (`--from`, default: the `@typren/core` range in `git show
HEAD:package.json`) and the one actually installed (`--to`, default), and
for each one greps the project for the code patterns it says need updating.
Exits non-zero while any match remains, `0` once the project is clean (or no
note applies), and prints the note's own Fix/Verify steps either way.

**Bundled vs. `--remote`: a real trust difference, not a style choice.** The
default run only ever reads notes that shipped inside the `@typren/core`
tarball your lockfile pinned: same provenance, same npm audit trail, as the
code the notes describe. `--remote` additionally fetches
`https://typren.com/migrations/index.json` for notes newer than what's
installed, useful when a fix landed after your last `npm install` but before
you've upgraded. Those are printed under a "REMOTE (unverified, not
lockfile-pinned)" header: they didn't come from the package you audited, and
nothing from them is ever executed. Remote notes are display-only: their
detect patterns are not run (an untrusted regex could hang the CLI), and only
bundled notes affect the exit code. Redirects off typren.com are refused.

`--json` prints `{ from, to, notes: [{ package, version, title, matches:
[{file, line, hint}], body, source: "bundled" | "remote" }], droppedNotesWarning?
}` instead of the text report, for an agent or script driving the upgrade.

**Upgrading from a long way back.** `@typren/core`'s published tarball only
packs the newest handful of migration notes (old ones for versions nobody's
still upgrading from would just bloat it). If your project's `--from`
predates the oldest note this install still carries, `migrate` prints a
`droppedNotesWarning` and exits non-zero even if nothing else matched: some
notes you may have needed could be missing from this run. See
[docs/migrations](../../docs/migrations) in the repo, or
https://typren.com/migrations/, for the full history.

### `typren --version`

Prints the installed CLI version. `typren --help` lists every command.

## License

[Functional Source License 1.1](./LICENSE), converting to Apache 2.0 two years
after each release. Free to use, modify and self-host for anything except a
competing hosted version of Typren. See
[the repository](https://github.com/typren/typren#license) for what that
means in practice.
