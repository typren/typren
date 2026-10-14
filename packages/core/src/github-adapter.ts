import path from "node:path";
import matter from "gray-matter";
import type { ContentAdapter, PageContent, Slice } from "./types";
import { localeSubdir } from "./localize";
import { ConflictError } from "./version";

const GITHUB_API = "https://api.github.com";

// Defense-in-depth even inside an allowed root: a future GitHub-backed
// MediaAdapter accepts arbitrary uploaded filenames it can't regex-constrain
// the way a page slug is, so these basenames are rejected everywhere, not
// just at the repo root where they'd normally live.
const MANIFEST_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "tsconfig.json",
  "composer.json",
  "go.mod",
  "cargo.toml",
]);

/**
 * True when `relPath` (repo-relative, forward-slash) safely resolves inside
 * one of `allowedRoots` (also repo-relative). Rejects `..`, absolute paths,
 * any dotfile/dot-dir path segment (which subsumes `.github/`), and
 * well-known manifest filenames. Per this repo's convention an adapter owns
 * its own trust boundary rather than inheriting the fs adapter's guard, so
 * this is checked independently of (and in addition to) the slug allowlist
 * every public method also applies.
 */
export function isAllowedRepoPath(relPath: string, allowedRoots: string[]): boolean {
  if (path.posix.isAbsolute(relPath)) return false;
  const normalized = path.posix.normalize(relPath);
  if (normalized === ".." || normalized.startsWith("../")) return false;
  if (normalized.split("/").some((segment) => segment.startsWith("."))) return false;
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  if (MANIFEST_BASENAMES.has(basename)) return false;
  return allowedRoots.some((root) => {
    const normalizedRoot = path.posix.normalize(root);
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

export type GithubAdapterOptions = {
  owner: string;
  repo: string;
  /** Installation access token. Minting/refreshing it (App JWT -> installation
   *  token exchange) is entirely the caller's job -- this adapter takes only
   *  the short-lived (~1h) token as plain config and never does App/JWT logic
   *  itself (docs/hosted-platform.md: "GitHub App, never an OAuth App"). A
   *  new token means a new adapter instance; this one never re-derives or
   *  caches credentials. */
  token: string;
  /** Branch every read/write targets. Default "main". This adapter always
   *  commits directly to it -- PR-based writes (the doc's cloud-tier
   *  default under "Content PRs as the cloud default") are a caller-level
   *  policy this adapter doesn't implement. Point `branch` at a working
   *  branch and open the PR outside this adapter for that. */
  branch?: string;
  /** Repo-relative directory page files live under. Default "content". */
  contentDir?: string;
  /** Repo-relative media directory. No method here writes to it today (this
   *  is a ContentAdapter, not a MediaAdapter) -- it's accepted so the same
   *  write-path allowlist boundary (`isAllowedRepoPath`) can be validated
   *  against both roots ahead of a future GitHub-backed MediaAdapter reusing
   *  it. Default "public/img". */
  mediaDir?: string;
  /** Frontmatter key holding the slice array. Default "slices". */
  frontmatterKey?: string;
  /** Locale allowlist. Defaults to `[defaultLocale]`. */
  locales?: string[];
  /** Default locale, served flat + unprefixed. Defaults to "en". */
  defaultLocale?: string;
  /** Draft subdirectory name. Default "_drafts" -- NOT markdown-adapter's
   *  ".drafts": this adapter's own write-path allowlist rejects dotfile/
   *  dot-dir path segments (see `isAllowedRepoPath`), so a dot-prefixed
   *  default would make every draft write reject itself. "_" is this repo's
   *  existing convention for a reserved/internal name (see
   *  fs-media-adapter.ts's `_manifest-` prefix). Kept deliberately distinct
   *  from the fs adapter's own default rather than unified with it (issue
   *  #29): the dotfile rule is a real security boundary for this adapter
   *  (keeps a draft write from ever landing in `.github/` or another
   *  dot-prefixed path GitHub treats specially), not an arbitrary naming
   *  choice to reconcile. */
  draftSubdir?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Merged into every GET's `RequestInit` (content reads only, never writes).
   *  Lets a host attach its own fetch-cache tags/options, e.g. Next's
   *  `{ next: { tags: [...] } }`, so a push webhook can invalidate the host's
   *  cache for this adapter's reads (see the `@typren/core/github-webhook`
   *  subpath). Never set this on the editor's own adapter instance: draft
   *  reads must always be fresh, a cached draft read would show a stale
   *  version of exactly the content someone is actively editing.
   *  ponytail: one site-wide cache tag is the common case; a host needing
   *  per-slug invalidation granularity passes a `relPath`-keyed tag itself
   *  (this hook already gets `relPath`), cheaper than this adapter inventing
   *  a tagging scheme. */
  readInit?: (relPath: string) => RequestInit | undefined;
};

type GithubContentsGetResponse = { type: string; content: string; encoding: string; sha: string };
type GithubContentsListEntry = { type: string; name: string };
type GithubContentsPutResponse = { content: { sha: string } };

/**
 * GitHub Contents API adapter. Mirrors `markdown-adapter.ts`'s factory shape
 * and locale layout (default locale flat at `contentDir`, others under
 * `contentDir/<locale>/`, drafts under `.../<draftSubdir>`). Implements
 * `ContentAdapter` natively: every method does real network I/O and returns a
 * promise, the same shape the interface itself now requires (issue #29).
 *
 * The CAS story lands on top of that: every write here does an
 * immediate read-sha-then-write, and the PUT is atomically compare-and-swapped
 * server-side by GitHub against the sha it's given -- a real CAS, not the fs
 * adapter's unconditional overwrite. That's the shape store.ts's own
 * `saveDraft` ponytail note asks for ("an atomic adapter ... moves the
 * compare into the adapter via an optional expectedVersion hook").
 */
export function createGithubAdapter({
  owner,
  repo,
  token,
  branch = "main",
  contentDir = "content",
  mediaDir = "public/img",
  frontmatterKey = "slices",
  defaultLocale = "en",
  locales = [defaultLocale],
  draftSubdir = "_drafts",
  fetchImpl = fetch,
  readInit,
}: GithubAdapterOptions): ContentAdapter {
  const allowedRoots = [contentDir, mediaDir];

  // Slugs flow in from client actions; reject anything that isn't a plain
  // slug so "../" (or a dotfile/manifest name) can't even be assembled into
  // a path, same guard markdown-adapter.ts applies.
  const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/i;
  const safe = (slug: string) => {
    if (!SAFE_SLUG.test(slug)) throw new Error(`typren: unsafe slug "${slug}"`);
    return slug;
  };
  const safeLocale = (loc: string) => {
    if (!locales.includes(loc)) throw new Error(`typren: unknown locale "${loc}"`);
    return loc;
  };

  const localeDir = (loc: string) => path.posix.join(contentDir, localeSubdir(safeLocale(loc), defaultLocale));
  const localeDraftDir = (loc: string) =>
    loc === defaultLocale ? path.posix.join(contentDir, draftSubdir) : path.posix.join(localeDir(loc), draftSubdir);
  const pagePath = (slug: string, loc = defaultLocale) => path.posix.join(localeDir(loc), `${safe(slug)}.md`);
  const draftPath = (slug: string, loc = defaultLocale) => path.posix.join(localeDraftDir(loc), `${safe(slug)}.md`);

  // Independent check even though `safe()`/`safeLocale()` already constrain
  // slug and locale to characters that can't produce a traversal: an adapter
  // owns its own trust boundary rather than relying on a sibling guard.
  const assertAllowed = (relPath: string) => {
    if (!isAllowedRepoPath(relPath, allowedRoots))
      throw new Error(`typren: path "${relPath}" is outside the allowed write roots`);
    return relPath;
  };

  // relPath -> last-known blob sha, populated on every successful read/write
  // and consulted (not re-fetched) on the next write to the same path. A
  // cold cache still gets a fresh GET immediately before the PUT, so every
  // write is CAS'd against GitHub's server-side check either way.
  const shaCache = new Map<string, string>();

  // Same endpoint for a file or a directory listing -- GitHub's Contents API
  // returns an object for the former, an array for the latter.
  const apiUrl = (relPath: string) =>
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${relPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`;

  const githubFetch = (url: string, init?: RequestInit) =>
    fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
    });

  /** GET one file's content + sha. Returns null on 404. Caches the sha. */
  async function getFile(relPath: string): Promise<{ text: string; sha: string } | null> {
    assertAllowed(relPath);
    const res = await githubFetch(apiUrl(relPath), readInit?.(relPath));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`typren: GitHub read of "${relPath}" failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as GithubContentsGetResponse;
    if (data.type !== "file") throw new Error(`typren: "${relPath}" is a ${data.type}, not a file`);
    const text = Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    shaCache.set(relPath, data.sha);
    return { text, sha: data.sha };
  }

  /** PUT (create or update) one file. Compare-and-swaps against the cached
   *  sha (fetching one first when the cache is cold and the file might
   *  already exist); a sha GitHub rejects as stale throws `ConflictError`. */
  async function putFile(relPath: string, slug: string, text: string, message: string): Promise<void> {
    assertAllowed(relPath);
    let sha = shaCache.get(relPath);
    if (sha === undefined) sha = (await getFile(relPath))?.sha;

    const res = await githubFetch(apiUrl(relPath), {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(text, "utf8").toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.status === 409 || res.status === 422) {
      throw new ConflictError(slug, null, sha ?? "");
    }
    if (!res.ok) throw new Error(`typren: GitHub write to "${relPath}" failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as GithubContentsPutResponse;
    shaCache.set(relPath, data.content.sha);
  }

  /** DELETE one file. No-op (not an error) when it doesn't exist, matching
   *  the fs adapter's idempotent delete. */
  async function deleteFile(relPath: string, slug: string, message: string): Promise<void> {
    assertAllowed(relPath);
    let sha = shaCache.get(relPath);
    if (sha === undefined) sha = (await getFile(relPath))?.sha;
    if (sha === undefined) return; // already absent

    const res = await githubFetch(apiUrl(relPath), {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch }),
    });
    if (res.status === 409 || res.status === 422) throw new ConflictError(slug, null, sha);
    if (!res.ok && res.status !== 404)
      throw new Error(`typren: GitHub delete of "${relPath}" failed (${res.status}): ${await res.text()}`);
    shaCache.delete(relPath);
  }

  async function fileExists(relPath: string): Promise<boolean> {
    return (await getFile(relPath)) !== null;
  }

  const parse = (raw: string): PageContent => {
    const { data, content } = matter(raw);
    const { [frontmatterKey]: slices, ...meta } = data;
    return structuredClone({ meta, slices: (Array.isArray(slices) ? slices : []) as Slice[], body: content });
  };
  const serialize = (page: PageContent): string =>
    matter.stringify(page.body ?? "", { ...page.meta, [frontmatterKey]: page.slices });

  return {
    locales,
    defaultLocale,
    parse,
    serialize,

    // ponytail: the Contents API's directory listing caps at 1000 entries
    // and the response has no pagination for it. Fine for any realistic
    // Pages count; a site that actually hits the cap needs the Git Trees API
    // (`GET /git/trees/<branch>?recursive=1`, one call for the whole tree,
    // paginated) instead of this per-directory listing. Not implemented now.
    async listSlugs(locale: string = defaultLocale): Promise<string[]> {
      const dir = localeDir(locale);
      assertAllowed(dir);
      const res = await githubFetch(apiUrl(dir), readInit?.(dir));
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`typren: GitHub list of "${dir}" failed (${res.status}): ${await res.text()}`);
      const entries = (await res.json()) as GithubContentsListEntry[];
      return entries
        .filter((e) => e.type === "file" && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        .sort((a, b) => a.localeCompare(b));
    },

    async listLocales(slug: string): Promise<string[]> {
      const found = await Promise.all(locales.map(async (l) => ((await fileExists(pagePath(slug, l))) ? l : null)));
      return found.filter((l): l is string => l !== null);
    },

    // Every method here is `async`, not just the ones that look like they
    // need it: `pagePath`/`draftPath` validate the slug/locale synchronously
    // (throw, not reject) before the first real `await`, so a plain arrow
    // function returning `somePromise(...)` would let that throw escape as
    // a synchronous exception instead of a rejected promise. `async` gives
    // every method a uniform "always returns a promise, never throws
    // synchronously" contract, which is what a caller doing
    // `await adapter.writeRaw(...)` (as store.ts does) can rely on.
    exists: async (slug: string, locale?: string) => fileExists(pagePath(slug, locale)),
    readRaw: async (slug: string, locale?: string) => {
      const file = await getFile(pagePath(slug, locale));
      if (file === null) throw new Error(`typren: "${slug}" does not exist`);
      return file.text;
    },
    writeRaw: async (slug: string, raw: string, locale?: string) =>
      putFile(pagePath(slug, locale), slug, raw, `content: publish ${slug}`),
    deletePublished: async (slug: string, locale?: string) =>
      deleteFile(pagePath(slug, locale), slug, `content: delete ${slug}`),

    readDraftRaw: async (slug: string, locale?: string) => (await getFile(draftPath(slug, locale)))?.text ?? null,
    writeDraftRaw: async (slug: string, raw: string, locale?: string) =>
      putFile(draftPath(slug, locale), slug, raw, `content: draft ${slug}`),
    deleteDraft: async (slug: string, locale?: string) =>
      deleteFile(draftPath(slug, locale), slug, `content: discard draft ${slug}`),
    hasDraft: async (slug: string, locale?: string) => fileExists(draftPath(slug, locale)),
  };
}
