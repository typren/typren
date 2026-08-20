# Contributing to Typren

Thanks for considering it. Please read the CLA section before writing code, since
it's a real constraint, not boilerplate, and it's better to know up front.

## Contributor licence agreement

**Typren requires a CLA on every contribution.** You keep copyright in your
work; you grant us the right to license it under terms other than the project's
own. The full text is in [CLA.md](CLA.md).

Typren is released under the Functional Source License, which already stops
anyone from standing up a competing hosted version, so the CLA isn't what
protects that. What it protects is our ability to change license terms later
without tracking down every past contributor first: shortening or lengthening
the two-year window before code converts to Apache 2.0, offering a different
commercial arrangement to a specific customer, or relicensing entirely if the
project's needs change. Without a CLA, any of those would need everyone who
ever contributed to agree again.

You may disagree with that model. It is a legitimate thing to dislike, and we would
rather say so plainly than bury it. If you would rather not sign, open an issue
to discuss the change instead of sending a pull request, so you don't spend
effort on code we cannot merge.

Signing is one comment on your first pull request. A check posts the
instructions, you reply with the sentence it asks for, and your signature is
recorded on the `cla-signatures` branch of this repository against your username.
It covers every contribution you make afterwards, so you only do it once.

## Setup

Requires [Bun](https://bun.sh) and, for the secret scan,
[gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`).

```bash
bun install
bun run verify     # everything the pre-push gate runs
```

## CI runs on your machine

There are no GitHub Actions for tests. `pre-push` gates on typecheck, lint,
tests with coverage, the new-code coverage threshold, secret scanning, and the
build. It then posts a `ci/local` commit status so results still appear in the
GitHub UI.

There are two workflows in `.github/`, and both are there because they cannot
run on a laptop. Release publishing needs a CI environment for npm provenance
attestation, and the CLA check has to answer on your pull request the moment you
open it.

If a hook blocks you, fix the cause. Don't `--no-verify`.

## Coverage

Two thresholds, answering different questions:

- **Whole repo**, a ratcheting floor. It rises as coverage improves and blocks
  regression below the high-water mark. The target is 80%.
- **New code, 90% of changed lines.** Measured per line against the merge-base,
  not per file, so a two-line edit needs those two lines covered rather than
  dragging a whole legacy file up.

The second one is the real gate. It's why coverage climbs instead of rotting.

Genuinely untestable code should be excluded in `vitest.config.ts` with a
comment saying why. Do not leave it uncovered, silently dragging the number down.

## Commits

Conventional Commits, enforced by commitlint. Keep one concern per commit, so a
reviewer should be able to read `git log --oneline` as a story.

Explain **why** in the body, not what; the diff already says what.

## Changesets

Any change to a published package needs a changeset:

```bash
bun changeset
```

Pick the packages and bump type, describe the change for the changelog. Pre-1.0,
breaking changes bump **minor**. Skip this only for changes that don't affect
published output (docs, tests, CI).

## Branches and releasing

Two long-lived branches:

- **`develop`** is where work integrates. Open your pull request against this
  one, not `main`.
- **`main`** is the released line. Every commit on it corresponds to what is
  published on npm.

Releasing is a promotion, in four steps:

```bash
git switch develop && git pull
bun changeset version      # applies queued changesets, bumps versions, writes CHANGELOGs
git commit -am "chore(release): <versions>"
gh pr create --base main --head develop
```

Merging that pull request publishes. There is no tag to create by hand: pushing
to `main` runs the release workflow, which republishes nothing it has already
published, then creates and pushes the per-package tags itself
(`@typren/core@0.1.2` and so on).

The version bump living in the promotion pull request is the point. Its diff is
the release proposal, so the exact versions and changelog entries get reviewed
before anything reaches the registry rather than after.

The workflow additionally waits on a required reviewer for the `release`
environment, so a merge alone does not publish; someone still approves the run.
That is deliberate belt and braces, because an npm publish cannot be undone.

## Architecture

Read the Architecture section of the [README](README.md#architecture) first.
Four layers, each depending only on the one below: `ContentAdapter` →
`ContentStore` → `makeActions()` → editor UI.

Before adding a feature, work out which layer it belongs to. Most new features
are a method on an existing interface, not a new abstraction.

Conventions that matter:

- **Adapters are interfaces plus factory functions** (`create*Adapter(opts)`),
  never classes or a DI container.
- **Trust boundaries belong to the adapter.** Slug, locale and media-id
  validation happens inside the adapter, not in callers. A new adapter for a
  different backend validates its own equivalent boundary. Do not assume an
  upstream layer checked.
- **Fail closed.** Every `AuthAdapter.authorize()` wraps identity resolution in
  try/catch and returns `false` on error. Never let a thrown error default to
  allowed.
- **`ponytail:` comments** mark deliberate shortcuts with a stated ceiling and
  upgrade path. Read the ones near code you are changing, because they are intentional.
- Tests are colocated: `foo.ts` → `foo.test.ts`.
- The `--typren-*` CSS variables are the entire theming contract. New editor UI
  that needs a visual token adds one to that set with a shadcn-token fallback,
  never a component-local variable or a hardcoded color.

## Security

Never open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
