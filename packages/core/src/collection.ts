import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions, type PageActions } from "./actions";
import type { CmsConfig, CollectionRecordInfo, ContentAdapter } from "./types";
import { resolveSections, type CollectionSection } from "./sections";

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
  const contentDir = path.resolve(process.cwd(), section.dir);
  const pagesRoot = config.adapter.root;
  if (isInside(contentDir, pagesRoot) || isInside(pagesRoot, contentDir))
    throw new Error(`typren: collection dir "${section.dir}" overlaps the Pages content dir`);
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

export function makeCollectionActions(config: CmsConfig, section: CollectionSection): PageActions {
  const adapter = makeCollectionAdapter(config, section);
  // ponytail: onPublish/onSaveDraft omitted: their (slug, locale[, version])
  // signature can't identify a collection for revalidation or review-queue
  // triage. Add a per-section hook if a host needs collection revalidation.
  return makeActions({ ...config, adapter, onPublish: undefined, onSaveDraft: undefined }) as PageActions;
}

export function buildCollectionActions(config: CmsConfig): Record<string, PageActions> {
  const out: Record<string, PageActions> = {};
  for (const s of resolveSections(config))
    if (s.kind === "collection") out[s.id] = makeCollectionActions(config, s.raw as CollectionSection);
  return out;
}

/** List every record in a collection section as `CollectionRecordInfo` rows:
 *  the list view's data source (spec: collections have no client "read"
 *  action, so this is what a host's server-fetch calls into). Reuses the same
 *  adapter construction as makeCollectionActions so the overlap guard and
 *  contentDir resolution can't drift between the read and write paths. */
export function listCollectionRecords(
  config: CmsConfig,
  section: CollectionSection,
  locale?: string
): CollectionRecordInfo[] {
  const adapter = makeCollectionAdapter(config, section);
  return adapter.listSlugs(locale).map((slug) => {
    const { meta, body } = adapter.parse(adapter.readRaw(slug, locale));
    return { slug, meta, body, hasDraft: adapter.hasDraft(slug, locale), locale };
  });
}
