---
title: Collections and Notion
description: Record-shaped content outside the Pages tree, backed by markdown or a Notion database.
category: Guides
order: 23
---

A **collection** is a set of records — authors, FAQ entries, case studies —
that aren't individually routed pages. Collections are a `CollectionSection`
on the editor's `sections` config, each with its own `ContentAdapter`.

## Declaring a collection

```ts
import type { CollectionSection } from "@typren/core";

const authors: CollectionSection = {
  kind: "collection",
  label: "Authors",
  dir: "content/authors", // own markdown directory, separate from Pages
  schema: {
    name: { type: "text", label: "Name" },
    bio: { type: "textarea", label: "Bio" },
  },
  titleField: "name",
};
```

Provide exactly one of `dir` (a repo-relative directory, gets its own
markdown-backed adapter) or `adapter` (a pre-built `ContentAdapter` for a
non-filesystem backend, e.g. Notion). A `dir` that resolves inside, or
around, the Pages adapter's own content directory throws at construction —
collections and Pages must never share storage.

```ts
import { listCollectionRecords, makeCollectionActions } from "@typren/core";

const records = await listCollectionRecords(config, authors);
const actions = makeCollectionActions(config, authors); // saveDraft/publish/... for this section
```

Every `.md` file in a collection's `dir` is a record — unlike the Pages
adapter, which filters to files carrying a slice array (to skip `site.md`
and friends), a collection has no slice array to filter on.

> Collection sections have no `onPublish`/`onSaveDraft` hook: their
> `(slug, locale[, version])` signature can't identify which collection
> changed, so there's nothing to key a revalidation off. Add a per-section
> hook at the call site if you need one.

## Notion-backed collections

`createNotionAdapter` backs a collection with a Notion database instead of
markdown files — one database row is one record.

```ts
import { createNotionAdapter, createFetchNotionClient } from "@typren/core";

const notionAdapter = createNotionAdapter({
  client: createFetchNotionClient(process.env.NOTION_TOKEN!),
  databaseId: process.env.NOTION_DATABASE_ID!,
  slugProperty: "Slug",
  properties: {
    title: { name: "Name", type: "title" },
    slug: { name: "Slug", type: "rich_text" },
    tags: { name: "Tags", type: "multi_select" },
  },
});

const faq: CollectionSection = {
  kind: "collection",
  label: "FAQ",
  adapter: notionAdapter,
  schema: { title: { type: "text", label: "Title" }, tags: { type: "text", label: "Tags" } },
};
```

`properties` maps a `meta` key to a Notion property name and type
(`title`, `rich_text`, `number`, `select`, `status`, `multi_select`,
`checkbox`, `date`, `email`, `phone_number`, `url`, `relation`). Any other
property on the row is ignored — not read, not written, not clobbered.

### Slugs

With `slugProperty` set, that property's value is the record's slug, and new
records can be created through the adapter. Without it, the slug **must be
the Notion page's own UUID** (with or without dashes): `writeRaw` on an
unknown slug then throws, since a page id doesn't exist until Notion assigns
one. A page id that resolves to a row in a *different* database than
`databaseId` is treated as not found, not served — rows from other databases
are never visible through this adapter instance.

### Reading page content

```ts
const adapter = createNotionAdapter({
  client,
  databaseId,
  properties,
  content: "blocks", // or "slices"
});
```

- `"none"` (default): `body` is always `""`, or comes from `bodyProperty` if
  set — a property-only record.
- `"blocks"`: `body` is the page's own block content, converted to markdown.
- `"slices"`: the page reads as a full Typren page record — the block tree
  runs through the same segment mapping as `"blocks"`, but `::componentName`
  directives become named slices in document order instead of being
  flattened to markdown.

Both `"blocks"` and `"slices"` need a `NotionClient` with `listBlockChildren`
implemented (`createFetchNotionClient` provides one); omitting it throws at
construction.

The block-to-markdown conversion escapes third-party Notion text (any
workspace collaborator's content, not just the integration owner's) against
markdown and HTML injection, but as defense in depth a host should still
render the resulting markdown with raw HTML disabled or sanitized, rather
than trusting this one layer.

> **Limits:**
> - **Read-only body/slices.** A body or slice edit against a `"blocks"`- or
>   `"slices"`-backed record is **not written back to Notion** — only
>   `properties` are pushed on write. The adapter logs one `console.warn` per
>   instance (not per call) the first time an edit would have been lost.
> - **No draft/publish distinction.** Notion has no separate draft storage;
>   every draft save writes straight through to the published row. This drops
>   optimistic-locking and "unpublished changes" UX for Notion-backed
>   collections — an open design question, not silently dropped.
> - **Slug lookup without `slugProperty` scans the whole database** client-side
>   (Notion's filter JSON is property-type-specific; not worth the code for an
>   internal lookup). Notion's API is rate-limited to roughly 3 requests/second,
>   so a caller doing one lookup per slug in a loop starts throttling well
>   before the O(n) scan itself is the bottleneck. Fine for admin-table-sized
>   databases; swap in a filtered query, or memoize `queryDatabase` within one
>   store operation, if a collection grows into the thousands of rows. See
>   [cost-and-rate-limits](./cost-and-rate-limits.md).

## Sections and the editor shell

Collections are one of five section kinds (`pages`, `media`, `settings`,
`collection`, `custom`) resolved by `resolveSections(config)`. Omitting
`sections` entirely falls back to the three built-in singletons
(`DEFAULT_SECTIONS`); adding a `collection` section appends it to the editor
nav without touching the Pages/Media/Settings defaults.
