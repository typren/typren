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
export type MarkdownAdapter = ContentAdapter & {
  readonly root: string;
  /** Absolute path of a page's published file, slug- and locale-checked like
   *  every read. A git-backed host commits exactly this file. */
  pageFile(slug: string, locale?: string): string;
  /** Absolute path of a folder's marker file, checked like `pageFile`. A
   *  git-backed host commits it so an empty folder survives a clone. */
  folderFile(folder: string, locale?: string): string;
  /** Absolute path of a page's draft file, checked like `pageFile`. */
  draftFile(slug: string, locale?: string): string;
  listFolders(locale?: string): Promise<string[]>;
  createFolder(folder: string, locale?: string): Promise<void>;
  deleteFolder(folder: string, locale?: string): Promise<void>;
};

/** The file that keeps an empty page folder (see `createFolder`). A name of
 *  Typren's own, not `.gitkeep`: a `.gitkeep` a developer placed means
 *  nothing to the editor, and deleting a folder must never remove one. */
export const FOLDER_MARKER = ".typren-folder";

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
  // anything that isn't a plain slug, or plain segments joined by "/" (a
  // nested page, `event/1`), so "../" can't escape the content dir.
  const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/i;
  const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/i;
  // A nested slug's first segment is a directory beside the locale and draft
  // directories, so it must not be one of them: `es/about` would otherwise be
  // the Spanish `about`, and `drafts/x` a draft under a dotless draftSubdir.
  // Lowercased, since a case-insensitive filesystem would still collide.
  const draftRel = draftDir === undefined ? "" : path.relative(contentDir, draftDir);
  const reserved = new Set(
    [...locales.filter((l) => l !== defaultLocale), draftSubdir, draftRel.split(path.sep)[0]].map((s) => s.toLowerCase())
  );
  const safe = (slug: string) => {
    if (!SAFE_SLUG.test(slug) || (slug.includes("/") && reserved.has(slug.split("/")[0].toLowerCase())))
      throw new Error(`typren: unsafe slug "${slug}"`);
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
    // Lexically under root already: safe() and safeLocale() rule out "..".
    let p = root;
    for (const seg of path.relative(root, target).split(path.sep).filter(Boolean)) {
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
  const draftRootOutside = draftRel === ".." || draftRel.startsWith(`..${path.sep}`) || path.isAbsolute(draftRel);
  const draftRoot = (loc: string) => (loc === defaultLocale && draftRootOutside ? draftDir! : contentDir);
  const pageFile = (slug: string, loc = defaultLocale) =>
    contained(path.join(localeDir(loc), `${safe(slug)}.md`), contentDir);
  const draftFile = (slug: string, loc = defaultLocale) =>
    contained(path.join(localeDraftDir(loc), `${safe(slug)}.md`), draftRoot(loc));

  // Every `.md` under `dir` as a slug, nested ones joined by "/". Dirent
  // types are not followed, so a symlinked file or directory is never listed.
  // Directories that are not slug segments (`.drafts`, `.git`) are skipped,
  // and so are the reserved ones at the top (locale and draft directories).
  // Files whose names aren't valid slugs (site_backup.md, "About Us.md") can
  // never be addressed through the slug guard, so they are skipped rather
  // than letting safe() throw later and take the whole listing down.
  // ponytail: a synchronous full walk per listing; cache or index it once a
  // content tree is large enough for the Pages list to feel slow.
  // `pick` maps a file name to what it contributes to its directory's
  // prefix, or null to skip it.
  const walk = (dir: string, pick: (name: string) => string | null, prefix = ""): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isFile()) {
        const name = pick(e.name);
        return name === null ? [] : [prefix + name];
      }
      if (!e.isDirectory() || !SAFE_SEGMENT.test(e.name) || (!prefix && reserved.has(e.name.toLowerCase()))) return [];
      return walk(path.join(dir, e.name), pick, `${prefix}${e.name}/`);
    });
  const pageName = (name: string) =>
    name.endsWith(".md") && SAFE_SEGMENT.test(name.slice(0, -3)) ? name.slice(0, -3) : null;
  // A folder lives beside the locale and draft directories even at the top,
  // so unlike a page its first segment is always checked against them.
  const folderFile = (folder: string, loc = defaultLocale) => {
    if (reserved.has(safe(folder).split("/")[0].toLowerCase())) throw new Error(`typren: unsafe slug "${folder}"`);
    return contained(path.join(localeDir(loc), folder, FOLDER_MARKER), contentDir);
  };

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
    pageFile,
    folderFile,
    draftFile,
    parse,
    serialize,

    async listSlugs(locale = defaultLocale) {
      const dir = contained(localeDir(locale), contentDir);
      if (!fs.existsSync(dir)) return []; // a locale with no content yet
      return walk(dir, pageName)
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
    async listDraftSlugs(locale = defaultLocale) {
      const dir = contained(localeDraftDir(locale), draftRoot(locale));
      return fs.existsSync(dir) ? walk(dir, pageName).sort((a, b) => a.localeCompare(b)) : [];
    },
    async listFolders(locale = defaultLocale) {
      const dir = contained(localeDir(locale), contentDir);
      if (!fs.existsSync(dir)) return [];
      return walk(dir, (name) => (name === FOLDER_MARKER ? "" : null))
        .filter(Boolean)
        .map((f) => f.slice(0, -1))
        .sort((a, b) => a.localeCompare(b));
    },
    async createFolder(folder, locale) {
      const file = folderFile(folder, locale);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, "");
    },
    async deleteFolder(folder, locale) {
      const file = folderFile(folder, locale);
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) return;
      if (fs.readdirSync(dir).some((name) => name !== FOLDER_MARKER))
        throw new Error(`typren: folder "${folder}" is not empty`);
      if (fs.existsSync(file)) fs.rmSync(file);
      fs.rmdirSync(dir);
    },
  };
}
