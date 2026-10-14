import { describe, it, expect, vi } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createGithubAdapter, isAllowedRepoPath } from "./github-adapter";
import { createStore } from "./store";
import { ConflictError, versionOf } from "./version";

// --- a tiny in-memory fake of the GitHub Contents API, driving the adapter
// through a real fetch-shaped function so tests exercise the actual request/
// response handling (URLs, base64, sha compare-and-swap) with no network. ---

type FakeFile = { content: string; sha: string };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeFakeGithub() {
  const files = new Map<string, FakeFile>();
  let shaCounter = 0;
  const nextSha = () => `sha-${++shaCounter}`;

  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const relPath = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\/?/, ""));
    const method = init?.method ?? "GET";

    if (method === "GET") {
      const exact = files.get(relPath);
      if (exact) {
        return jsonResponse(200, {
          type: "file",
          content: Buffer.from(exact.content, "utf8").toString("base64"),
          encoding: "base64",
          sha: exact.sha,
        });
      }
      // Directory listing: any stored path nested under relPath.
      const prefix = relPath === "" ? "" : `${relPath}/`;
      const childNames = new Set<string>();
      for (const p of files.keys()) {
        if (p.startsWith(prefix)) childNames.add(p.slice(prefix.length).split("/")[0]);
      }
      if (childNames.size === 0) return jsonResponse(404, { message: "Not Found" });
      return jsonResponse(
        200,
        [...childNames].map((name) => ({ type: files.has(prefix + name) ? "file" : "dir", name }))
      );
    }

    if (method === "PUT") {
      const body = JSON.parse(init!.body as string) as { content: string; sha?: string };
      const existing = files.get(relPath);
      if (existing && body.sha !== existing.sha) return jsonResponse(409, { message: "sha does not match" });
      const sha = nextSha();
      files.set(relPath, { content: Buffer.from(body.content, "base64").toString("utf8"), sha });
      return jsonResponse(existing ? 200 : 201, { content: { sha } });
    }

    if (method === "DELETE") {
      const body = JSON.parse(init!.body as string) as { sha: string };
      const existing = files.get(relPath);
      if (!existing) return jsonResponse(404, { message: "Not Found" });
      if (body.sha !== existing.sha) return jsonResponse(409, { message: "sha does not match" });
      files.delete(relPath);
      return jsonResponse(200, {});
    }

    throw new Error(`fake GitHub: unexpected method ${method}`);
  });

  return { fetchImpl, files };
}

function makeAdapter(overrides: Partial<Parameters<typeof createGithubAdapter>[0]> = {}) {
  const { fetchImpl, files } = makeFakeGithub();
  const adapter = createGithubAdapter({
    owner: "acme",
    repo: "site",
    token: "ghs_test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return { adapter, fetchImpl, files };
}

describe("isAllowedRepoPath", () => {
  const roots = ["content", "public/img"];

  it.each([
    ["a page inside content/", "content/about.md"],
    ["a locale subpath inside content/", "content/fr/about.md"],
    ["a file inside the media dir", "public/img/logo.webp"],
    ["the root itself", "content"],
  ])("allows %s", (_name, p) => {
    expect(isAllowedRepoPath(p, roots)).toBe(true);
  });

  it.each([
    ["a directory traversal", "content/../../etc/passwd"],
    ["a bare '..'", ".."],
    ["an absolute path", "/etc/passwd"],
    ["a dotfile inside content/", "content/.env"],
    ["a path under .github/", ".github/workflows/ci.yml"],
    ["a manifest filename inside content/", "content/package.json"],
    ["a manifest filename inside the media dir", "public/img/bun.lock"],
    ["a sibling directory that merely starts with the same prefix", "content-secrets/leak.md"],
  ])("rejects %s", (_name, p) => {
    expect(isAllowedRepoPath(p, roots)).toBe(false);
  });
});

describe("createGithubAdapter: read/write/delete round-trip", () => {
  it("writes then reads a published page back", async () => {
    const { adapter } = makeAdapter();
    await adapter.writeRaw("about", "---\nslices: []\n---\nhello");
    expect(await adapter.exists("about")).toBe(true);
    expect(await adapter.readRaw("about")).toBe("---\nslices: []\n---\nhello");
  });

  it("keeps drafts and published content at separate paths", async () => {
    const { adapter } = makeAdapter();
    await adapter.writeRaw("about", "published");
    await adapter.writeDraftRaw("about", "draft");
    expect(await adapter.readRaw("about")).toBe("published");
    expect(await adapter.readDraftRaw("about")).toBe("draft");
    expect(await adapter.hasDraft("about")).toBe(true);
  });

  it("readDraftRaw returns null and readRaw throws for content that was never written", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.readDraftRaw("nope")).toBeNull();
    await expect(adapter.readRaw("nope")).rejects.toThrow(/does not exist/);
  });

  it("delete is idempotent: no-op, not an error, when the file is already absent", async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await adapter.deletePublished("never-existed");
    await adapter.deleteDraft("never-existed");
    // Both resolved to a 404-driven GET with no follow-up DELETE call.
    expect(fetchImpl.mock.calls.every(([, init]) => (init?.method ?? "GET") !== "DELETE")).toBe(true);
  });

  it("deletes a file that exists", async () => {
    const { adapter } = makeAdapter();
    await adapter.writeRaw("about", "content");
    await adapter.deletePublished("about");
    expect(await adapter.exists("about")).toBe(false);
  });

  it("round-trips unicode content through the base64 encode/decode", async () => {
    const { adapter } = makeAdapter();
    const text = "---\nslices: []\n---\nCafé — 世界 🎉";
    await adapter.writeRaw("unicode", text);
    expect(await adapter.readRaw("unicode")).toBe(text);
  });
});

