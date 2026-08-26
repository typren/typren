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
ported from the predecessor codebase, typecheck, and build to `dist` the same
way `@typren/core` does. `apps/studio` does not mount them yet, and the
`typren init` scaffold has not been rewritten against them. The package stays
`private: true` until that work lands. Test coverage is still thin — the
`./element` entry has a smoke suite, the rest of the package has none yet.

Current scope is the Pages editing loop only. Settings, media library
sections, collections and onboarding UI are not built yet.

## Entries

- `.` — the React components, `TyprenEditor` foremost.
- `./element` — `<typren-shell>`, a custom element wrapping `TyprenEditor`
  for hosts that aren't React (mounts with `react-dom/client`, renders into
  light DOM). Also registers `meditor-shell` as a deprecated alias for
  pre-rename consumers. See the file's own doc comment for the mount shape.
