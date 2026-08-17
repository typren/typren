# @typren/editor

The editor UI layer of the seam described in the root README's Architecture
section:

```
ContentAdapter  ->  ContentStore  ->  makeActions(config)  ->  editor UI
   (@typren/core)     (@typren/core)      (@typren/core)         (@typren/editor, here)
```

It depends on `@typren/core` for everything below that seam (adapters, the
draft/publish store, auth-gated action handlers) and owns nothing server-side
itself.

**Status: in progress, private, not yet published to npm.** The React
components here (the `TyprenEditor` shell, `EditorShell`, `PagesNav`,
`BlockList`, `FieldForm`, `DevicePreview`, the media and icon pickers) were
ported from the predecessor codebase and typecheck, but they have no tests
yet, `apps/studio` does not mount them yet, and the `typren init` scaffold has
not been rewritten against them. The package stays `private: true` until that
work lands.

Current scope is the Pages editing loop only. Settings, media library
sections, collections and onboarding UI are not built yet.
