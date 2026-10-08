import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import type { ContentStore } from "./store";
import type { RedirectEntry } from "./redirects";

// gray-matter's default engine set includes `javascript`, which eval()s the
// front-matter block when a file opens with `---javascript`. Here that would
// be code execution inside whatever process scans the content directory,
// triggered by a markdown file, a pipeline's untrusted-writer input. Content
// is data: refuse the engine outright.
const SAFE_ENGINES = {
  javascript: (): never => {
    throw new Error("typren: javascript front-matter is not supported");
  },
};
const parseMatter = (raw: string) => matter(raw, { engines: SAFE_ENGINES });

/**
 * Minimal read-only `ContentStore` built by scanning a content directory's
 * flat `*.md` files directly, rather than importing a host's `cms.config.ts`
 * (which imports "server-only" and throws outside a React Server Component
 * build, the same constraint `typren review`'s `listCmsPageSlugs`/`parsePage`
 * in packages/cli work around, mirrored here). Only `listPages`/`getPublished`
 * are real; `buildRedirects` (this module's only caller) needs nothing else.
 *
 * ponytail: default-locale, flat-file layout only, same scope `typren review`
 * already covers. No draft/i18n/collection support: a redirects sync doesn't
 * need it, and buildRedirects itself is single-locale (see redirects.ts).
 */
export function scanContentStore(contentDir: string): ContentStore {
  const slugs = fs.existsSync(contentDir)
    ? fs
        .readdirSync(contentDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        .filter((slug: string) => Array.isArray(parseMatter(fs.readFileSync(path.join(contentDir, `${slug}.md`), "utf8")).data.slices))
    : [];

  const notSupported = (op: string) => (): never => {
    throw new Error(`typren: scanContentStore is read-only, "${op}" is not supported`);
  };

  return {
    listPages: () => slugs.map((slug) => ({ slug, title: slug, hasDraft: false, locales: ["default"] })),
    getPublished: (slug: string) => {
      const { data } = parseMatter(fs.readFileSync(path.join(contentDir, `${slug}.md`), "utf8"));
      // The `slices` key is left in `meta` here (unlike packages/cli's parsePage,
      // which splits it out for its own diffing needs), buildRedirects only
      // ever reads `meta.aliases`, so there's nothing to gain from stripping it.
      return { meta: data as Record<string, unknown>, slices: [], body: "", locale: "default", isFallback: false };
    },
    getDraft: () => null,
    currentVersion: () => null,
    saveDraft: notSupported("saveDraft"),
    discardDraft: notSupported("discardDraft"),
    publish: async () => notSupported("publish")(),
    createPage: notSupported("createPage"),
    renamePage: notSupported("renamePage"),
    duplicatePage: notSupported("duplicatePage"),
    createTranslation: notSupported("createTranslation"),
    deletePage: notSupported("deletePage"),
    deleteTranslation: notSupported("deleteTranslation"),
  };
}

/** One entry in a host-supplied redirect map file: an incoming on-site path
 *  and where it should 301 to (an on-site path or an absolute http(s) URL). */
export type RedirectMapEntry = { from: string; to: string };

const normalize = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

const isExternal = (to: string): boolean => to.startsWith("https://") || to.startsWith("http://");

// Whitespace, control chars and backslash never belong in a redirect path:
// CR/LF is header injection when the value reaches a Location header, and
// WHATWG URL parsers treat "\" as "/" after a special scheme, so "/\evil"
// resolves protocol-relative off-site. Same class buildRedirects rejects for
// frontmatter aliases.
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const UNSAFE_CHARS = /[\s\x00-\x1f\x7f\\]/;

/**
 * Loads a host-supplied redirect map file into validated `RedirectEntry[]`,
 * the same shape `buildRedirects` emits, so both sources merge into one
 * sync. This is what makes a host's redirect sync useful beyond a typren
 * site: frontmatter aliases describe pages that exist in a content store,
 * while a map file carries everything else a real site accumulates (legacy
 * platform URLs, removed pages, paths that moved off-site entirely).
 *
 * Formats, by extension:
 *   - `.json`: an array of `{ "from": "/old", "to": "/new-or-https-url" }`
 *   - `.mjs`/`.js`: a module whose default export (or a named `REDIRECTS` /
 *     `redirects` export) is that same array. A config module may compute its
 *     entries; the JSON form exists for hosts that would rather not execute
 *     code from the map.
 *
 * Validation (fail loud, never silently drop, matching buildRedirects):
 * `from` must be an absolute on-site path; `to` must be an absolute on-site
 * path or an absolute http(s) URL; duplicate `from`s (after trailing-slash
 * normalization) throw. Entry `slug`s carry the map file's name so a merge
 * collision names its source.
 */
export async function loadRedirectMap(cwd: string, file: string): Promise<RedirectEntry[]> {
  const resolved = path.resolve(cwd, file);
  if (!fs.existsSync(resolved)) throw new Error(`typren: map file not found: ${resolved}`);

  const raw = await readEntries(resolved);
  if (!Array.isArray(raw)) throw new Error(`typren: ${file} must export an array of { from, to } entries`);

  const slug = `map:${path.basename(file)}`;
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const { from, to } = (entry ?? {}) as Partial<RedirectMapEntry>;
    if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || UNSAFE_CHARS.test(from)) {
      throw new Error(`typren: ${file} entry ${i}: 'from' must be an absolute on-site path, got ${JSON.stringify(from)}`);
    }
    if (typeof to !== "string" || to.length === 0 || (!to.startsWith("/") && !isExternal(to)) || UNSAFE_CHARS.test(to)) {
      throw new Error(`typren: ${file} entry ${i}: 'to' must be an absolute path or http(s) URL (from ${from})`);
    }
    // "//host" is protocol-relative: a browser resolves it OFF-site while it
    // reads like an on-site path in review; the reviewer signal an explicit
    // https:// target gives is exactly what it bypasses.
    if (to.startsWith("//")) {
      throw new Error(`typren: ${file} entry ${i}: 'to' must not be protocol-relative (from ${from})`);
    }
    const key = normalize(from);
    if (seen.has(key)) throw new Error(`typren: ${file} declares ${key} twice`);
    seen.add(key);
    // External targets stay verbatim; on-site targets get the same slashless
    // normalization buildRedirects applies, so toRedirectPairs canonicalizes
    // both sources identically.
    const target = isExternal(to) ? to : normalize(to);
    // A self-redirect syncs clean and then 301-loops at the edge forever, and
    // browsers cache 301s. Same guard buildRedirects applies to frontmatter
    // aliases.
    if (!isExternal(to) && target === key) {
      throw new Error(`typren: ${file} entry ${i}: ${key} redirects to itself`);
    }
    return { from: key, to: target, slug };
  });
}

