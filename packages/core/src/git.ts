import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { GitError, GIT_NO_BRANCH } from "./git-error";

export { GitError, GIT_NO_BRANCH };

const run = promisify(execFile);

/** A local commit the upstream branch does not have yet. */
export type GitCommit = { hash: string; subject: string; files: string[] };

/** What a push would send. `upstream` is null when the branch tracks none,
 *  so there is nowhere to push and `commits` is empty. */
export type GitOutgoing = { branch: string; upstream: string | null; commits: GitCommit[] };

export type GitPushResult = { ok: true } | { ok: false; error: string };

/** One commit in a file's history (see `GitRepo.history`). `date` is ISO 8601. */
export type GitLogEntry = { hash: string; subject: string; author: string; date: string };

/** One file with saved (committed) changes the upstream does not have yet:
 *  its net change since the upstream, and the local commits that touched it.
 *  `path` is relative to the repository root, like `GitCommit.files`. */
export type GitPendingChange = {
  path: string;
  change: "added" | "modified" | "deleted";
  commits: { hash: string; subject: string }[];
};

// Terminal colour codes a hook prints; ESC is the point, so the control character is intended.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Explains a failed commit or push in words a non-developer working locally
 * can act on, keeping one line of git's (or a hook's) output where it helps.
 * ponytail: a hook is recognised by elimination, output with no "fatal:" or
 * "error:" line of git's own; read the hook path (core.hooksPath) if a
 * message ever needs to name the hook.
 */
export function explainGitError(output: string, step: "commit" | "push"): string {
  const text = output.replace(ANSI, "");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^hint:/i.test(l));
  const first = lines[0] ?? "no details";
  if (/please tell me who you are|empty ident|unable to auto-detect email/i.test(text))
    return "Git doesn't know who you are yet. Set your name and email in git (git config user.name and user.email), then save again.";
  if (/\[rejected\]|non-fast-forward|fetch first/i.test(text)) return "Someone pushed first. Pull their changes, then push again.";
  if (
    /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey|could not read from remote repository|returned error: 40[13]/i.test(
      text
    )
  )
    return "Git couldn't sign in to your remote. Check that you can push from a terminal with your usual credentials, then try again.";
  if (step === "commit" && !lines.some((l) => /^(fatal|error):/i.test(l)))
    return `A check in your repository stopped the commit: ${first}`;
  return `Git couldn't finish: ${first}`;
}

/** The output a failed git call left: stderr, else stdout (where many hooks print). */
const outputOf = (e: unknown) => {
  const err = e as { stderr?: string; stdout?: string; message?: string };
  return err.stderr?.trim() ? err.stderr : err.stdout?.trim() ? err.stdout : (err.message ?? String(e));
};

/** A local git checkout holding the content: the local studio's Save commits
 *  into it and its Push sends the commits to the branch's upstream. */
export interface GitRepo {
  /** Stages and commits exactly `files` (absolute, inside the checkout),
   *  leaving anything else in the index alone. A file that no longer exists
   *  commits as a deletion when git tracks it, and is skipped when it never
   *  did, like an untracked file git ignores. False when they hold no
   *  change, so there was nothing to commit. Throws `GitError` with a
   *  plain-language reason, refusing outright on a detached HEAD; a failed
   *  commit leaves these paths' index entries as they were. */
  commit(files: string[], message: string): Promise<boolean>;
  /** `branch` is "" on a detached HEAD, where Save is refused. */
  outgoing(): Promise<GitOutgoing>;
  /** Pushes the current branch to its upstream, never forced. A rejection
   *  (non-fast-forward, auth) comes back as a plain-language reason. */
  push(): Promise<GitPushResult>;
  /** Every content file (see `createGitRepo`'s `roots`) with a net change the upstream lacks.
   *  Empty with no upstream or on a detached HEAD. */
  pending(): Promise<GitPendingChange[]>;
  /** Pushes only `paths` (from `pending()`), never forced: one commit on
   *  top of the upstream per local commit that last touched them, with that
   *  commit's message and author, holding just the chosen paths' changes.
   *  A page saved once per push is one commit per page. On success the
   *  branch becomes those commits followed by every unpushed commit
   *  replayed without the pushed paths' changes (dropped when nothing is
   *  left), so the working tree is untouched and unpushed history keeps its
   *  commits. A rejection (the remote moved, auth) comes back as a
   *  plain-language reason with the local branch as it was. Throws
   *  `GitError` for a path not in `pending()`. */
  pushPaths(paths: string[]): Promise<GitPushResult>;
  /** The latest `limit` (1 to 100) commits that touched `file` (absolute,
   *  inside one of the content roots), newest first. Throws `GitError` for
   *  a file outside them. */
  history(file: string, limit?: number): Promise<GitLogEntry[]>;
  /** Puts `paths` (from `pending()`) back to the upstream's version, a file
   *  the upstream lacks being deleted, as one new commit; history is never
   *  rewritten. Throws `GitError` for a path not in `pending()`, a path with
   *  uncommitted edits, or a failed commit, which leaves the files as they were. */
  discardPaths(paths: string[]): Promise<void>;
}

