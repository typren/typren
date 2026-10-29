# @typren/studio

The studio UI layer of the seam described in the root README's Architecture
section:

```
ContentAdapter  ->  ContentStore  ->  makeActions(config)  ->  studio UI
   (@typren/core)     (@typren/core)      (@typren/core)         (@typren/studio, here)
```

It depends on `@typren/core` for everything below that seam (adapters, the
draft/publish store, auth-gated action handlers) and owns nothing server-side
itself.

**Status: in progress, private, not yet published to npm.** The shell is the
v3 drill-down layout from [docs/editor-v3.md](../../docs/editor-v3.md): a
rail on the left, the live preview filling the rest. Phase 1 (the shell) is
built; the canvas overlay and the sections library are not. Onboarding UI is
out of scope.

## Install

Not yet published; install from the workspace (`"@typren/studio": "workspace:*"`).

## Quickstart

```tsx
import { TyprenStudio } from "@typren/studio";

// The studio fills its parent, so give the mount point a height.
<div style={{ height: "100dvh" }}>
  <TyprenStudio
    host={{ actions, sliceNames, defaults, previewPath: "/editor/preview" }}
    pages={pages}
    slug={slug}
    page={page}
    version={version}
    onNavigate={(slug) => router.push(slug ? `/editor/${slug}` : "/editor")}
    onReload={() => router.refresh()}
  />
</div>;
```

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-studio.md) for every export, option and the `./element` custom-element entry.
