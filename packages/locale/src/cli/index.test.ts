import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("an unknown verb errors with exit code 1", async () => {
    await main(["frobnicate"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('unknown verb "frobnicate"');
  });

  it("pull without --config fails with exit code 1, not a throw", async () => {
    await main(["pull"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("--config <path> is required");
  });

  it("bake without --out fails with exit code 1", async () => {
    await main(["bake", "--config", "whatever.json"]);
    expect(process.exitCode).toBe(1);
  });

  it("diff without two directories fails with exit code 1", async () => {
    await main(["diff", "onlyOneDir"]);
    expect(process.exitCode).toBe(1);
  });

  it("compat rejects a subcommand that isn't 'lokalise2 file download'", async () => {
    await main(["compat", "lokalise2", "file", "upload"]);
    expect(process.exitCode).toBe(1);
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

  it("rejects an invalid --filename-style before touching the filesystem", async () => {
    await main(["pull", "--config", "whatever.json", "--filename-style", "yell"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain('--filename-style must be "dash" or "underscore"');
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
      socket.destroy();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const { port } = proxy.address() as { port: number };
    const env: NodeJS.ProcessEnv = { ...process.env, HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "" };
    delete env.NODE_USE_ENV_PROXY;
    const dir = withTmpDir();
    const child = spawn(
      process.execPath,
      [bin, "compat", "lokalise2", "file", "download", "--token", "t", "--project-id", "p", "--unzip-to", dir],
      { env, stdio: "ignore" },
    );
    await new Promise((r) => child.on("close", r));
    proxy.close();
    rmSync(dir, { recursive: true, force: true });
    expect(connects.length).toBeGreaterThan(0);
  });
});
