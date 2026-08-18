import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ContentAdapter, PageContent, Slice } from "./types";
import { localeSubdir } from "./localize";

export type MarkdownAdapterOptions = {
  /** Absolute path to the directory of `<slug>.md` page files (the DEFAULT
   *  locale lives flat here; non-default locales live under `<locale>/`). */
  contentDir: string;
  /** Absolute path where the default locale's draft `<slug>.md` files are
   *  written. Defaults to `<contentDir>/<draftSubdir>`. Non-default locales
   *  always draft under `<contentDir>/<locale>/<draftSubdir>`. */
  draftDir?: string;
  /** Frontmatter key holding the slice array (default "slices"). */
  frontmatterKey?: string;
  /** Locale allowlist. Defaults to `[defaultLocale]` (single-locale). */
  locales?: string[];
  /** Default locale. Served flat + unprefixed. Defaults to "en". */
  defaultLocale?: string;
  /** Draft subdirectory name (default ".drafts"). */
  draftSubdir?: string;
  /** Whether `listSlugs` only counts files that already carry a slice array
   *  under `frontmatterKey` (default true).
   *
   *  That filter is a Pages-section heuristic: the Pages dir is shared with
   *  non-page markdown (site.md, legal bodies), and carrying a slice array is
   *  what distinguishes an editable page without a hardcoded exclude list. A
   *  *collection* dir has no such mixture: every `.md` in it is a record, and
   *  records are frontmatter + prose that may legitimately have no slices at
   *  all, so collections set this to false (see makeCollectionAdapter). */
  requireSliceArray?: boolean;
};

/**
 * Filesystem + gray-matter adapter. A page's frontmatter carries the slice
 * array under `frontmatterKey`; everything else in the frontmatter is preserved
 * as `meta`, and the markdown body is preserved verbatim, so publish is a
 * lossless round-trip (modulo YAML reformatting: the CMS owns the file format
 * once a page is edited through it).
 *
 * Locale is purely a path prefix: the default locale lives flat at `contentDir`
 * (so a single-locale site needs no file moves and is byte-identical), and
 * non-default locales live under `contentDir/<locale>/`. `parse`/`serialize`
 * are locale-agnostic. The locale never enters the file.
 */
export function createMarkdownAdapter({
  contentDir,
  draftDir,
  frontmatterKey = "slices",
  defaultLocale = "en",
  locales = [defaultLocale],
  draftSubdir = ".drafts",
  requireSliceArray = true,
}: MarkdownAdapterOptions): ContentAdapter {
  // Slugs flow in from client actions and become filesystem paths. Reject
  // anything that isn't a plain slug so "../" can't escape the content dir.
  const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/i;
  const safe = (slug: string) => {
    if (!SAFE_SLUG.test(slug)) throw new Error(`typren: unsafe slug "${slug}"`);
    return slug;
  };
  // The locale is also a path segment (a trust boundary), so the allowlist check
  // is the primary traversal guard for it, not the slug regex.
  const safeLocale = (loc: string) => {
    if (!locales.includes(loc)) throw new Error(`typren: unknown locale "${loc}"`);
    return loc;
  };
  const defaultDraftDir = draftDir ?? path.join(contentDir, draftSubdir);

  // Default locale → flat at contentDir; non-default → contentDir/<locale>.
  const localeDir = (loc: string) => path.join(contentDir, localeSubdir(safeLocale(loc), defaultLocale));
  const localeDraftDir = (loc: string) =>
    loc === defaultLocale ? defaultDraftDir : path.join(localeDir(loc), draftSubdir);
  const pageFile = (slug: string, loc = defaultLocale) => path.join(localeDir(loc), `${safe(slug)}.md`);
  const draftFile = (slug: string, loc = defaultLocale) => path.join(localeDraftDir(loc), `${safe(slug)}.md`);

  const parse = (raw: string): PageContent => {
    const { data, content } = matter(raw);
    const { [frontmatterKey]: slices, ...meta } = data;
    // gray-matter caches parsed results by input string and returns shared
    // references. Deep-clone the result so editing the returned content can never mutate
    // that cache (which would corrupt later reads of the same source).
    return structuredClone({
      meta,
      slices: (Array.isArray(slices) ? slices : []) as Slice[],
      body: content,
    });
  };

  const serialize = (page: PageContent): string =>
    // gray-matter puts the YAML delimiters back and dumps frontmatter via js-yaml.
    matter.stringify(page.body ?? "", { ...page.meta, [frontmatterKey]: page.slices });

  return {
    locales,
    defaultLocale,
    root: path.resolve(contentDir),
    parse,
    serialize,

    listSlugs(locale = defaultLocale) {
      const dir = localeDir(locale);
      if (!fs.existsSync(dir)) return []; // a locale with no content yet
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        // Only pages that actually carry a slice array: skips site.md, legal
        // bodies, etc. without a hardcoded exclude list. Collections opt out:
        // every .md in a collection dir is a record, slices or not.
        .filter(
          (slug) =>
            !requireSliceArray ||
            Array.isArray(matter(fs.readFileSync(pageFile(slug, locale), "utf8")).data[frontmatterKey])
        )
        .sort((a, b) => a.localeCompare(b));
    },

    listLocales: (slug) => locales.filter((l) => fs.existsSync(pageFile(slug, l))),

    exists: (slug, locale) => fs.existsSync(pageFile(slug, locale)),
    readRaw: (slug, locale) => fs.readFileSync(pageFile(slug, locale), "utf8"),
    writeRaw: (slug, raw, locale) => {
      fs.mkdirSync(localeDir(locale ?? defaultLocale), { recursive: true });
      fs.writeFileSync(pageFile(slug, locale), raw);
    },
    deletePublished: (slug, locale) => {
      if (fs.existsSync(pageFile(slug, locale))) fs.rmSync(pageFile(slug, locale));
    },

    readDraftRaw: (slug, locale) =>
      fs.existsSync(draftFile(slug, locale)) ? fs.readFileSync(draftFile(slug, locale), "utf8") : null,
    writeDraftRaw: (slug, raw, locale) => {
      fs.mkdirSync(localeDraftDir(locale ?? defaultLocale), { recursive: true });
      fs.writeFileSync(draftFile(slug, locale), raw);
    },
    deleteDraft: (slug, locale) => {
      if (fs.existsSync(draftFile(slug, locale))) fs.rmSync(draftFile(slug, locale));
    },
    hasDraft: (slug, locale) => fs.existsSync(draftFile(slug, locale)),
  };
}
