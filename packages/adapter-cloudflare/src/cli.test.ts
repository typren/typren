import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { runInit, runSyncRedirects, runBootstrap, main } from "./cli";
import type { KvClient } from "./types";
import type { BootstrapClients } from "./cli";

function fakeKvClient(seed: Record<string, string> = {}): KvClient {
  const store = new Map(Object.entries(seed));
  return {
    listKeys: vi.fn(async () => [...store.keys()]),
    putMany: vi.fn(async (pairs) => {
      for (const { key, value } of pairs) store.set(key, value);
    }),
    deleteMany: vi.fn(async (keys) => {
      for (const key of keys) store.delete(key);
    }),
  };
}

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "typren-cloudflare-"));
}

describe("runInit", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("requires --name", () => {
    dir = tmpDir();
    expect(runInit(dir, {})).toEqual({ ok: false, error: expect.stringContaining("--name is required") });
  });

  it("writes wrangler.jsonc", () => {
    dir = tmpDir();
    expect(runInit(dir, { name: "my-site" })).toEqual({ ok: true });
    const config = readFileSync(path.join(dir, "wrangler.jsonc"), "utf8");
    expect(config).toContain('"name": "my-site"');
  });

  it("refuses to overwrite an existing wrangler config without --force", () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.toml"), "name = \"old\"");
    expect(runInit(dir, { name: "my-site" })).toEqual({ ok: false, error: expect.stringContaining("wrangler.toml already exists") });
  });

  it("overwrites with --force", () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), "{}");
    expect(runInit(dir, { name: "my-site", force: true })).toEqual({ ok: true });
    expect(readFileSync(path.join(dir, "wrangler.jsonc"), "utf8")).toContain('"name": "my-site"');
  });

  it("surfaces a validation error from renderWranglerConfig", () => {
    dir = tmpDir();
    expect(runInit(dir, { name: "Not Valid" })).toEqual({ ok: false, error: expect.stringContaining("not a valid Worker name") });
  });
});

describe("runSyncRedirects", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("builds redirects from the content dir and syncs them", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    const client = fakeKvClient();
    const result = await runSyncRedirects(dir, { contentDir: dir }, client);
    expect(result).toEqual({ ok: true, result: { puts: [{ key: "/old-about", value: "/about/" }], deletes: [], applied: true } });
  });

  it("syncs from a --map file alone when there is no typren content", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "redirects.json"), JSON.stringify([{ from: "/legacy", to: "/hub" }]));
    const result = await runSyncRedirects(dir, { contentDir: dir, map: "redirects.json" }, fakeKvClient());
    expect(result).toEqual({ ok: true, result: { puts: [{ key: "/legacy", value: "/hub/" }], deletes: [], applied: true } });
  });

  it("merges frontmatter aliases with the map and refuses a cross-source duplicate", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    writeFileSync(path.join(dir, "redirects.json"), JSON.stringify([{ from: "/old-about", to: "/elsewhere" }]));
    const result = await runSyncRedirects(dir, { contentDir: dir, map: "redirects.json" }, fakeKvClient());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("declared by both") });
  });

  it("syncs targets verbatim with trailingSlash: false", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "redirects.json"), JSON.stringify([{ from: "/legacy", to: "/hub" }]));
    const result = await runSyncRedirects(dir, { contentDir: dir, map: "redirects.json", trailingSlash: false }, fakeKvClient());
    expect(result).toMatchObject({ ok: true, result: { puts: [{ key: "/legacy", value: "/hub" }] } });
  });

  it("dry-run reports the diff without writing", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    const client = fakeKvClient();
    const result = await runSyncRedirects(dir, { contentDir: dir, dryRun: true }, client);
    expect(result).toEqual({ ok: true, result: { puts: [{ key: "/old-about", value: "/about/" }], deletes: [], applied: false } });
    expect(client.putMany).not.toHaveBeenCalled();
  });

  it("surfaces a core validation error instead of throwing", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["not-absolute"]\n---\n');
    const result = await runSyncRedirects(dir, { contentDir: dir }, fakeKvClient());
    expect(result).toEqual({ ok: false, error: expect.stringContaining("invalid alias") });
  });
});

function fakeBootstrapClients(kv: KvClient, calls: string[]): BootstrapClients {
  return {
    kv,
    createNamespace: vi.fn(() => calls.push("create")),
    deploy: vi.fn(() => calls.push("deploy")),
  };
}

