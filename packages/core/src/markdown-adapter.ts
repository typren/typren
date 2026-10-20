import fs from "node:fs";
import path from "node:path";
import { parseMatter, stringifyMatter } from "./safe-matter";
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
/** `createMarkdownAdapter`'s return type: `ContentAdapter` plus the one extra
 *  the fs-backed adapter can offer that a network-backed one can't -- an
 *  absolute on-disk root, for callers that need to site something beside it
 *  (the `.typren/` settings dir, a collection's dir-overlap guard). Kept off
 *  `ContentAdapter` itself (see that interface's doc comment) since neither
 *  the GitHub nor Notion adapter has a real filesystem path to report. */
export type MarkdownAdapter = ContentAdapter & { readonly root: string };

// BCP-47-ish: a primary subtag of 2-3 letters, then any number of 2-8
// alphanumeric extension subtags. The `locales` allowlist itself becomes a
// path segment (localeSubdir/localeDir below), so membership in `locales` is
// NOT by itself a traversal guard if the configured array can hold an
// unsafe entry (e.g. a `typren.config.json` or host config built from
// untrusted input) -- "../../x" would pass `locales.includes(loc)` just fine.
const SAFE_LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function createMarkdownAdapter({
  contentDir,
  draftDir,
  frontmatterKey = "slices",
  defaultLocale = "en",
  locales = [defaultLocale],
  draftSubdir = ".drafts",
  requireSliceArray = true,
}: MarkdownAdapterOptions): MarkdownAdapter {
  for (const loc of [defaultLocale, ...locales]) {
    if (!SAFE_LOCALE.test(loc)) throw new Error(`typren: unsafe locale "${loc}" (expected a BCP-47-ish code)`);
  }
  // Slugs flow in from client actions and become filesystem paths. Reject
  // anything that isn't a plain slug so "../" can't escape the content dir.
  const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/i;
  const safe = (slug: string) => {
    if (!SAFE_SLUG.test(slug)) throw new Error(`typren: unsafe slug "${slug}"`);
    return slug;
  };
  // The locale is also a path segment (a trust boundary), so the allowlist check
  // is the primary traversal guard for it, not the slug regex (the SAFE_LOCALE
  // check above guards the allowlist's own entries).
  const safeLocale = (loc: string) => {
    if (!locales.includes(loc)) throw new Error(`typren: unknown locale "${loc}"`);
    return loc;
  };
  const defaultDraftDir = draftDir ?? path.join(contentDir, draftSubdir);

  // Default locale → flat at contentDir; non-default → contentDir/<locale>.
  const localeDir = (loc: string) => path.join(contentDir, localeSubdir(safeLocale(loc), defaultLocale));
  const localeDraftDir = (loc: string) =>
    loc === defaultLocale ? defaultDraftDir : path.join(localeDir(loc), draftSubdir);
  // A symlink planted in the content tree (a merged PR can add one) would turn
  // slug reads and writes into access to any file the server can reach. Every
  // component below the root is lstat'ed, so a linked file, locale dir or
  // .drafts dir is refused; only the root itself may be reached via a link.
  const contained = (target: string, root: string) => {
    const rel = path.relative(root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`typren: content path escapes its root`);
    let p = root;
    for (const seg of rel.split(path.sep).filter(Boolean)) {
      p = path.join(p, seg);
      let st: fs.Stats | undefined;
      try {
        st = fs.lstatSync(p);
      } catch {
        break; // absent (or unreadable): nothing below it can be a link
      }
      if (st.isSymbolicLink()) throw new Error(`typren: refusing symlinked content path "${path.relative(root, p)}"`);
    }
    return target;
  };
  // A custom draftDir inside contentDir is checked from contentDir, so a linked
  // `.drafts` cannot become its own trusted root.
  const draftRootOutside = draftDir !== undefined && path.relative(contentDir, draftDir).startsWith("..");
  const draftRoot = (loc: string) => (loc === defaultLocale && draftRootOutside ? draftDir! : contentDir);
  const pageFile = (slug: string, loc = defaultLocale) =>
    contained(path.join(localeDir(loc), `${safe(slug)}.md`), contentDir);
  const draftFile = (slug: string, loc = defaultLocale) =>
    contained(path.join(localeDraftDir(loc), `${safe(slug)}.md`), draftRoot(loc));

  const parse = (raw: string): PageContent => {
    const { data, content } = parseMatter(raw);
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
    stringifyMatter(page.body ?? "", { ...page.meta, [frontmatterKey]: page.slices });

  return {
    locales,
    defaultLocale,
    root: path.resolve(contentDir),
    parse,
    serialize,

    async listSlugs(locale = defaultLocale) {
      const dir = contained(localeDir(locale), contentDir);
      if (!fs.existsSync(dir)) return []; // a locale with no content yet
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        // A shared content dir can hold files whose names aren't valid slugs
        // (site_backup.md, "About Us.md"). They can never be addressed through
        // the slug guard anyway, so skip them here rather than letting safe()
        // throw below and take the whole listing down with them.
        .filter((slug) => SAFE_SLUG.test(slug))
        // Only pages that actually carry a slice array: skips site.md, legal
        // bodies, etc. without a hardcoded exclude list. Collections opt out:
        // every .md in a collection dir is a record, slices or not.
        .filter(
          (slug) =>
            !requireSliceArray ||
            Array.isArray(parseMatter(fs.readFileSync(pageFile(slug, locale), "utf8")).data[frontmatterKey])
        )
        .sort((a, b) => a.localeCompare(b));
    },

    async listLocales(slug) {
      return locales.filter((l) => fs.existsSync(pageFile(slug, l)));
    },

    async exists(slug, locale) {
      return fs.existsSync(pageFile(slug, locale));
    },
    async readRaw(slug, locale) {
      return fs.readFileSync(pageFile(slug, locale), "utf8");
    },
    async writeRaw(slug, raw, locale) {
      const file = pageFile(slug, locale);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, raw);
    },
    async deletePublished(slug, locale) {
      if (fs.existsSync(pageFile(slug, locale))) fs.rmSync(pageFile(slug, locale));
    },

    async readDraftRaw(slug, locale) {
      return fs.existsSync(draftFile(slug, locale)) ? fs.readFileSync(draftFile(slug, locale), "utf8") : null;
    },
    async writeDraftRaw(slug, raw, locale) {
      const file = draftFile(slug, locale);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, raw);
    },
    async deleteDraft(slug, locale) {
      if (fs.existsSync(draftFile(slug, locale))) fs.rmSync(draftFile(slug, locale));
    },
    async hasDraft(slug, locale) {
      return fs.existsSync(draftFile(slug, locale));
    },
  };
}