/** process.env minus GIT_* variables. Git exports GIT_DIR and friends to its
 *  hooks, and an inherited GIT_DIR makes a child git ignore `cwd` and write
 *  into the hook's repository instead. Prompts are off so a push without
 *  usable credentials fails instead of hanging the request. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

/**
 * Runs git as an argument array (`execFile`, no shell) in `dir`, with the
 * user's own credentials and config. Paths are literal pathspecs, so a file
 * name can never be read as pathspec magic.
 */
export function createGitRepo({
  dir,
  roots = [dir],
}: {
  dir: string;
  /** The files and folders (absolute) whose changes `pending()` lists and
   *  `pushPaths`/`discardPaths` accept: the content the host owns, so a
   *  developer's code commits stay out of per-file review. Default: `dir`. */
  roots?: string[];
}): GitRepo & {
  /** The subset of `files` (absolute, inside the checkout) git tracks,
   *  whether or not they still exist on disk. Kept off `GitRepo`, which
   *  hosts implement, since only the studio's rename commit needs it. */
  tracked(files: string[]): Promise<string[]>;
} {
  const root = fs.realpathSync(dir);
  const exec = async (args: string[], { cwd = root, timeout = 15_000, env = {} }: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}) =>
    (
      await run("git", ["--literal-pathspecs", "-c", "core.quotePath=false", ...args], {
        cwd,
        env: { ...gitEnv(), ...env },
        timeout,
      })
    ).stdout;
  const git = (args: string[], timeout?: number) => exec(args, { timeout });
  // Repository-root paths (what git log prints) run from the root, since a
  // pathspec is relative to cwd and the site may be a subfolder of the repo.
  let topOf: Promise<{ top: string }> | undefined;
  const repoRoot = () =>
    (topOf ??= git(["rev-parse", "--show-toplevel"]).then((out) => {
      return { top: fs.realpathSync(out.trim()) };
    }));
  const atTop = async (args: string[], env?: Record<string, string>) => exec(args, { cwd: (await repoRoot()).top, env });

  // A deleted file has no realpath, so its nearest existing ancestor's stands in.
  const real = (p: string): string =>
    fs.existsSync(p) ? fs.realpathSync(p) : path.join(real(path.dirname(p)), path.basename(p));
  const inside = (file: string) => {
    const rel = path.relative(root, real(file));
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
      throw new Error(`typren: refusing to commit "${file}": not inside the repository`);
    return rel;
  };

  const branch = async () => (await git(["branch", "--show-current"])).trim();

  /** Where `push` sends the branch, or why it can't. */
  const target = async (): Promise<{ remote: string; merge: string } | { error: string }> => {
    const current = await branch();
    const read = (key: string) => git(["config", `branch.${current}.${key}`]).then((s) => s.trim(), () => "");
    const [remote, merge] = await Promise.all([read("remote"), read("merge")]);
    if (!current) return { error: "Check out a branch in your site folder to push." };
    if (!remote || !merge)
      return { error: `The branch "${current}" has no upstream to push to. Push it once from a terminal with git push -u.` };
    return { remote, merge };
  };

  /** The paths a per-file push or discard may touch: each must be one
   *  `pending()` lists, so a path outside the checkout, an escape or a file
   *  with nothing to send is refused before git runs. Also refuses a branch
   *  behind its upstream, whose upstream version is not the one it left from. */
  const select = async (paths: string[]) => {
    const pending = new Set((await repo.pending()).map((c) => c.path));
    for (const p of paths) {
      if (path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || p.split(/[\\/]/).includes(".."))
        throw new GitError(`"${p}" is not a path inside your site folder.`);
      if (!pending.has(p)) throw new GitError(`"${p}" has no saved change waiting to push.`);
    }
    if (!paths.length) throw new GitError("Choose at least one saved change.");
    await git(["merge-base", "--is-ancestor", "@{u}", "HEAD"]).catch(() => {
      throw new GitError("Your branch is behind its upstream. Pull the latest changes, then try again.");
    });
    return [...new Set(paths)];
  };
  /** The subset of `paths` (repository-root relative) that `rev` holds. */
  const inTree = async (rev: string, paths: string[]) =>
    new Set((await atTop(["ls-tree", "-r", "-z", "--name-only", rev, "--", ...paths])).split("\0").filter(Boolean));

  /** Sets `rel`'s index entries back to `entries` (`ls-files -s` lines). */
  const unstage = async (rel: string[], entries: string[]) => {
    await git(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...rel]);
    const info = entries.map((e) => e.match(/^(\d+) (\w+) 0\t(.*)$/s)).filter((m) => m !== null);
    if (info.length) await git(["update-index", "--add", ...info.flatMap(([, mode, sha, p]) => ["--cacheinfo", `${mode},${sha},${p}`])]);
  };

  /** Commits on HEAD the upstream lacks, oldest first, with what a replay needs. */
  type Unpushed = { hash: string; author: string; email: string; date: string; message: string; files: string[] };
  const commitsSince = async (base: string): Promise<Unpushed[]> =>
    (await git(["log", "--reverse", "--format=%x1e%H%x00%an%x00%ae%x00%aI%x00%B%x00", "--name-only", `${base}..HEAD`]))
      .split("\x1e")
      .filter((rec) => rec.trim())
      .map((rec) => {
        const [hash = "", author = "", email = "", date = "", message = "", files = ""] = rec.split("\0");
        return { hash, author, email, date, message: message.trim(), files: files.split("\n").filter(Boolean) };
      });

  const repo: ReturnType<typeof createGitRepo> = {
    async commit(files, message) {
      const rel = files.map(inside);
      if (!(await branch())) throw new GitError(GIT_NO_BRANCH);
      // No paths would make the diff and commit below take the whole index.
      if (!rel.length) return false;
      const gone = rel.filter((r) => !fs.existsSync(path.join(root, r)));
      // These paths' index entries before staging, so a failed commit can put
      // the index back and a later commit of the user's own sweeps nothing in.
      const staged = (await git(["ls-files", "-s", "-z", "--", ...rel])).split("\0").filter(Boolean);
      try {
        // `git add` refuses an untracked ignored file (a gitignored media
        // dir), so one stays out of the commit.
        const exists = rel.filter((r) => !gone.includes(r));
        const ignored = exists.length
          ? (await git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...exists])).split("\0")
          : [];
        const present = exists.filter((r) => !ignored.includes(r));
        if (present.length) await git(["add", "--", ...present]);
        // Stages a tracked file's deletion; one git never tracked is ignored.
        if (gone.length) await git(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...gone]);
        // --no-renames: a detected rename lists only its new path, which
        // would leave the old path's deletion out of the commit.
        const changed = (await git(["diff", "--cached", "--name-only", "--relative", "--no-renames", "-z", "--", ...rel]))
          .split("\0")
          .filter(Boolean);
        if (!changed.length) return false;
        // A commit with paths takes only those paths, whatever else is staged.
        await git(["commit", "-m", message, "--", ...changed]);
        return true;
      } catch (e) {
        await unstage(rel, staged).catch(() => {});
        throw new GitError(explainGitError(outputOf(e), "commit"));
      }
    },

    async tracked(files) {
      const rel = files.map(inside);
      if (!rel.length) return [];
      try {
        const listed = new Set((await git(["ls-files", "-z", "--", ...rel])).split("\0"));
        return files.filter((_, i) => listed.has(rel[i]));
      } catch (e) {
        throw new GitError(explainGitError(outputOf(e), "commit"));
      }
    },

    async outgoing() {
      const current = await branch();
      let upstream: string;
      try {
        upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
      } catch {
        return { branch: current, upstream: null, commits: [] };
      }
      const log = await git(["log", "--format=%x1e%h%x00%s", "--name-only", "@{u}.."]);
      const commits = log
        .split("\x1e")
        .filter((rec) => rec.trim())
        .map((rec) => {
          const [head = "", ...files] = rec.trim().split("\n");
          const [hash = "", subject = ""] = head.split("\0");
          return { hash, subject, files: files.filter(Boolean) };
        });
      return { branch: current, upstream, commits };
    },

    async push() {
      try {
        const to = await target();
        if ("error" in to) return { ok: false, error: to.error };
        // An explicit refspec, so push.default or a remote's own push refspec
        // cannot widen this into other branches or a forced update.
        // `--`: a remote read from git config that starts with "-" stays a repository, not an option.
        await git(["push", "--", to.remote, `HEAD:${to.merge}`], 60_000);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: explainGitError(outputOf(e), "push") };
      }
    },

    async pending() {
      const out = await repo.outgoing();
      if (!out.upstream) return [];
      const { top } = await repoRoot();
      const owned = roots.map(real);
      const isOwned = (p: string) =>
        owned.some((r) => {
          const rel = path.relative(r, path.join(top, p));
          return !rel.startsWith("..") && !path.isAbsolute(rel);
        });
      // Three dots: changes since the branch left the upstream, not the
      // upstream's own newer commits undone.
      const fields = (await atTop(["diff", "--name-status", "--no-renames", "-z", "@{u}...HEAD"])).split("\0").filter(Boolean);
      const changes: GitPendingChange[] = [];
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const p = fields[i + 1]!;
        if (!isOwned(p)) continue;
        const commits = out.commits.filter((c) => c.files.includes(p)).map(({ hash, subject }) => ({ hash, subject }));
        const change = fields[i] === "A" ? "added" : fields[i] === "D" ? "deleted" : "modified";
        changes.push({ path: p, change, commits });
      }
      return changes;
    },

    async discardPaths(paths) {
      const chosen = await select(paths);
      const { top } = await repoRoot();
      if (await atTop(["status", "--porcelain", "-z", "--", ...chosen]))
        throw new GitError("Some of these files have edits that aren't saved yet. Save or undo them, then discard again.");
      const [upstream, head] = await Promise.all([inTree("@{u}", chosen), inTree("HEAD", chosen)]);
      const rm = (p: string) => fs.rmSync(path.join(top, p), { force: true });
      try {
        const back = chosen.filter((p) => upstream.has(p));
        if (back.length) await atTop(["checkout", "@{u}", "--", ...back]);
        for (const p of chosen) if (!upstream.has(p)) rm(p);
        await repo.commit(
          chosen.map((p) => path.join(top, p)),
          `content: discard ${chosen.join(", ")}`
        );
      } catch (e) {
        // Back to HEAD's files: they had no uncommitted edits, so HEAD is what they held.
        // allSettled: a failed restore step must not hide the error behind it.
        const kept = chosen.filter((p) => head.has(p));
        const absent = chosen.filter((p) => !head.has(p));
        if (kept.length) await Promise.allSettled([atTop(["checkout", "HEAD", "--", ...kept])]);
        if (absent.length) await Promise.allSettled([atTop(["rm", "-q", "--cached", "--ignore-unmatch", "--", ...absent])]);
        absent.forEach(rm);
        throw e instanceof GitError ? e : new GitError(explainGitError(outputOf(e), "commit"));
      }
    },

    async pushPaths(paths) {
      const chosen = await select(paths);
      const to = await target();
      if ("error" in to) return { ok: false, error: to.error };
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "typren-push-"));
      // A throwaway index, so the user's own index and working tree are never touched.
      const index = { GIT_INDEX_FILE: path.join(scratch, "index") };
      try {
        const [base = "", head = ""] = (await git(["rev-parse", "@{u}", "HEAD"])).trim().split("\n");
        const unpushed = await commitsSince(base);
        // HEAD's version of each chosen path, as index entries; a path HEAD lacks is a deletion.
        const entries = (await atTop(["ls-tree", "-r", "-z", head, "--", ...chosen])).split("\0").filter(Boolean);
        const info = entries.map((e) => e.match(/^(\d+) \w+ (\w+)\t(.*)$/s)).filter((m) => m !== null);
        const gone = chosen.filter((p) => !info.some((m) => m[3] === p));
        /** `rev`'s tree with `only` of the chosen paths set to HEAD's version. */
        const treeWith = async (rev: string, only: readonly string[]) => {
          await atTop(["read-tree", rev], index);
          const set = info.filter((m) => only.includes(m[3]!));
          if (set.length) await atTop(["update-index", "--add", ...set.flatMap(([, mode, sha, p]) => ["--cacheinfo", `${mode},${sha},${p}`])], index);
          const rm = gone.filter((p) => only.includes(p));
          if (rm.length) await atTop(["update-index", "--force-remove", "--", ...rm], index);
          return (await atTop(["write-tree"], index)).trim();
        };
        const commitAs = async (c: Unpushed, tree: string, parent: string) =>
          (
            await exec(["commit-tree", tree, "-p", parent, "-m", c.message], {
              env: { GIT_AUTHOR_NAME: c.author, GIT_AUTHOR_EMAIL: c.email, GIT_AUTHOR_DATE: c.date },
            })
          ).trim();
        // Each chosen path goes with the newest commit that touched it.
        const owner = new Map(chosen.map((p) => [p, [...unpushed].reverse().find((c) => c.files.includes(p))]));
        let sent = base;
        let sentTree = (await git(["rev-parse", `${base}^{tree}`])).trim();
        const placed: string[] = [];
        for (const c of unpushed) {
          const mine = chosen.filter((p) => owner.get(p) === c);
          if (!mine.length) continue;
          placed.push(...mine);
          const tree = await treeWith(sent, mine);
          if (tree !== sentTree) [sent, sentTree] = [await commitAs(c, tree, sent), tree];
        }
        // A chosen path no commit lists (a merge brought it) rides in one more commit.
        const rest = chosen.filter((p) => !placed.includes(p));
        if (rest.length) {
          const tree = await treeWith(sent, rest);
          if (tree !== sentTree) {
            sent = (await git(["commit-tree", tree, "-p", sent, "-m", `content: update ${rest.join(", ")}`])).trim();
            sentTree = tree;
          }
        }
        // The local branch after the push, built before it: every unpushed
        // commit replayed onto what was sent, with the chosen paths as sent.
        let next = sent;
        let nextTree = sentTree;
        for (const c of unpushed) {
          const tree = await treeWith(c.hash, chosen);
          if (tree !== nextTree) [next, nextTree] = [await commitAs(c, tree, next), tree];
        }
        // Never forced: a remote that moved rejects this as non-fast-forward
        // before anything local changes.
        await git(["push", "--", to.remote, `${sent}:${to.merge}`], 60_000);
        // Checked against the old HEAD, so a commit made meanwhile is never lost.
        await git(["update-ref", "-m", "typren: push selected changes", "HEAD", next, head]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: explainGitError(outputOf(e), "push") };
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    },

    async history(file, limit = 20) {
      // The trust boundary for history reads: only files under a content root.
      const target = path.isAbsolute(file) ? real(file) : "";
      const owned = roots.map(real).some((r) => {
        const rel = path.relative(r, target);
        return target && !rel.startsWith("..") && !path.isAbsolute(rel);
      });
      if (!owned) throw new GitError(`"${file}" is not a content file of this site.`);
      const rel = path.relative(root, target);
      const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
      const out = await git(["log", `-n${n}`, "--format=%h%x00%s%x00%an%x00%aI", "--", rel]).catch(() => "");
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash = "", subject = "", author = "", date = ""] = line.split("\0");
          return { hash, subject, author, date };
        });
    },
  };
  return repo;
}

/**
 * Runs `write` and commits `files` (absolute, inside the checkout) as one
 * change: a detached HEAD is refused before anything is written, and a
 * failed write or commit runs `restore` to put the written files back before
 * the error (a plain-language `GitError` for the commit) is rethrown. `files` may be a function, read
 * once the write is done, for a write that only knows its paths afterwards.
 */
export async function commitOrRestore<T>(
  git: GitRepo,
  files: string[] | (() => string[]),
  message: string,
  restore: () => unknown,
  write: () => Promise<T>
): Promise<T> {
  if (!(await git.outgoing()).branch) throw new GitError(GIT_NO_BRANCH);
  try {
    // Inside the try: a write that throws part-way is put back too.
    const result = await write();
    await git.commit(typeof files === "function" ? files() : files, message);
    return result;
  } catch (e) {
    await restore();
    throw e;
  }
}
