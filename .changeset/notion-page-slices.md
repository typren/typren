---
"@typren/core": minor
---

Add `content: "slices"` to `createNotionAdapter`: a Notion page now reads as
a full typren page record whose `PageContent.slices` come from running the
page's block tree through `blocksToSegments`/`pageRecordFrom` (prose runs
become a `"prose"` markdown slice, `::componentName` directives become named
slices, in document order) — the `content: "blocks"` mode's plumbing, now
also wired into a real `slices` array instead of only a flattened markdown
`body`. The host's own slice registry resolves each name at render time; an
unregistered name is that registry's fallback to handle (unchanged), never
a throw from this adapter. Read-only for now: `writeRaw`/`writeDraftRaw`
still only push `properties`, with a loud one-time `typren:` console warning
(not a silent drop) when a write would have carried slice edits — mirroring
`content: "blocks"`'s existing body-write warning. Additive; no behavior
change for `content: "none"` or `"blocks"` collections.
