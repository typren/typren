import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { mediaRefSwapper } from "./actions";
import { SITE_SLUG } from "./nav";
import type { AuthAdapter } from "./auth-adapter";
import { createFsMediaAdapter } from "./fs-media-adapter";
import { commitOrRestore, createGitRepo } from "./git";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createFsSettingsAdapter } from "./settings";
import type { StyleMap } from "./style";
import type { CmsConfig, ContentAdapter, MediaAdapter, MediaMove } from "./types";

/** What a site on disk is, read from its folder and `typren.config.json`'s
 *  `studio` block by the CLI: everything a local front end (the studio, the
 *  CLI's content commands) needs to edit it. */
export type LocalSite = {
  /** Absolute path of the site's project root. */
  siteDir: string;
  /** Absolute path of the site's markdown content directory. */
  contentDir: string;
  /** `dir` is relative to `siteDir`. Default `public/img` at `/img`. */
  media?: { dir: string; publicPath: string };
  /** Default "home". */
  homeSlug?: string;
  /** `typren.config.json`'s `studio.style`, validated by the CLI. */
  styleMap?: StyleMap;
  /** typren.config.json exists, so Settings can write its bootstrap keys. */
  writeBootstrap?: boolean;
};

/** Every file a `withCommit` write touched, with its bytes before the write
 *  (null: it didn't exist), so a failed commit can put each one back. */
type Touched = Map<string, Buffer | null>;
const journal = new AsyncLocalStorage<Touched>();

const record = (file: string, before: Buffer | null) => {
  const touched = journal.getStore();
  if (touched && !touched.has(file)) touched.set(file, before);
};
const bytes = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
/** Records `file` as it is now, before a write changes it. */
const touch = (file: string) => record(file, journal.getStore() ? bytes(file) : null);

function restore(touched: Touched) {
  for (const [file, before] of touched) {
    if (before === null) fs.rmSync(file, { force: true });
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, before);
    }
  }
}

/**
 * The `CmsConfig` for a site on disk: its markdown content, `public/img`
 * style media and `typren.config.json` settings, with `auth` injected by the
 * front end (the studio passes `localAuth()`).
 *
 * Inside a git checkout every write that changes published files commits
 * them: Save (publish, then `onPublish`'s commit), a rename, a folder
 * delete, and through `withCommit` a page delete, duplicate or published
 * create, and a media upload, delete or move with the references it
 * rewrote. A detached HEAD refuses the write first, and a failed commit puts
 * every touched file back. Drafts are working state and never commit.
 *
 * `registry`, `defaults` and `previewPath` come back empty: a front end that
 * shows slices or previews sets its own.
 */
