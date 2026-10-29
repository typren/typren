import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTyprenApi } from "./api/routes";
import { createTyprenClient } from "./api/client";
import { commitOrRestore, createGitRepo, explainGitError, GIT_NO_BRANCH, GitError } from "./git";
import { createMarkdownAdapter } from "./markdown-adapter";
import type { CmsConfig } from "./types";

// Under the pre-push hook GIT_DIR points at the typren checkout; a git child
// inheriting it would write into that repository instead of the temp one.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

let tmp: string;
let site: string;
let origin: string;

const writePage = (slug: string, title: string) =>
  fs.writeFileSync(path.join(site, "content", `${slug}.md`), `---\ntitle: ${title}\nslices: []\n---\n`);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typren-git-"));
  site = path.join(tmp, "site");
  origin = path.join(tmp, "origin.git");
  sh(tmp, "init", "-q", "--bare", "-b", "main", origin);
  fs.mkdirSync(path.join(site, "content"), { recursive: true });
  sh(site, "init", "-q", "-b", "main");
  sh(site, "config", "user.name", "Test");
  sh(site, "config", "user.email", "test@example.test");
  writePage("home", "Home");
  sh(site, "add", ".");
  sh(site, "commit", "-q", "-m", "init");
  sh(site, "remote", "add", "origin", origin);
  sh(site, "push", "-q", "-u", "origin", "main");
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("createGitRepo", () => {
  it("commits only the given file, leaving other staged and unstaged changes alone", async () => {
    const repo = createGitRepo({ dir: site });
    writePage("home", "Home v2");
    fs.writeFileSync(path.join(site, "staged.txt"), "x");
    sh(site, "add", "staged.txt");
    fs.writeFileSync(path.join(site, "loose.txt"), "y");

    expect(await repo.commit([path.join(site, "content", "home.md")], "content: update home")).toBe(true);
    expect(sh(site, "log", "-1", "--format=%s")).toBe("content: update home");
    expect(sh(site, "show", "--name-only", "--format=", "HEAD")).toBe("content/home.md");
    expect(sh(site, "diff", "--cached", "--name-only")).toBe("staged.txt");
  });

  it("commits a brand-new file, and reports false when there is nothing to commit", async () => {
    const repo = createGitRepo({ dir: site });
    writePage("about", "About");
    const file = path.join(site, "content", "about.md");
    expect(await repo.commit([file], "content: update about")).toBe(true);
    expect(await repo.commit([file], "content: update about")).toBe(false);
  });

  it("commits a deleted tracked file as a deletion, and skips one git never tracked", async () => {
    const repo = createGitRepo({ dir: site });
    const marker = path.join(site, "content", "event", ".typren-folder");
    fs.mkdirSync(path.dirname(marker));
    fs.writeFileSync(marker, "");
    expect(await repo.commit([marker], "content: add folder")).toBe(true);
    fs.writeFileSync(path.join(site, "staged.txt"), "x");
    sh(site, "add", "staged.txt");
    fs.rmSync(path.dirname(marker), { recursive: true });
    const never = path.join(site, "content", "never", ".typren-folder");
    expect(await repo.commit([marker, never], "content: delete folder event")).toBe(true);
    expect(sh(site, "show", "--name-status", "--format=", "HEAD")).toBe("D\tcontent/event/.typren-folder");
    expect(sh(site, "diff", "--cached", "--name-only")).toBe("staged.txt");
    expect(await repo.commit([never], "m")).toBe(false);
  });

  it("commits a moved file as its deletion plus its addition, not just the new path", async () => {
    const repo = createGitRepo({ dir: site });
    const from = path.join(site, "content", "home.md");
    const to = path.join(site, "content", "start.md");
    fs.renameSync(from, to);
    expect(await repo.commit([from, to], "content: rename home to start")).toBe(true);
    expect(sh(site, "show", "--name-status", "--no-renames", "--format=", "HEAD")).toBe("D\tcontent/home.md\nA\tcontent/start.md");
    expect(sh(site, "status", "--porcelain")).toBe("");
  });

  it("lists which files git tracks, a deleted tracked file included", async () => {
    const repo = createGitRepo({ dir: site });
    const home = path.join(site, "content", "home.md");
    const loose = path.join(site, "content", "loose.md");
    fs.writeFileSync(loose, "x");
    expect(await repo.tracked([home, loose])).toEqual([home]);
    fs.rmSync(home);
    expect(await repo.tracked([home, loose])).toEqual([home]);
    expect(await repo.tracked([])).toEqual([]);
  });

  it("commits from a site in a subfolder of the repository", async () => {
    writePage("home", "Home v2");
    expect(await createGitRepo({ dir: path.join(site, "content") }).commit([path.join(site, "content", "home.md")], "m")).toBe(true);
    expect(sh(site, "show", "--name-only", "--format=", "HEAD")).toBe("content/home.md");
  });

  it("refuses a path outside the checkout", async () => {
    const outside = path.join(tmp, "outside.md");
    fs.writeFileSync(outside, "x");
    await expect(createGitRepo({ dir: site }).commit([outside], "m")).rejects.toThrow(/not inside the repository/);
  });

  it("lists commits ahead of the upstream with their files, then pushes them", async () => {
    const repo = createGitRepo({ dir: site });
    expect(await repo.outgoing()).toEqual({ branch: "main", upstream: "origin/main", commits: [] });
    writePage("home", "Home v2");
    await repo.commit([path.join(site, "content", "home.md")], "content: update home");

    const out = await repo.outgoing();
    expect(out.commits).toEqual([{ hash: expect.any(String), subject: "content: update home", files: ["content/home.md"] }]);
    expect(await repo.push()).toEqual({ ok: true });
    expect(sh(origin, "log", "-1", "--format=%s", "main")).toBe("content: update home");
    expect((await repo.outgoing()).commits).toEqual([]);
  });

  it("reports a branch with no upstream, and refuses to push it", async () => {
    sh(site, "switch", "-q", "-c", "local-only");
    const repo = createGitRepo({ dir: site });
    expect(await repo.outgoing()).toEqual({ branch: "local-only", upstream: null, commits: [] });
    expect(await repo.push()).toEqual({ ok: false, error: expect.stringMatching(/no upstream/) });
  });

  it("returns a rejected (non-fast-forward) push as git's error text, without forcing", async () => {
    // Someone else pushed first.
    const other = path.join(tmp, "other");
    sh(tmp, "clone", "-q", origin, other);
    sh(other, "-c", "user.name=O", "-c", "user.email=o@example.test", "commit", "-q", "--allow-empty", "-m", "theirs");
    sh(other, "push", "-q");

    const repo = createGitRepo({ dir: site });
    writePage("home", "Home v2");
    await repo.commit([path.join(site, "content", "home.md")], "content: update home");
    const res = await repo.push();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toBe("Someone pushed first. Pull their changes, then push again.");
    expect(sh(origin, "log", "-1", "--format=%s", "main")).toBe("theirs");
  });

  it("reads an upstream remote that starts with a dash as a repository, never an option", async () => {
    sh(site, "config", "branch.main.remote", "--receive-pack=touch pwned");
    const res = await createGitRepo({ dir: site }).push();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/strange pathname|does not appear to be a git repository/);
    expect(fs.existsSync(path.join(site, "pwned"))).toBe(false);
  });
});

