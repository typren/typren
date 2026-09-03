---
"@typren/core": patch
"typren": patch
---

Add a Notion-backed `ContentAdapter` (`createNotionAdapter`,
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