describe("createGithubAdapter: listSlugs", () => {
  it("lists only .md files, sorted, and returns [] for a directory that doesn't exist", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.listSlugs()).toEqual([]);
    await adapter.writeRaw("zebra", "z");
    await adapter.writeRaw("about", "a");
    await adapter.writeDraftRaw("draft-only", "d"); // lives under content/.drafts/, not content/
    expect(await adapter.listSlugs()).toEqual(["about", "zebra"]);
  });

  it("listLocales reports only the locales that actually have the page", async () => {
    const { adapter } = makeAdapter({ locales: ["en", "fr"], defaultLocale: "en" });
    await adapter.writeRaw("about", "en content");
    expect(await adapter.listLocales("about")).toEqual(["en"]);
    await adapter.writeRaw("about", "fr content", "fr");
    expect(await adapter.listLocales("about")).toEqual(["en", "fr"]);
  });
});

describe("createGithubAdapter: compare-and-swap", () => {
  it("rejects a write whose cached sha is stale (someone else wrote in between)", async () => {
    const { adapter, files } = makeAdapter();
    await adapter.writeRaw("about", "v1"); // adapter now caches this write's sha

    // Simulate a concurrent external commit landing between our last known
    // sha and our next write: mutate the backing store directly, bypassing
    // the adapter (and its cache) entirely.
    files.set("content/about.md", { content: "v2 from someone else", sha: "external-sha" });

    await expect(adapter.writeRaw("about", "v3 from us")).rejects.toThrow(ConflictError);
    // The rejected write must not have clobbered the concurrent one.
    expect(files.get("content/about.md")?.content).toBe("v2 from someone else");
  });

  it("rejects a delete whose cached sha is stale", async () => {
    const { adapter, files } = makeAdapter();
    await adapter.writeRaw("about", "v1");
    files.set("content/about.md", { content: "v2", sha: "external-sha" });
    await expect(adapter.deletePublished("about")).rejects.toThrow(ConflictError);
  });

  it("a cold cache fetches the current sha before its first PUT (still CAS'd, just not cache-warmed yet)", async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await adapter.writeRaw("first-write", "content");
    const getCalls = fetchImpl.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET");
    expect(getCalls.length).toBeGreaterThan(0);
  });
});

