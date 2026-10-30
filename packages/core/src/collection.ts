import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions, type PageActions } from "./actions";
import type { CmsConfig, CollectionRecordInfo, ContentAdapter } from "./types";
import { resolveSections, type CollectionSection } from "./sections";
import { slugify } from "./store";

/** True when `child` is inside (or equal to) `parent`. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Shared by makeCollectionActions/listCollectionRecords/the HTTP routes
 *  (api/routes.ts, for the reads makeCollectionActions' write-only
 *  `PageActions` can't do): resolves a collection section's own
 *  `ContentAdapter`, guarded against overlapping the Pages adapter's root. */
export function makeCollectionAdapter(config: CmsConfig, section: CollectionSection): ContentAdapter {
  if (section.adapter && section.dir)
    throw new Error(`typren: collection section "${section.label}" must set exactly one of dir/adapter`);
  // A pre-built adapter owns its own storage (Notion, a KV store, ...): used
  // as-is, no markdown-adapter construction and no dir-overlap guard (there is
  // no dir to overlap).
  if (section.adapter) return section.adapter;
  if (!section.dir)
    throw new Error(`typren: collection section "${section.label}" must set exactly one of dir/adapter`);
  const contentDir = path.resolve(process.cwd(), section.dir);
  // The overlap guard only makes sense when the Pages adapter also has a real
  // directory to overlap (a markdown adapter, which alone carries `root`, see
  // markdown-adapter.ts's `MarkdownAdapter` type). A network-backed Pages
  // adapter (GitHub, Notion) has no filesystem root for this collection's own
  // fs-backed dir to collide with.
  if ("root" in config.adapter) {
    const pagesRoot = (config.adapter as { root: string }).root;
    if (isInside(contentDir, pagesRoot) || isInside(pagesRoot, contentDir))
      throw new Error(`typren: collection dir "${section.dir}" overlaps the Pages content dir`);
  }
  return createMarkdownAdapter({
    contentDir,
    locales: config.adapter.locales,
    defaultLocale: config.adapter.defaultLocale,
    // Every .md in a collection dir is a record. The Pages default filters to
    // files carrying a slice array (to skip site.md and friends), which would
    // hide every frontmatter-plus-prose record a collection exists to hold.
    requireSliceArray: false,
  });
}

/** `collectionId` defaults to the id `resolveSections` would give `section`;
 *  it reaches every write's AuthContext so a policy can gate per collection. */
export function makeCollectionActions(
  config: CmsConfig,
  section: CollectionSection,
  collectionId = section.id ?? slugify(section.label)
): PageActions {
  const adapter = makeCollectionAdapter(config, section);
  // ponytail: onPublish/onSaveDraft omitted: their (slug, locale[, version])
  // signature can't identify a collection for revalidation or review-queue
  // triage. Add a per-section hook if a host needs collection revalidation.
  // withCommit too: the local site records only its own adapters' writes.
  return makeActions({ ...config, adapter, onPublish: undefined, onSaveDraft: undefined, withCommit: undefined }, { collectionId }) as PageActions;
}

export function buildCollectionActions(config: CmsConfig): Record<string, PageActions> {
  const out: Record<string, PageActions> = {};
  for (const s of resolveSections(config))
    if (s.kind === "collection") out[s.id] = makeCollectionActions(config, s.raw as CollectionSection, s.id);
  return out;
}

/** List every record in a collection section as `CollectionRecordInfo` rows:
 *  the list view's data source (spec: collections have no client "read"
 *  action, so this is what a host's server-fetch calls into). Reuses the same
 *  adapter construction as makeCollectionActions so the overlap guard and
 *  contentDir resolution can't drift between the read and write paths. */
export async function listCollectionRecords(
  config: CmsConfig,
  section: CollectionSection,
  locale?: string
): Promise<CollectionRecordInfo[]> {
  const adapter = makeCollectionAdapter(config, section);
  const slugs = await adapter.listSlugs(locale);
  return Promise.all(
    slugs.map(async (slug) => {
      const [raw, hasDraft] = await Promise.all([adapter.readRaw(slug, locale), adapter.hasDraft(slug, locale)]);
      const { meta, body } = adapter.parse(raw);
      return { slug, meta, body, hasDraft, locale };
    })
  );
}
