# @typren/studio

The editor UI layer of the seam described in the root README's Architecture
section:

```
ContentAdapter  ->  ContentStore  ->  makeActions(config)  ->  editor UI
   (@typren/core)     (@typren/core)      (@typren/core)         (@typren/studio, here)
```

It depends on `@typren/core` for everything below that seam (adapters, the
draft/publish store, auth-gated action handlers) and owns nothing server-side
itself.

**Status: in progress, private, not yet published to npm.** Current scope is
the Pages editing loop only. Settings, media library sections, collections
and onboarding UI are not built yet. `apps/studio` does not mount these
components yet, and the `typren init` scaffold has not been rewritten against
them. Test coverage is still thin — the `./element` entry has a smoke suite,
the rest of the package has none yet.

## Install

Not yet published; install from the workspace (`"@typren/studio": "workspace:*"`).

## Quickstart

```tsx
import { TyprenEditor } from "@typren/studio";

<TyprenEditor
  host={{ actions, sliceNames, defaults, previewPath: "/editor/preview" }}
  pages={pages}
  slug={slug}
  page={page}
  onNavigate={(slug) => router.push(slug ? `/editor/${slug}` : "/editor")}
  onReload={() => router.refresh()}
/>;
```

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-editor.md) for every export, option and the `./element` custom-element entry.