async function readEntries(resolved: string): Promise<unknown> {
  if (resolved.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }
  if (resolved.endsWith(".mjs") || resolved.endsWith(".js")) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(resolved).href)) as Record<string, unknown>;
    return mod.default ?? mod.REDIRECTS ?? mod.redirects;
  }
  throw new Error(`typren: unsupported map format "${path.extname(resolved)}" (use .json, .mjs or .js)`);
}

/**
 * Merges content-derived entries with map-file entries, refusing a `from`
 * claimed by both sources (a silent override in either direction would make
 * one source's edit mysteriously not take effect) and a map `from` that
 * shadows a live page's canonical path (which would 301 a real page away;
 * the same guard buildRedirects applies to frontmatter aliases, which the
 * map path would otherwise bypass). `pagePaths` are the canonical public
 * paths of the scanned pages; pass nothing when there is no content store to
 * shadow.
 */
export function mergeRedirectEntries(content: RedirectEntry[], map: RedirectEntry[], pagePaths: string[] = []): RedirectEntry[] {
  const bySource = new Map(content.map((e) => [e.from, e.slug]));
  const pages = new Set(pagePaths.map(normalize));
  for (const entry of map) {
    const owner = bySource.get(entry.from);
    if (owner) {
      throw new Error(`typren: ${entry.from} is declared by both "${owner}" (frontmatter) and "${entry.slug}"`);
    }
    if (pages.has(entry.from)) {
      throw new Error(`typren: ${entry.slug} redirects ${entry.from}, which is a live page's own path`);
    }
  }
  return [...content, ...map];
}

export type ToRedirectPairsOptions = {
  /** Append the canonical trailing slash to on-site page targets (the
   *  `trailingSlash: true` static-export shape, and the default). A site
   *  whose canonical URLs are the bare form passes `false` and targets are
   *  emitted verbatim. */
  appendSlash?: boolean;
};

/**
 * Converts validated `RedirectEntry[]` into the key/value pairs a host's
 * redirect store wants: the `from` percent-encoded (the form an edge sees a
 * request path in) and the `to` canonicalized to the site's trailing-slash
 * convention. Host-agnostic; a vendor-specific byte-limit check (CloudFront's
 * KVS, say) belongs at the emitter that knows about it, not here (see
 * `@typren/adapter-cloudfront`'s `toKvsEntries`, a thin wrapper around this).
 */
export function toRedirectPairs(entries: RedirectEntry[], opts: ToRedirectPairsOptions = {}): { key: string; value: string }[] {
  const appendSlash = opts.appendSlash !== false;
  return entries.map(({ from, to }) => ({
    key: encodeURI(from),
    value: appendSlash ? canonicalTarget(to) : to,
  }));
}

function canonicalTarget(to: string): string {
  if (!to.startsWith("/")) return to; // external URL, verbatim
  const cut = to.search(/[?#]/);
  const pathname = cut === -1 ? to : to.slice(0, cut);
  const rest = cut === -1 ? "" : to.slice(cut);
  if (pathname === "/" || pathname.endsWith("/")) return pathname + rest;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return pathname + rest; // a file object, not a page
  return `${pathname}/${rest}`;
}
