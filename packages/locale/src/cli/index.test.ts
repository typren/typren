import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, envProxyReexecEnv, reexecWithEnvProxy } from "./index";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-index-"));
}

describe("main (verb router)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("--version prints the package.json version and exits clean", async () => {
    await main(["--version"]);
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version: string };
    expect(logSpy.mock.calls.flat()).toContain(pkg.version);
    expect(process.exitCode).toBeUndefined();
  });

  it("no args prints the global help", async () => {
    await main([]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("typren-locale: build-time CLI");
  });

  it("a known verb's --help prints that verb's help, not the global one", async () => {
    await main(["pull", "--help"]);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("usage: typren-locale pull");
    expect(out).not.toContain("typren-locale: build-time CLI");
  });

  it("an unknown verb errors with exit code 2", async () => {
    await main(["frobnicate"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('unknown verb "frobnicate"');
  });

  it("pull without --config fails with exit code 2, not a throw", async () => {
    await main(["pull"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("--config <path> is required");
  });

  it("bake without --out fails with exit code 2", async () => {
    await main(["bake", "--config", "whatever.json"]);
    expect(process.exitCode).toBe(2);
  });

  it("diff without two directories fails with exit code 2", async () => {
    await main(["diff", "onlyOneDir"]);
    expect(process.exitCode).toBe(2);
  });

  it("compat rejects a subcommand that isn't 'lokalise2 file download'", async () => {
    await main(["compat", "lokalise2", "file", "upload"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("lokalise2 file download");
  });

  it("wires pull's flags through end to end (--config/--out/--filename-style)", async () => {
    const sourceDir = withTmpDir();
    const configDir = withTmpDir();
    const outDir = join(withTmpDir(), "out");
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    const configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));

    try {
      await main(["pull", "--config", configPath, "--out", outDir, "--filename-style", "underscore"]);
      expect(process.exitCode).toBeUndefined();
      expect(readdirSync(outDir)).toEqual(["en.json"]);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("keys --help prints the keys help and the global help lists the verb", async () => {
    await main(["keys", "--help"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("usage: typren-locale keys");
    logSpy.mockClear();
    await main([]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("keys       Create or rotate the manifest signing key.");
  });

  it("keys with a bad action or a missing --config exits 2", async () => {
    await main(["keys", "bogus", "--config", "c.json"]);
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
    await main(["keys", "init"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("--config <path> is required");
  });

  it("keys --json reports a usage error as one JSON document on stdout", async () => {
    await main(["keys", "--json"]);
    expect(process.exitCode).toBe(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false });
  });

  it("keys rejects an unknown flag with a suggestion and exit 2", async () => {
    await main(["keys", "init", "--config", "c.json", "--outt", "k"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("did you mean --out?");
  });

  it("keys init writes the public key and --json prints exactly one JSON line", async () => {
    const repo = withTmpDir();
    mkdirSync(join(repo, ".git"));
    const configPath = join(repo, "locale.config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: "." } }));
    try {
      await main(["keys", "init", "--config", configPath, "--json"]);
      expect(process.exitCode).toBe(0);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const out = JSON.parse(logSpy.mock.calls[0]![0] as string) as { ok: boolean; secret: string };
      expect(out.ok).toBe(true);
      expect(out.secret).toBeTruthy();
      expect(JSON.parse(readFileSync(configPath, "utf8")).publicKeys).toHaveLength(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keys init prints the secret once in human mode", async () => {
    const repo = withTmpDir();
    mkdirSync(join(repo, ".git"));
    const configPath = join(repo, "locale.config.json");
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: "." } }));
    try {
      await main(["keys", "init", "--config", configPath]);
      expect(logSpy.mock.calls.flat().join("\n")).toContain("TYPREN_SIGNING_KEY=");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  describe("bake --expires-in-days", () => {
    beforeEach(() => {
      vi.stubEnv("CI", "");
      vi.stubEnv("TYPREN_SIGNING_KEY", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(["0", "-3", "abc"])("rejects %s with exit 2", async (days) => {
      await main(["bake", "--config", "c.json", "--out", "o", "--expires-in-days", days]);
      expect(process.exitCode).toBe(2);
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("--expires-in-days must be a positive number");
    });

    it("passes a valid value through and bakes an unsigned manifest locally", async () => {
      const dir = withTmpDir();
      const sourceDir = join(dir, "src");
      mkdirSync(sourceDir);
      writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
      const configPath = join(dir, "config.json");
      writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await main(["bake", "--config", configPath, "--out", join(dir, "out"), "--expires-in-days", "7"]);
        expect(process.exitCode).toBeFalsy();
        const manifest = JSON.parse(readFileSync(join(dir, "out", "manifest", "demo.json"), "utf8")) as { issuedAt: string; expiresAt: string };
        expect((Date.parse(manifest.expiresAt) - Date.parse(manifest.issuedAt)) / 86_400_000).toBeCloseTo(7, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("rejects an invalid --filename-style before touching the filesystem", async () => {
    await main(["pull", "--config", "whatever.json", "--filename-style", "yell"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('--filename-style must be "dash" or "underscore"');
  });
  it("suggests the closest verb for a typo", async () => {
    await main(["scna"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('did you mean "scan"');
  });

  it("rejects an unknown flag with a suggestion", async () => {
    await main(["pull", "--confg", "x"]);
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("did you mean --config");
  });

  it("diff with three directories is a usage error", async () => {
    await main(["diff", "a", "b", "c"]);
    expect(process.exitCode).toBe(2);
  });

  it("--json on diff prints one JSON document and nothing human", async () => {
    const a = withTmpDir();
    const b = withTmpDir();
    writeFileSync(join(a, "en.json"), JSON.stringify({ k: "one" }));
    writeFileSync(join(b, "en.json"), JSON.stringify({ k: "two" }));
    try {
      await main(["diff", a, b, "--json"]);
      expect(process.exitCode).toBe(1);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false, hasDifferences: true });
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("diff reports an unreadable directory as exit 2", async () => {
    await main(["diff", join(tmpdir(), "typren-no-such-a"), join(tmpdir(), "typren-no-such-b"), "--json"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false });
  });

  it("--json on a failing pull gives {ok:false,error} and exit 2", async () => {
    await main(["pull", "--config", join(tmpdir(), "typren-missing-config.json"), "--json"]);
    expect(process.exitCode).toBe(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("--json on a succeeding pull prints the result with ok:true", async () => {
    const sourceDir = withTmpDir();
    const outDir = join(withTmpDir(), "out");
    const configPath = join(withTmpDir(), "config.json");
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ k: "v" }));
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
    try {
      await main(["pull", "--config", configPath, "--out", outDir, "--json"]);
      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: true, app: "demo" });
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(dirname(configPath), { recursive: true, force: true });
      rmSync(dirname(outDir), { recursive: true, force: true });
    }
  });

  it("--json on doctor prints configPath and checks", async () => {
    const sourceDir = withTmpDir();
    const configPath = join(withTmpDir(), "config.json");
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ k: "v" }));
    writeFileSync(configPath, JSON.stringify({ app: "demo", source: { type: "files", dir: sourceDir } }));
    try {
      await main(["doctor", "--config", configPath, "--json"]);
      const out = JSON.parse(logSpy.mock.calls[0]![0] as string) as { configPath: string; checks: unknown[]; ok: boolean };
      expect(out.configPath).toBe(configPath);
      expect(out.checks.length).toBeGreaterThan(0);
      expect(process.exitCode).toBe(out.ok ? 0 : 1);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(dirname(configPath), { recursive: true, force: true });
    }
  });

  it("doctor --json on a missing config is exit 1 (a failed check), not 2", async () => {
    await main(["doctor", "--config", join(tmpdir(), "typren-missing-config.json"), "--json"]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false });
  });

  it("compat still parses its subcommand when --json comes first", async () => {
    await main(["compat", "--json", "lokalise2", "file", "download", "--token", "t"]);
    expect(process.exitCode).toBe(2);
    const out = JSON.parse(logSpy.mock.calls[0]![0] as string) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).not.toContain("usage: typren-locale compat");
  });

  it("compat --json with a wrong subcommand reports the usage error as JSON", async () => {
    await main(["compat", "--json", "lokalise2", "file", "upload"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false });
  });

  describe("scan, check, lint routing", () => {
    let dir: string;
    beforeEach(() => {
      dir = withTmpDir();
      writeFileSync(join(dir, "en.json"), JSON.stringify({ "home.title": "Welcome, {name}" }));
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), 't("home.title");');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("scan is routed", async () => {
      await main(["scan", "--locales", dir, "--json", join(dir, "src")]);
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: true });
    });

    it("check is routed", async () => {
      await main(["check", "--locales", dir, "--json"]);
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: true });
    });

    it("lint is routed", async () => {
      await main(["lint", "--format", "icu", "--locales", dir, "--json"]);
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: true });
    });

    it.each(["scan", "check", "lint"])("%s --help prints the verb help", async (verb) => {
      await main([verb, "--help"]);
      expect(logSpy.mock.calls.flat().join("\n")).toContain(`typren-locale ${verb}`);
    });
  });
});

describe("envProxyReexecEnv", () => {
  it("sets NODE_USE_ENV_PROXY only when a proxy var is set and the flag is not", () => {
    expect(envProxyReexecEnv({})).toBeUndefined();
    expect(envProxyReexecEnv({ HTTPS_PROXY: "http://p:1", NODE_USE_ENV_PROXY: "0" })).toBeUndefined();
    expect(envProxyReexecEnv({ https_proxy: "http://p:1" })).toEqual({ https_proxy: "http://p:1", NODE_USE_ENV_PROXY: "1" });
  });
});

describe("reexecWithEnvProxy", () => {
  it("spawns under the flag and relays the exit code; skips when no proxy", () => {
    const run = vi.fn(() => ({ status: 3 })) as never;
    expect(reexecWithEnvProxy({}, run)).toBeUndefined();
    expect(reexecWithEnvProxy({ HTTP_PROXY: "http://p:1" }, run)).toBe(3);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("built CLI behind a proxy", () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli", "index.js");

  // Node only honors NODE_USE_ENV_PROXY from 22.21 / 24.5; older Node ignores it.
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const nodeHonorsEnvProxy = major >= 25 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21);

  // Needs the built bin; `bun run verify` builds before it tests.
  it.skipIf(!existsSync(bin) || !nodeHonorsEnvProxy)("routes fetch through HTTPS_PROXY without NODE_USE_ENV_PROXY", async () => {
    const connects: string[] = [];
    const proxy = createServer();
    proxy.on("connect", (req, socket) => {
      connects.push(req.url ?? "");
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const { port } = proxy.address() as { port: number };
    const env: NodeJS.ProcessEnv = { ...process.env, HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "example.invalid", no_proxy: "example.invalid" };
    delete env.NODE_USE_ENV_PROXY;
    const dir = withTmpDir();
    const child = spawn(
      process.execPath,
      [bin, "compat", "lokalise2", "file", "download", "--token", "t", "--project-id", "p", "--unzip-to", dir],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    await new Promise((r) => child.on("close", r));
    proxy.close();
    rmSync(dir, { recursive: true, force: true });
    expect(connects.length, `node ${process.version}: ${stderr}`).toBeGreaterThan(0);
  }, 30_000);
});
