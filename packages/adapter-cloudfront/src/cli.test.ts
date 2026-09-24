import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { runSyncRedirects, runBootstrap, main, DEFAULT_STORE_NAME } from "./cli";
import type { KvsClient, CloudFrontClient } from "./types";

function fakeKvsClient(seed: Record<string, string> = {}): KvsClient {
  const store = new Map(Object.entries(seed));
  let etag = "etag-0";
  return {
    describeStore: vi.fn(async () => ({ arn: "arn:store", status: "READY" })),
    listKeys: vi.fn(async () => ({ items: [...store.entries()].map(([key, value]) => ({ key, value })), etag })),
    updateKeys: vi.fn(async (_arn, _etag, puts, deletes) => {
      for (const { key, value } of puts) store.set(key, value);
      for (const key of deletes) store.delete(key);
      etag = "etag-1";
      return { etag };
    }),
  };
}

describe("runSyncRedirects", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("builds redirects from the content dir and syncs them", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');

    const client = fakeKvsClient();
    const result = await runSyncRedirects(dir, { contentDir: dir, storeName: "my-store" }, client);

    expect(result).toEqual({ ok: true, result: { puts: [{ key: "/old-about", value: "/about/" }], deletes: [], applied: true } });
    expect(client.describeStore).toHaveBeenCalledWith("my-store");
  });

  it("syncs from a --map file alone when there is no typren content", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(
      path.join(dir, "redirects.json"),
      JSON.stringify([
        { from: "/legacy", to: "/hub" },
        { from: "/press", to: "https://example.com/story" },
      ])
    );

    const client = fakeKvsClient();
    const result = await runSyncRedirects(dir, { contentDir: dir, map: "redirects.json" }, client);

    expect(result).toEqual({
      ok: true,
      result: {
        puts: [
          { key: "/legacy", value: "/hub/" },
          { key: "/press", value: "https://example.com/story" },
        ],
        deletes: [],
        applied: true,
      },
    });
  });

  it("errors when a value-taking flag swallows the next flag (--map --dry-run)", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message) => void errors.push(String(message)));
    await main(["sync-redirects", "--map", "--dry-run"], { kvs: fakeKvsClient() });
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/--map requires a value/);
    process.exitCode = 0;
    spy.mockRestore();
  });

  it("merges frontmatter aliases with the map and refuses a cross-source duplicate", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    writeFileSync(path.join(dir, "redirects.json"), JSON.stringify([{ from: "/old-about", to: "/elsewhere" }]));

    const result = await runSyncRedirects(dir, { contentDir: dir, map: "redirects.json" }, fakeKvsClient());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("declared by both") });
  });

  it("syncs targets verbatim with trailingSlash: false (bare-URL-canonical site)", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "redirects.json"), JSON.stringify([{ from: "/legacy", to: "/hub" }]));

    const client = fakeKvsClient();
    const result = await runSyncRedirects(
      dir,
      { contentDir: dir, map: "redirects.json", trailingSlash: false },
      client
    );
    expect(result).toMatchObject({ ok: true, result: { puts: [{ key: "/legacy", value: "/hub" }] } });
  });

  it("defaults the store name", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    const client = fakeKvsClient();
    await runSyncRedirects(dir, { contentDir: dir }, client);
    expect(client.describeStore).toHaveBeenCalledWith(DEFAULT_STORE_NAME);
  });

  it("surfaces a core validation error instead of throwing", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["not-absolute"]\n---\n');
    const result = await runSyncRedirects(dir, { contentDir: dir }, fakeKvsClient());
    expect(result).toEqual({ ok: false, error: expect.stringContaining("invalid alias") });
  });
});

describe("runBootstrap", () => {
  it("requires --distribution-id", async () => {
    const result = await runBootstrap({}, fakeKvsClient(), {
      getAttachedFunctionNames: vi.fn(),
      createKeyValueStore: vi.fn(),
      upsertFunction: vi.fn(),
      setViewerRequestFunction: vi.fn(),
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("--distribution-id is required") });
  });

  it("delegates to bootstrapDistribution with the given options", async () => {
    const cf: CloudFrontClient = {
      getAttachedFunctionNames: vi.fn(async () => []),
      createKeyValueStore: vi.fn(async () => ({ arn: "arn:store", status: "READY" })),
      upsertFunction: vi.fn(async () => ({ arn: "arn:function/x" })),
      setViewerRequestFunction: vi.fn(async () => {}),
    };
    const result = await runBootstrap({ distributionId: "E123" }, fakeKvsClient(), cf);
    expect(result.ok).toBe(true);
    expect(cf.setViewerRequestFunction).toHaveBeenCalledWith("E123", "arn:function/x");
  });
});

describe("main", () => {
  it("prints help and exits cleanly with no args", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("typren-cloudfront"));
    log.mockRestore();
  });

  it("prints help on --help even with other args present", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["sync-redirects", "--help"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("typren-cloudfront"));
    log.mockRestore();
  });

  it("errors on an unknown command", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await main(["bogus"]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown command "bogus"'));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });

  it("dispatches sync-redirects with parsed flags and reports the diff", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(
        ["sync-redirects", "--content-dir", dir, "--store", "my-store", "--dry-run"],
        { kvs: fakeKvsClient() }
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("put    /old-about -> /about/"));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("dry run"));
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports already-in-sync when there is nothing to do", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["sync-redirects", "--content-dir", dir], { kvs: fakeKvsClient() });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("already in sync"));
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a sync-redirects error and sets a non-zero exit code", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "typren-content-"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["not-absolute"]\n---\n');
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await main(["sync-redirects", "--content-dir", dir], { kvs: fakeKvsClient() });
      expect(err).toHaveBeenCalledWith(expect.stringContaining("invalid alias"));
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispatches bootstrap with parsed flags and reports the outcome", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cf: CloudFrontClient = {
      getAttachedFunctionNames: vi.fn(async () => []),
      createKeyValueStore: vi.fn(async () => ({ arn: "arn:store", status: "READY" })),
      upsertFunction: vi.fn(async () => ({ arn: "arn:function/x" })),
      setViewerRequestFunction: vi.fn(async () => {}),
    };
    await main(["bootstrap", "--distribution-id", "E123", "--force"], { kvs: fakeKvsClient(), cf });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("published+attached function"));
    log.mockRestore();
  });

  it("prints a bootstrap error and sets a non-zero exit code", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await main(["bootstrap"], { kvs: fakeKvsClient() });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("--distribution-id is required"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });
});
