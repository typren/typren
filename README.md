# Typren

An open-source, markdown-based site builder with a pluggable visual editor.
Visual, block-based editing, except your content is markdown in **your own Git
repository**, and the source is yours to read, run and modify.

> **0.x, under active development.** APIs will change between minor versions
> until 1.0. Pin exact versions if that matters to you.

## Why

Site builders trap your content in their database. Typren doesn't have one.
Pages are markdown files with frontmatter, blocks are components in your repo,
and the editor is a client that reads and writes those files. Delete Typren and
your site still builds.

- **Your content, your repo.** Markdown and frontmatter, committed to Git. Every
  save is a commit, so history and rollback come free.
- **Framework-agnostic core.** The engine is plain TypeScript. Next.js is the
  reference host today; the HTTP API is a WHATWG `Request → Response` handler,
  so it also runs on Bun, Deno and Workers unchanged.
- **Runs locally.** No account, no cloud, no signup to start.
- **Fair Source.** Free to run, modify and self-host for your own use. The one
  thing it's not for is standing up a competing hosted version of Typren
  itself. See [License](#license).

## Packages

| Package | What it is |
|---|---|
| [`@typren/core`](packages/core) | the engine: content store, adapters, HTTP API, SEO |
| [`typren`](packages/cli) | the CLI: scaffolding, content review |
| [`@typren/editor`](packages/editor) | the editor UI (React), in progress and not yet published |

## Architecture

Four layers, each depending only on the one below:

```
ContentAdapter    storage: fs + markdown, or your own KV/git/DB
      ↓
ContentStore      draft/publish, locale fallback, version-checked writes
      ↓
makeActions()     auth-gated handlers
      ↓
editor UI         React, mounted by a thin host
```

`MediaAdapter` and `AuthAdapter` follow the same shape: an interface plus one
reference implementation. Swapping storage never touches the editor.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run test          # vitest, 152 tests
bun run typecheck
bun run build
bun run verify        # everything the pre-push gate runs
```

CI runs **locally** rather than in GitHub Actions. `pre-push` gates on typecheck,
lint, coverage (whole-repo floor plus a 90% threshold on changed lines), secret
scanning, and the build, then posts the result as a commit status so it still
shows in the GitHub UI. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Functional Source License 1.1, Apache 2.0 future license](LICENSE). Free to
use, modify and self-host for anything except a competing hosted version of
Typren. Each release converts to plain Apache 2.0 two years after it ships, no
action needed on your part when that happens.

Contributions require a CLA. See [CONTRIBUTING.md](CONTRIBUTING.md#contributor-licence-agreement).