describe("runBootstrap", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("errors when no wrangler config exists", async () => {
    dir = tmpDir();
    const result = await runBootstrap(dir, {}, fakeBootstrapClients(fakeKvClient(), []));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("run `typren-cloudflare init` first") });
  });

  it("errors when the assets directory doesn't exist", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), "{}");
    const result = await runBootstrap(dir, {}, fakeBootstrapClients(fakeKvClient(), []));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("does not exist, build the site first") });
  });

  it("creates the namespace, syncs, then deploys, in that order, when the config has no REDIRECTS binding", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), "{}");
    mkdirSync(path.join(dir, "out"));
    const calls: string[] = [];
    const client = fakeKvClient();
    const result = await runBootstrap(dir, {}, fakeBootstrapClients(client, calls));
    expect(result).toMatchObject({ ok: true, createdNamespace: true });
    expect(client.listKeys).toHaveBeenCalled();
    // namespace create happens before deploy; sync (the KV calls) happens
    // between them, asserted via the mock on `client` directly above.
    expect(calls).toEqual(["create", "deploy"]);
  });

  it("skips creating the namespace when the config already has the REDIRECTS binding", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), JSON.stringify({ kv_namespaces: [{ binding: "REDIRECTS", id: "x" }] }));
    mkdirSync(path.join(dir, "out"));
    const calls: string[] = [];
    const result = await runBootstrap(dir, {}, fakeBootstrapClients(fakeKvClient(), calls));
    expect(result).toMatchObject({ ok: true, createdNamespace: false });
    expect(calls).toEqual(["deploy"]);
  });

  it("respects a custom --assets-dir", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.json"), "{}");
    mkdirSync(path.join(dir, "build"));
    const result = await runBootstrap(dir, { assetsDir: "./build" }, fakeBootstrapClients(fakeKvClient(), []));
    expect(result.ok).toBe(true);
  });

  it("does not deploy when the sync step fails", async () => {
    dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), "{}");
    mkdirSync(path.join(dir, "out"));
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["not-absolute"]\n---\n');
    const calls: string[] = [];
    const result = await runBootstrap(dir, { contentDir: dir }, fakeBootstrapClients(fakeKvClient(), calls));
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["create"]); // namespace was created, but deploy never ran
  });
});

describe("main", () => {
  it("prints help with no args", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("typren-cloudflare"));
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

  it("errors when a value-taking flag swallows the next flag", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => void errors.push(String(m)));
    await main(["sync-redirects", "--map", "--dry-run"], { kv: fakeKvClient() });
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/--map requires a value/);
    process.exitCode = 0;
    spy.mockRestore();
  });

  it("dispatches init with --domain repeated and reports success", async () => {
    const dir = tmpDir();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["init", "--name", "my-site", "--domain", "example.com", "--domain", "www.example.com"]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("wrote wrangler.jsonc"));
      const config = readFileSync(path.join(dir, "wrangler.jsonc"), "utf8");
      expect(config).toContain("www.example.com");
    } finally {
      log.mockRestore();
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an init error and sets a non-zero exit code", async () => {
    const dir = tmpDir();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await main(["init"]);
      expect(err).toHaveBeenCalledWith(expect.stringContaining("--name is required"));
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      cwd.mockRestore();
      process.exitCode = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispatches sync-redirects and reports the diff", async () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["/old-about"]\n---\n');
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["sync-redirects", "--content-dir", dir, "--dry-run"], { kv: fakeKvClient() });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("put    /old-about"));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("dry run"));
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports already-in-sync", async () => {
    const dir = tmpDir();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["sync-redirects", "--content-dir", dir], { kv: fakeKvClient() });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("already in sync"));
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a sync-redirects error and sets a non-zero exit code", async () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, "about.md"), '---\nslices: []\naliases: ["not-absolute"]\n---\n');
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await main(["sync-redirects", "--content-dir", dir], { kv: fakeKvClient() });
      expect(err).toHaveBeenCalledWith(expect.stringContaining("invalid alias"));
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispatches bootstrap with injected clients and reports the outcome", async () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, "wrangler.jsonc"), "{}");
    mkdirSync(path.join(dir, "out"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const createNamespace = vi.fn();
    const deploy = vi.fn();
    try {
      await main(["bootstrap"], { kv: fakeKvClient(), createNamespace, deploy });
      expect(createNamespace).toHaveBeenCalled();
      expect(deploy).toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("deployed"));
    } finally {
      log.mockRestore();
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a bootstrap error and sets a non-zero exit code", async () => {
    const dir = tmpDir();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await main(["bootstrap"], { kv: fakeKvClient() });
      expect(err).toHaveBeenCalledWith(expect.stringContaining("run `typren-cloudflare init` first"));
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      cwd.mockRestore();
      process.exitCode = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