describe("createGithubAdapter: opts.expectedVersion CAS", () => {
  it("writes through when expectedVersion matches the path's current content version", async () => {
    const { adapter, files } = makeAdapter();
    await adapter.writeDraftRaw("about", "v1");
    const v1 = versionOf("v1");
    await adapter.writeDraftRaw("about", "v2", undefined, { expectedVersion: v1 });
    expect(files.get("content/_drafts/about.md")?.content).toBe("v2");
  });

  it("rejects when expectedVersion doesn't match the path's current content version, without clobbering it", async () => {
    const { adapter, files } = makeAdapter();
    await adapter.writeDraftRaw("about", "v1");
    await expect(adapter.writeDraftRaw("about", "v2", undefined, { expectedVersion: "not-the-real-version" })).rejects.toThrow(
      ConflictError
    );
    expect(files.get("content/_drafts/about.md")?.content).toBe("v1");
  });

  it("never lets a cached sha from another path's write stand in for this write's checked version", async () => {
    // Two different paths: writing "other" must not poison "about"'s cache
    // entry, since the CAS check is per-path.
    const { adapter } = makeAdapter();
    await adapter.writeDraftRaw("about", "v1");
    await adapter.writeDraftRaw("other", "unrelated");
    const v1 = versionOf("v1");
    await adapter.writeDraftRaw("about", "v2", undefined, { expectedVersion: v1 }); // still valid for "about"
    expect(await adapter.readDraftRaw("about")).toBe("v2");
  });

  it("re-GETs and rejects when a concurrent write already moved the cache past expectedVersion", async () => {
    // A first write updates the cache to v2's version; a second write still
    // checked against v1 must re-fetch the server's current truth (not trust
    // its own now-stale pre-write cache read) and reject.
    const { adapter, files } = makeAdapter();
    await adapter.writeDraftRaw("about", "v1");
    const v1 = versionOf("v1");
    await adapter.writeDraftRaw("about", "v2", undefined, { expectedVersion: v1 }); // cache now holds v2's version
    await expect(adapter.writeDraftRaw("about", "v3", undefined, { expectedVersion: v1 })).rejects.toThrow(ConflictError);
    expect(files.get("content/_drafts/about.md")?.content).toBe("v2");
  });
});

describe("store.saveDraft against createGithubAdapter: the documented expectedVersion upgrade path", () => {
  it("two interleaved saveDrafts with the same baseVersion: the second throws ConflictError", async () => {
    // Integration check that store.saveDraft actually threads `baseVersion`
    // through to the adapter as `opts.expectedVersion` (not just that store.ts's
    // own pre-check catches a stale save, which store.test.ts already covers
    // against a non-atomic adapter): request A's write moves the GitHub-side
    // version; request B, built from the same stale `base`, must fail even
    // though nothing here relies on B's own in-process pre-check timing.
    const { adapter } = makeAdapter();
    const store = createStore(adapter);
    await store.saveDraft("about", { meta: {}, slices: [], body: "v1" });
    const base = (await store.currentVersion("about"))!;

    await store.saveDraft("about", { meta: {}, slices: [], body: "from request A" }, base);
    await expect(store.saveDraft("about", { meta: {}, slices: [], body: "from request B" }, base)).rejects.toThrow(
      ConflictError
    );
    expect((await store.getDraft("about"))!.body.trim()).toBe("from request A");
  });
});

describe("createGithubAdapter: readInit", () => {
  it("merges readInit's RequestInit into every GET, never a write", async () => {
    const { fetchImpl } = makeFakeGithub();
    const readInit = vi.fn((relPath: string) => ({ cache: "force-cache" as const, headers: { "x-rel": relPath } }));
    const adapter = createGithubAdapter({
      owner: "acme",
      repo: "site",
      token: "ghs_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readInit,
    });

    await adapter.writeRaw("about", "content"); // a write: readInit must not be consulted for the PUT
    await adapter.readRaw("about"); // a read: readInit's RequestInit must be merged in

    const putCall = fetchImpl.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(putCall[1]?.cache).toBeUndefined();
    const getCall = fetchImpl.mock.calls.find(([, init]) => (init?.method ?? "GET") === "GET" && init?.cache)!;
    expect(getCall[1]?.cache).toBe("force-cache");
    expect(readInit).toHaveBeenCalledWith("content/about.md");
  });
});

describe("createGithubAdapter contract", () => {
  createContentAdapterContractSuite(() => makeAdapter().adapter);
});

describe("createGithubAdapter: write-path allowlist enforcement", () => {
  it("rejects a slug shaped like a traversal attempt before ever calling fetch", async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await expect(adapter.readRaw("../../.github/workflows/ci")).rejects.toThrow(/unsafe slug/);
    await expect(adapter.writeRaw("../secrets", "pwned")).rejects.toThrow(/unsafe slug/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unconfigured locale before calling fetch", async () => {
    const { adapter, fetchImpl } = makeAdapter({ locales: ["en"], defaultLocale: "en" });
    await expect(adapter.readRaw("about", "fr")).rejects.toThrow(/unknown locale/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
