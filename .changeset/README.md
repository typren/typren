# Changesets

Version bumps and changelogs. Add one with any change to a published package:

```bash
bun changeset
```

Pick the packages, pick the bump type, write the line that should appear in the
changelog. Skip it only when nothing published changes, such as docs, tests or CI.

## Why the published packages share a version

`config.json` sets `fixed` across `@typren/core`, `typren` and
`@typren/editor`, so they always release together on one version number.
(`@typren/editor` is still `private: true` while it is being finished, so it
gets the version bumps but does not publish yet.)

They're tightly coupled pre-1.0 and released as a set, so independent versions
would mostly generate questions ("does core 0.4 work with editor 0.2?") without
buying anything. One number means "Typren 0.4" is a coherent thing to install
and to file a bug against.

The cost is churn: a package with no changes still gets a version bump when its
siblings move. That's a fair trade while the API is unstable. Revisit at 1.0,
when independent versioning starts to pay for itself.

## Pre-1.0 bump rules

Breaking changes bump **minor** rather than major. `0.x` signals instability, and
burning majors before 1.0 makes the number meaningless. Everything else is a
patch.

## Releasing

```bash
bun changeset version    # bumps, writes CHANGELOG.md, updates internal deps
git commit -am "chore: release"
git tag v0.2.0 && git push --follow-tags
```

Pushing the tag triggers the one GitHub workflow in this repo, which builds
from a clean checkout and publishes with npm provenance. See
`.github/workflows/release.yml` for why that step isn't local.
