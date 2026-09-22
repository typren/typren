import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "../types";
import {
  buildExportApiSourceConfig,
  parseLokaliseYamlConfig,
  printCompatResult,
  resolveCompatCredentials,
  runCompatDownload,
} from "./compat";

const SECRET_TOKEN = "sk-super-secret-lokalise-token-do-not-leak";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-cli-compat-"));
}

function stubProvider(catalogs: Record<string, Catalog>) {
  return { type: "export-api", loadSource: async () => catalogs };
}

describe("parseLokaliseYamlConfig", () => {
  it("parses api-token and project-id from a lokalise2-style config.yml", () => {
    const text = `api-token: ${SECRET_TOKEN}\nproject-id: "12345.abc"\n`;
    expect(parseLokaliseYamlConfig(text)).toEqual({ apiToken: SECRET_TOKEN, projectId: "12345.abc" });
  });

  it("falls back to a bare 'token' key and strips surrounding quotes", () => {
    const text = `token: '${SECRET_TOKEN}'\nproject-id: 999\n`;
    expect(parseLokaliseYamlConfig(text)).toEqual({ apiToken: SECRET_TOKEN, projectId: "999" });
  });

  it("trims surrounding whitespace outside any quotes", () => {
    const text = `token:   ${SECRET_TOKEN}  \nproject-id: 999\n`;
    expect(parseLokaliseYamlConfig(text)).toEqual({ apiToken: SECRET_TOKEN, projectId: "999" });
  });

  it("returns undefined fields when the keys aren't present", () => {
    expect(parseLokaliseYamlConfig("unrelated: value\n")).toEqual({ apiToken: undefined, projectId: undefined });
  });
});

describe("resolveCompatCredentials", () => {
  let dir: string;

  beforeEach(() => {
    dir = withTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads token/project-id from --config's config.yml", () => {
    const configPath = join(dir, "config.yml");
    writeFileSync(configPath, `api-token: ${SECRET_TOKEN}\nproject-id: 42\n`);
    expect(resolveCompatCredentials({ config: configPath })).toEqual({ ok: true, token: SECRET_TOKEN, projectId: "42" });
  });

  it("--token/--project-id override whatever --config carries", () => {
    const configPath = join(dir, "config.yml");
    writeFileSync(configPath, `api-token: from-config\nproject-id: from-config-id\n`);
    const result = resolveCompatCredentials({ config: configPath, token: "from-flag", "project-id": "flag-id" });
    expect(result).toEqual({ ok: true, token: "from-flag", projectId: "flag-id" });
  });

  it("works from --token/--project-id alone, with no --config", () => {
    expect(resolveCompatCredentials({ token: "t", "project-id": "p" })).toEqual({ ok: true, token: "t", projectId: "p" });
  });

  it("errors when neither --config nor --token/--project-id resolve both values", () => {
    const result = resolveCompatCredentials({});
    expect(result).toEqual({ ok: false, error: expect.stringContaining("could not resolve token/project-id") });
  });

  it("errors when --config points at a missing file", () => {
    const result = resolveCompatCredentials({ config: join(dir, "missing.yml") });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });
});

describe("buildExportApiSourceConfig", () => {
  it("emits the locked { type, preset, projectId, token } shape", () => {
    expect(buildExportApiSourceConfig({ token: SECRET_TOKEN, projectId: "42" })).toEqual({
      type: "export-api",
      preset: "lokalise",
      projectId: "42",
      token: SECRET_TOKEN,
    });
  });
});

describe("runCompatDownload", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = join(withTmpDir(), "out");
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("errors when no target directory is given", async () => {
    const result = await runCompatDownload({ flags: {} });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("missing target directory") });
  });

  it("accepts --unzip-to, --dest, or --output as the target directory", async () => {
    const provider = stubProvider({ en: { Greeting: "Hi" } });
    for (const flagName of ["unzip-to", "dest", "output"]) {
      const dir = join(withTmpDir(), "out");
      const result = await runCompatDownload({ flags: { [flagName]: dir }, provider });
      expect(result.ok).toBe(true);
      if (result.ok) expect(readdirSync(dir)).toEqual(["en.json"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes underscore-style filenames by default", async () => {
    const provider = stubProvider({ "en-US": { Greeting: "Hi" } });
    const result = await runCompatDownload({ flags: { "unzip-to": outDir }, provider });
    expect(result.ok).toBe(true);
    expect(readdirSync(outDir)).toEqual(["en_US.json"]);
    expect(JSON.parse(readFileSync(join(outDir, "en_US.json"), "utf8"))).toEqual({ Greeting: "Hi" });
  });

  it("collects the accepted-but-ignored flags for the notice line, without acting on them", async () => {
    const provider = stubProvider({ en: { Greeting: "Hi" } });
    const result = await runCompatDownload({
      flags: { "unzip-to": outDir, format: "json", async: true, indentation: "2" },
      provider,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ignoredFlags.sort()).toEqual(["async", "format", "indentation"]);
  });

  it("surfaces a provider load failure as a clean error", async () => {
    const failingProvider = { type: "export-api", loadSource: async () => { throw new Error("network down"); } };
    const result = await runCompatDownload({ flags: { "unzip-to": outDir }, provider: failingProvider });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("network down") });
  });
});

describe("token never appears in output", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = withTmpDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function allLoggedText(): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n");
  }

  it("never logs the token, from config.yml parsing through a full successful download", async () => {
    const configPath = join(dir, "config.yml");
    writeFileSync(configPath, `api-token: ${SECRET_TOKEN}\nproject-id: 42\n`);
    const outDir = join(dir, "out");

    const credentials = resolveCompatCredentials({ config: configPath });
    expect(credentials.ok).toBe(true);
    if (!credentials.ok) return;

    const source = buildExportApiSourceConfig(credentials);
    expect(source.token).toBe(SECRET_TOKEN); // the object legitimately carries it in memory

    const provider = stubProvider({ en: { Greeting: "Hi" } });
    const result = await runCompatDownload({ flags: { "unzip-to": outDir }, provider });
    printCompatResult(result);

    expect(allLoggedText()).not.toContain(SECRET_TOKEN);
  });

  it("never logs the token on a failure path either (missing target dir after credentials would resolve)", async () => {
    const configPath = join(dir, "config.yml");
    writeFileSync(configPath, `api-token: ${SECRET_TOKEN}\nproject-id: 42\n`);

    const result = await runCompatDownload({ flags: { config: configPath } }); // no target dir
    printCompatResult(result);

    expect(result.ok).toBe(false);
    expect(allLoggedText()).not.toContain(SECRET_TOKEN);
  });
});