export function createLocalSiteConfig(site: LocalSite, { auth }: { auth: AuthAdapter }): CmsConfig {
  // Explicit, not core's default: that resolves typren.config.json against
  // process.cwd(), which is the front end's directory, not the site's.
  const settingsAdapter = createFsSettingsAdapter({ file: path.join(site.siteDir, "typren.config.json") });
  const { locales, defaultLocale } = settingsAdapter.readBootstrap();
  const draftDir = path.join(site.contentDir, ".drafts");
  const markdown = createMarkdownAdapter({ contentDir: site.contentDir, draftDir, locales, defaultLocale });
  const mediaDir = path.join(site.siteDir, site.media?.dir ?? "public/img");
  const publicPath = site.media?.publicPath ?? "/img";
  const fsMedia = createFsMediaAdapter({ dir: mediaDir, publicPath });
  const onMediaMove = (moves: MediaMove[]) => {
    const changed = rewriteSiteFiles(site.siteDir, moves);
    if (changed.length) console.info(`typren: media references rewritten in ${changed.join(", ")}`);
  };
  const config: CmsConfig = {
    registry: {},
    defaults: {},
    previewPath: "",
    homeSlug: site.homeSlug,
    auth,
    settingsAdapter,
    adapter: markdown,
    mediaAdapter: fsMedia,
    onMediaMove,
  };
  if (!inGitCheckout(site.siteDir)) return config;

  // Per-file review sees only what the studio writes: pages, the private
  // settings and library docs (privateContentAdapter's `.typren` beside the
  // pages), media and typren.config.json. Never the site's code.
  const git = createGitRepo({
    dir: site.siteDir,
    roots: [site.contentDir, path.join(path.dirname(site.contentDir), ".typren"), mediaDir, path.join(site.siteDir, "typren.config.json")],
  });
  const where = (locale?: string) => ((locale ?? defaultLocale) === defaultLocale ? "" : ` (${locale})`);
  const isDraft = (file: string) => file.startsWith(draftDir + path.sep);

  // Each published file's bytes before its latest write, so a failed Save
  // commit (onPublish, outside any `withCommit`) can put it back.
  const beforePublish = new Map<string, Buffer | null>();

  const adapter: ContentAdapter = {
    ...markdown,
    async writeRaw(slug, raw, locale, opts) {
      const file = markdown.pageFile(slug, locale);
      beforePublish.set(file, bytes(file));
      touch(file);
      await markdown.writeRaw(slug, raw, locale, opts);
    },
    async deletePublished(slug, locale) {
      touch(markdown.pageFile(slug, locale));
      await markdown.deletePublished(slug, locale);
    },
    async writeDraftRaw(slug, raw, locale, opts) {
      touch(markdown.draftFile(slug, locale));
      await markdown.writeDraftRaw(slug, raw, locale, opts);
    },
    async deleteDraft(slug, locale) {
      touch(markdown.draftFile(slug, locale));
      await markdown.deleteDraft(slug, locale);
    },
    // A folder delete commits at once: its marker is gone, so no later Save
    // could find it to commit the deletion.
    async deleteFolder(folder, locale) {
      const marker = markdown.folderFile(folder, locale);
      const had = fs.existsSync(marker);
      await commitOrRestore(
        git,
        [marker],
        `content: delete folder ${folder}${where(locale)}`,
        () => had && markdown.createFolder(folder, locale),
        () => markdown.deleteFolder(folder, locale)
      );
    },
  };

  // An id is a path under the media dir; the adapter validates it, this
  // only keeps a snapshot read inside that dir before it does.
  const fileOf = (id: string) => {
    const file = path.join(mediaDir, id);
    if (path.relative(mediaDir, file).startsWith("..")) throw new Error(`typren: unsafe media id "${id}"`);
    return file;
  };
  // A moved file's old bytes are its new file's, which did not exist before.
  const moved = (moves: MediaMove[]) => {
    for (const m of moves) {
      const to = fileOf(m.to.slice(publicPath.length + 1));
      record(fileOf(m.from.slice(publicPath.length + 1)), fs.readFileSync(to));
      record(to, null);
    }
  };
  const mediaAdapter: MediaAdapter = {
    ...fsMedia,
    async upload(file, folder) {
      const asset = await fsMedia.upload(file, folder);
      record(fileOf(asset.id), null);
      return asset;
    },
    async delete(id) {
      touch(fileOf(id));
      await fsMedia.delete(id);
    },
    async move(id, folder, name) {
      const result = await fsMedia.move!(id, folder, name);
      if (result.from !== result.to.url) moved([{ from: result.from, to: result.to.url }]);
      return result;
    },
    async renameFolder(folder, to) {
      const moves = await fsMedia.renameFolder!(folder, to);
      moved(moves);
      return moves;
    },
  };

  return {
    ...config,
    adapter,
    mediaAdapter,
    git,
    withCommit(message, write) {
      const touched: Touched = new Map();
      return commitOrRestore(
        git,
        () => [...touched.keys()].filter((f) => !isDraft(f)),
        message,
        () => restore(touched),
        () => journal.run(touched, write)
      );
    },
    // A rename moves files at once, so it commits at once: no later Save
    // would commit the old paths' deletion. Only files git already tracks
    // move in the commit, so an ignored or uncommitted draft stays out.
    async onRename(from, to) {
      const pairs = locales.flatMap((l) => [
        [markdown.pageFile(from, l), markdown.pageFile(to, l)],
        [markdown.draftFile(from, l), markdown.draftFile(to, l)],
      ]);
      const tracked = new Set(await git.tracked(pairs.map(([old]) => old!)));
      const files = pairs.filter(([old]) => tracked.has(old!)).flat();
      if (files.length) await git.commit(files, `content: rename ${from} to ${to}`);
    },
    async onPublish(slug, locale) {
      const file = markdown.pageFile(slug, locale);
      const before: Touched | null = beforePublish.has(file) ? new Map([[file, beforePublish.get(file) ?? null]]) : null;
      beforePublish.delete(file);
      try {
        // Folder markers ride along, so a folder made in the rail lands in the
        // next Save rather than a commit of its own.
        const markers = (await markdown.listFolders()).map((f) => markdown.folderFile(f));
        // The site doc only holds the menu the Navigation screen edits.
        await git.commit([file, ...markers], `content: update ${slug === SITE_SLUG ? "navigation" : slug}${where(locale)}`);
      } catch (e) {
        // The publish already moved the draft into place. Put it back, and
        // the published file as it was, so Save stays pending and a retry
        // after the fix commits it.
        await markdown.writeDraftRaw(slug, await markdown.readRaw(slug, locale), locale);
        if (before) restore(before);
        throw e;
      }
    },
  };
}

/** Whether `dir` sits in a git working tree: a `.git` dir or file (a linked
 *  worktree) in it or any parent.
 *  ponytail: ignores GIT_DIR and GIT_CEILING_DIRECTORIES; ask `git rev-parse`
 *  if a site ever relies on either. */
function inGitCheckout(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git")) || (path.dirname(dir) !== dir && inGitCheckout(path.dirname(dir)));
}

/** Source extensions a media URL can be written in. */
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".mdx", ".css", ".json", ".yml", ".yaml", ".html"]);
/** Never source: dependencies, build output, served files, and dot dirs
 *  (.git, .next, content drafts, which the content adapter rewrites). */
const SKIP_DIR = new Set(["node_modules", "public", "out", "dist", "build"]);

/** Points the site's own files at moved assets: every move's `from` URL in
 *  source becomes its `to`, ending at a URL boundary like core's content
 *  rewrite. Returns the changed files, relative to `siteDir`.
 *  ponytail: a full tree walk per move, fine at site scale; an index or a
 *  git-grep is the upgrade for a monorepo-sized site. */
export function rewriteSiteFiles(siteDir: string, moves: MediaMove[]): string[] {
  const swap = mediaRefSwapper(moves);
  const changed: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(full);
      } else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) {
        // isFile() is false for a symlink, so a link out of the site is never written through.
        const raw = fs.readFileSync(full, "utf8");
        const next = swap(raw);
        if (next !== raw) {
          touch(full);
          fs.writeFileSync(full, next);
          changed.push(path.relative(siteDir, full));
        }
      }
    }
  };
  walk(siteDir);
  return changed;
}
