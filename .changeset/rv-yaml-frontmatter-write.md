---
"@typren/core": patch
---

Security review (group "yaml"): `createMarkdownAdapter` and `createGithubAdapter`
now serialize front matter through the same safe path their `parse()` already
used, instead of gray-matter's raw `stringify`.

- Front matter is dumped with YAML anchors/aliases disabled (`noRefs: true`).
  Without it, a page whose slices share a nested object reference (as the
  editor's Duplicate control produces via a shallow copy) serialized to an
  anchor/alias pair that `parseMatter` refuses to read back: a saveDraft or
  Duplicate could make a page permanently unreadable, failing every build and
  listing that parses it.
- Serializing now enforces the same front-matter size cap `parseMatter`
  enforces on read, by reading the result back with `parseMatter` before
  returning it. Oversized front matter now throws before anything is written,
  instead of writing a file no parser can ever read again.