describe("detached HEAD", () => {
  beforeEach(() => sh(site, "checkout", "-q", "--detach"));

  it("reports no branch, refuses to commit and refuses to push", async () => {
    const repo = createGitRepo({ dir: site });
    expect((await repo.outgoing()).branch).toBe("");
    writePage("home", "Home v2");
    const err = await repo.commit([path.join(site, "content", "home.md")], "m").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toBe(GIT_NO_BRANCH);
    expect(sh(site, "log", "-1", "--format=%s")).toBe("init");
    expect(await repo.push()).toEqual({ ok: false, error: "Check out a branch in your site folder to push." });
  });
});

describe("commitOrRestore", () => {
  const file = () => path.join(site, "content", "about.md");

  it("writes, then commits the files the write names once it is done", async () => {
    const repo = createGitRepo({ dir: site });
    const restore = () => expect.fail("nothing to restore");
    expect(await commitOrRestore(repo, () => [file()], "content: create about", restore, async () => (writePage("about", "About"), "done"))).toBe(
      "done"
    );
    expect(sh(site, "show", "--name-only", "--format=%s", "HEAD")).toBe("content: create about\n\ncontent/about.md");
    // No files: nothing commits, rather than the whole index.
    fs.writeFileSync(path.join(site, "staged.txt"), "x");
    sh(site, "add", "staged.txt");
    expect(await repo.commit([], "nothing")).toBe(false);
    expect(sh(site, "log", "-1", "--format=%s")).toBe("content: create about");
  });

  it("leaves an untracked ignored file out instead of failing the commit", async () => {
    fs.writeFileSync(path.join(site, ".gitignore"), "cache/\n");
    fs.mkdirSync(path.join(site, "cache"));
    fs.writeFileSync(path.join(site, "cache", "a.txt"), "x");
    writePage("about", "About");
    expect(await createGitRepo({ dir: site }).commit([path.join(site, "cache", "a.txt"), file()], "content: create about")).toBe(true);
    expect(sh(site, "show", "--name-only", "--format=", "HEAD")).toBe("content/about.md");
  });

  it("refuses a detached HEAD before the write", async () => {
    sh(site, "checkout", "-q", "--detach");
    let wrote = false;
    const write = async () => {
      wrote = true;
    };
    await expect(commitOrRestore(createGitRepo({ dir: site }), [file()], "x", () => {}, write)).rejects.toThrow(GIT_NO_BRANCH);
    expect(wrote).toBe(false);
  });

  it("puts the index back for its paths when the commit fails, keeping what the user staged", async () => {
    const home = path.join(site, "content", "home.md");
    fs.appendFileSync(home, "Staged.\n");
    sh(site, "add", "content/home.md");
    fs.appendFileSync(home, "Loose.\n");
    writePage("about", "About");
    fs.writeFileSync(path.join(site, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const repo = createGitRepo({ dir: site });
    await expect(repo.commit([home, path.join(site, "content", "about.md")], "m")).rejects.toThrow(GitError);
    expect(sh(site, "status", "--porcelain")).toBe("MM content/home.md\n?? content/about.md");
    expect(sh(site, "diff", "--cached")).toContain("+Staged.");
    expect(sh(site, "diff", "--cached")).not.toContain("Loose.");
  });

  it("restores when the write itself throws part-way", async () => {
    let restored = false;
    const write = async () => {
      writePage("about", "About");
      throw new Error("disk full");
    };
    await expect(commitOrRestore(createGitRepo({ dir: site }), [file()], "x", () => (restored = true), write)).rejects.toThrow("disk full");
    expect(restored).toBe(true);
  });

  it("restores and rethrows the plain-language reason when the commit fails", async () => {
    fs.writeFileSync(path.join(site, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho blocked\nexit 1\n", { mode: 0o755 });
    const write = async () => writePage("about", "About");
    const restore = () => fs.rmSync(file());
    const failed = commitOrRestore(createGitRepo({ dir: site }), [file()], "x", restore, write);
    await expect(failed).rejects.toThrow(GitError);
    await expect(failed).rejects.toThrow("A check in your repository stopped the commit: blocked");
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("explainGitError", () => {
  it("maps a missing identity", () => {
    expect(explainGitError("Author identity unknown\n\n*** Please tell me who you are.\nfatal: empty ident name", "commit")).toMatch(
      /^Git doesn't know who you are yet\. Set your name and email in git/
    );
  });

  it("maps a rejected, non-fast-forward push", () => {
    expect(explainGitError(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs", "push")).toBe(
      "Someone pushed first. Pull their changes, then push again."
    );
  });

  it.each([
    "remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.test/r.git/'",
    "fatal: could not read Username for 'https://example.test': terminal prompts disabled",
    "git@example.test: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    "fatal: unable to access 'https://example.test/r.git/': The requested URL returned error: 403",
  ])("maps a credential failure: %s", (out) => {
    expect(explainGitError(out, "push")).toMatch(/^Git couldn't sign in to your remote/);
  });

  it("names a hook's first useful line, without colour codes", () => {
    expect(explainGitError("\n\x1b[31mlint failed: foo.ts\x1b[0m\nmore\n", "commit")).toBe(
      "A check in your repository stopped the commit: lint failed: foo.ts"
    );
  });

  it("falls back to git's first line", () => {
    expect(explainGitError("hint: ignore me\nfatal: Unable to create '/r/.git/index.lock': File exists.", "commit")).toBe(
      "Git couldn't finish: fatal: Unable to create '/r/.git/index.lock': File exists."
    );
    expect(explainGitError("", "push")).toBe("Git couldn't finish: no details");
  });
});

describe("git-backed publish over the HTTP API", () => {
  const BASE = "/api/typren";
  let client: ReturnType<typeof createTyprenClient>;

  beforeEach(() => {
    const adapter = createMarkdownAdapter({ contentDir: path.join(site, "content") });
    const git = createGitRepo({ dir: site });
    const config: CmsConfig = {
      registry: {},
      defaults: {},
      adapter,
      previewPath: "/",
      auth: { getUser: async () => ({ id: "t" }), authorize: async () => true },
      git,
      onPublish: async (slug, locale) => {
        await git.commit([adapter.pageFile(slug, locale)], `content: update ${slug}`);
      },
    };
    const api = createTyprenApi(config, { basePath: BASE });
    client = createTyprenClient({
      baseUrl: `https://example.test${BASE}`,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        api.handler(new Request(input as string, init))) as typeof globalThis.fetch,
    });
  });

  it("a draft write stays out of git; publishing commits the page file, and push ships it", async () => {
    const page = { meta: { title: "Home v2" }, slices: [], body: "" };
    const saved = await client.saveDraft("home", page);
    expect(saved.ok).toBe(true);
    expect(fs.existsSync(path.join(site, "content", ".drafts", "home.md"))).toBe(true);
    expect(sh(site, "log", "-1", "--format=%s")).toBe("init");

    await client.publish("home", saved.ok ? saved.version : undefined);
    expect(sh(site, "show", "--name-only", "--format=%s", "HEAD")).toBe("content: update home\n\ncontent/home.md");
    expect(sh(site, "ls-files")).not.toMatch(/\.drafts/);

    expect((await client.gitOutgoing()).commits.map((c) => c.subject)).toEqual(["content: update home"]);
    await client.gitPush();
    expect(sh(origin, "log", "-1", "--format=%s", "main")).toBe("content: update home");
  });

  it("a hook that rejects the commit comes back in plain words", async () => {
    fs.writeFileSync(path.join(site, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'lint failed: home.md'\nexit 1\n", {
      mode: 0o755,
    });
    const saved = await client.saveDraft("home", { meta: { title: "Home v2" }, slices: [], body: "" });
    await expect(client.publish("home", saved.ok ? saved.version : undefined)).rejects.toThrow(
      "A check in your repository stopped the commit: lint failed: home.md"
    );
  });

  it("refuses to publish on a detached HEAD before the file move, keeping the draft", async () => {
    sh(site, "checkout", "-q", "--detach");
    const before = fs.readFileSync(path.join(site, "content", "home.md"), "utf8");
    const saved = await client.saveDraft("home", { meta: { title: "Home v2" }, slices: [], body: "" });
    await expect(client.publish("home", saved.ok ? saved.version : undefined)).rejects.toThrow(GIT_NO_BRANCH);
    expect(fs.readFileSync(path.join(site, "content", "home.md"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(site, "content", ".drafts", "home.md"))).toBe(true);
  });

  it("surfaces a rejected push as the client's error", async () => {
    sh(site, "switch", "-q", "-c", "local-only");
    await expect(client.gitPush()).rejects.toThrow(/no upstream/);
  });

  it("rejects slug injection before git ever runs", async () => {
    for (const slug of ["../outside", "-x", "a b", "home;rm"]) {
      await expect(client.publish(slug)).rejects.toThrow();
    }
    expect(sh(site, "log", "-1", "--format=%s")).toBe("init");
  });
});

// Each test here runs a dozen real git calls and pushes to a bare remote.
describe("per-file review", { timeout: 30_000 }, () => {
  const page = (slug: string) => path.join(site, "content", `${slug}.md`);
  const read = (slug: string) => fs.readFileSync(page(slug), "utf8");
  /** Saves three changes: home modified, about added, legal (pushed first) deleted. */
  async function saveThree() {
    const repo = createGitRepo({ dir: site });
    writePage("legal", "Legal");
    await repo.commit([page("legal")], "content: create legal");
    expect(await repo.push()).toEqual({ ok: true });
    writePage("home", "Home v2");
    await repo.commit([page("home")], "content: update home");
    writePage("about", "About");
    await repo.commit([page("about")], "content: create about");
    fs.rmSync(page("legal"));
    await repo.commit([page("legal")], "content: delete legal");
    return repo;
  }

  it("lists each file's net change with the commits that touched it", async () => {
    const repo = await saveThree();
    expect(await repo.pending()).toEqual([
      { path: "content/about.md", change: "added", commits: [{ hash: expect.any(String), subject: "content: create about" }] },
      { path: "content/home.md", change: "modified", commits: [{ hash: expect.any(String), subject: "content: update home" }] },
      { path: "content/legal.md", change: "deleted", commits: [{ hash: expect.any(String), subject: "content: delete legal" }] },
    ]);
  });

  it("lists nothing without an upstream", async () => {
    sh(site, "switch", "-q", "-c", "local-only");
    expect(await createGitRepo({ dir: site }).pending()).toEqual([]);
  });

  it("discards modified, added and deleted files in one new commit", async () => {
    const repo = await saveThree();
    const before = sh(site, "rev-parse", "HEAD");
    await repo.discardPaths(["content/home.md", "content/about.md", "content/legal.md"]);
    expect(read("home")).toContain("title: Home\n");
    expect(fs.existsSync(page("about"))).toBe(false);
    expect(read("legal")).toContain("title: Legal");
    expect(sh(site, "log", "-1", "--format=%s")).toBe("content: discard content/home.md, content/about.md, content/legal.md");
    expect(sh(site, "rev-parse", "HEAD~1")).toBe(before);
    expect(sh(site, "status", "--porcelain")).toBe("");
    expect(await repo.pending()).toEqual([]);
  });

  it("refuses to discard a file with unsaved edits, and puts files back when the commit fails", async () => {
    const repo = await saveThree();
    writePage("home", "Home v3");
    await expect(repo.discardPaths(["content/home.md"])).rejects.toThrow(/aren't saved yet/);
    expect(read("home")).toContain("Home v3");
    sh(site, "checkout", "--", "content/home.md");

    const hook = path.join(site, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'lint failed'\nexit 1\n", { mode: 0o755 });
    const head = sh(site, "rev-parse", "HEAD");
    const err = await repo.discardPaths(["content/home.md", "content/about.md", "content/legal.md"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toMatch(/lint failed/);
    expect(sh(site, "rev-parse", "HEAD")).toBe(head);
    expect(read("home")).toContain("Home v2");
    expect(fs.existsSync(page("about"))).toBe(true);
    expect(fs.existsSync(page("legal"))).toBe(false);
    expect(sh(site, "status", "--porcelain")).toBe("");
  });

  it("pushes only the chosen files and keeps the rest unpushed, the working tree untouched", async () => {
    const repo = await saveThree();
    expect(await repo.pushPaths(["content/home.md", "content/legal.md"])).toEqual({ ok: true });
    expect(sh(origin, "show", "main:content/home.md")).toContain("Home v2");
    expect(() => sh(origin, "show", "main:content/legal.md")).toThrow();
    expect(() => sh(origin, "show", "main:content/about.md")).toThrow();
    // One commit per local commit that touched them, in order, with its author.
    expect(sh(origin, "log", "--format=%s|%an", "main", "-3")).toBe("content: delete legal|Test\ncontent: update home|Test\ncontent: create legal|Test");
    expect((await repo.pending()).map((c) => c.path)).toEqual(["content/about.md"]);
    // The rest keeps its own commits, not one squash.
    expect(sh(site, "log", "--format=%s", "@{u}..")).toBe("content: create about");
    expect(sh(site, "status", "--porcelain")).toBe("");
    expect(read("about")).toContain("About");

    // The last one leaves the branch exactly at what was pushed.
    expect(await repo.pushPaths(["content/about.md"])).toEqual({ ok: true });
    expect(sh(site, "rev-parse", "HEAD")).toBe(sh(origin, "rev-parse", "main"));
    expect(await repo.pending()).toEqual([]);
  });

  it("keeps every unpushed commit when pushing two pages out of several", async () => {
    const repo = await saveThree();
    writePage("contact", "Contact");
    await repo.commit([page("contact")], "content: create contact");
    writePage("home", "Home v3");
    await repo.commit([page("home")], "content: update home again");
    expect(await repo.pushPaths(["content/home.md", "content/contact.md"])).toEqual({ ok: true });
    expect(sh(origin, "log", "--format=%s", "main", "-2")).toBe("content: update home again\ncontent: create contact");
    expect(sh(origin, "show", "main:content/home.md")).toContain("Home v3");
    expect(sh(site, "log", "--format=%s", "@{u}..")).toBe("content: delete legal\ncontent: create about");
    expect(sh(site, "status", "--porcelain")).toBe("");
  });

  it("pushes a path only a merge commit brought in its own commit", async () => {
    const repo = await saveThree();
    sh(site, "checkout", "-q", "-b", "side");
    sh(site, "commit", "-q", "--allow-empty", "-m", "side");
    sh(site, "checkout", "-q", "main");
    sh(site, "merge", "-q", "--no-ff", "--no-commit", "side");
    writePage("faq", "FAQ");
    sh(site, "add", "content/faq.md");
    sh(site, "commit", "-q", "-m", "merge side");
    expect(await repo.pushPaths(["content/faq.md"])).toEqual({ ok: true });
    expect(sh(origin, "log", "--format=%s", "main", "-1")).toBe("content: update content/faq.md");
    expect(sh(origin, "show", "main:content/faq.md")).toContain("FAQ");
  });

  it("reads a content file's history newest first and refuses anything outside the content", async () => {
    const repo = createGitRepo({ dir: site, roots: [path.join(site, "content")] });
    writePage("home", "Home v2");
    await repo.commit([page("home")], "content: update home");
    const log = await repo.history(page("home"), 5);
    expect(log[0]).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{7,}$/), subject: "content: update home", author: "Test", date: expect.stringMatching(/^\d{4}-/) });
    expect(log.length).toBeGreaterThan(1);
    expect(await repo.history(page("home"), 1)).toHaveLength(1);
    expect(await repo.history(page("never"))).toEqual([]);
    const fresh = path.join(tmp, "fresh");
    fs.mkdirSync(path.join(fresh, "content"), { recursive: true });
    sh(fresh, "init", "-q");
    expect(await createGitRepo({ dir: fresh }).history(path.join(fresh, "content", "home.md"))).toEqual([]);
    for (const bad of [path.join(site, "README.md"), path.join(site, "content", "..", "x.md"), "content/home.md", "/etc/passwd"])
      await expect(repo.history(bad)).rejects.toThrow(GitError);
  });

  it("leaves everything as it was when the remote moved", async () => {
    const repo = await saveThree();
    const other = path.join(tmp, "other");
    sh(tmp, "clone", "-q", origin, other);
    sh(other, "-c", "user.name=O", "-c", "user.email=o@example.test", "commit", "-q", "--allow-empty", "-m", "theirs");
    sh(other, "push", "-q");
    const head = sh(site, "rev-parse", "HEAD");
    expect(await repo.pushPaths(["content/home.md"])).toEqual({ ok: false, error: "Someone pushed first. Pull their changes, then push again." });
    expect(sh(site, "rev-parse", "HEAD")).toBe(head);
    expect(sh(origin, "log", "-1", "--format=%s", "main")).toBe("theirs");
    expect(sh(site, "status", "--porcelain")).toBe("");

    // Once fetched, the branch is behind and both are refused up front.
    sh(site, "fetch", "-q");
    await expect(repo.pushPaths(["content/home.md"])).rejects.toThrow(/behind its upstream/);
    await expect(repo.discardPaths(["content/home.md"])).rejects.toThrow(/behind its upstream/);
  });

  it("refuses escapes, absolute paths, files with nothing pending and an empty choice", async () => {
    const repo = await saveThree();
    for (const p of ["../outside.md", "content/../../x", "/etc/passwd", "C:\\x"])
      await expect(repo.discardPaths([p])).rejects.toThrow(/not a path inside your site folder/);
    await expect(repo.pushPaths(["content/../content/home.md"])).rejects.toThrow(GitError);
    await expect(repo.pushPaths(["README.md"])).rejects.toThrow(/no saved change waiting/);
    await expect(repo.pushPaths([])).rejects.toThrow(/at least one/);
    expect((await repo.pending()).length).toBe(3);
  });

  it("only offers files inside the site folder when it is a subfolder of the repository", async () => {
    const repo = await saveThree();
    fs.writeFileSync(path.join(site, "README.md"), "x");
    sh(site, "add", "README.md");
    sh(site, "commit", "-q", "-m", "docs");
    const sub = createGitRepo({ dir: path.join(site, "content") });
    expect((await sub.pending()).map((c) => c.path)).toEqual(["content/about.md", "content/home.md", "content/legal.md"]);
    await expect(sub.discardPaths(["README.md"])).rejects.toThrow(/no saved change/);
    await sub.discardPaths(["content/about.md"]);
    expect(fs.existsSync(page("about"))).toBe(false);
    expect((await repo.pending()).map((c) => c.path)).toEqual(["README.md", "content/home.md", "content/legal.md"]);
  });

  it("sees only files under its content roots, and pushes content without the code beside it", async () => {
    await saveThree();
    fs.mkdirSync(path.join(site, "app"));
    fs.writeFileSync(path.join(site, "app", "page.tsx"), "export default 1;\n");
    sh(site, "add", "app/page.tsx");
    sh(site, "commit", "-q", "-m", "feat: code");
    const repo = createGitRepo({ dir: site, roots: [path.join(site, "content")] });
    expect((await repo.pending()).map((c) => c.path)).toEqual(["content/about.md", "content/home.md", "content/legal.md"]);
    await expect(repo.pushPaths(["app/page.tsx"])).rejects.toThrow(/no saved change waiting/);
    await expect(repo.discardPaths(["app/page.tsx"])).rejects.toThrow(/no saved change waiting/);

    expect(await repo.pushPaths(["content/home.md"])).toEqual({ ok: true });
    expect(() => sh(origin, "show", "main:app/page.tsx")).toThrow();
    await repo.discardPaths(["content/about.md", "content/legal.md"]);
    expect(await repo.pending()).toEqual([]);
    // The code commit is still local, unpushed and as it was.
    expect(sh(site, "diff", "--name-only", "@{u}", "HEAD")).toBe("app/page.tsx");
    expect(fs.readFileSync(path.join(site, "app", "page.tsx"), "utf8")).toBe("export default 1;\n");
  });

  it("offers nothing to push or discard once the branch tracks no upstream", async () => {
    const repo = await saveThree();
    sh(site, "branch", "-q", "--unset-upstream");
    expect(await repo.pending()).toEqual([]);
    await expect(repo.pushPaths(["content/home.md"])).rejects.toThrow(/no saved change/);
  });
});
