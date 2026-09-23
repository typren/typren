import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { hashCatalog } from "../canonicalize";
import type { Catalog } from "../types";
import { createFsSourceProvider } from "./fs-provider";
import { createExportApiSourceProvider } from "./export-api";
import type { LocaleSourceProvider } from "./provider";

const BASE_URL = "https://tms.example";
const TOKEN_ENV_VAR = "LOCALE_TEST_TOKEN";
const TOKEN_VALUE = "secret-token";

/**
 * Builds a provider whose `loadSource()` should yield `catalogs` (keyed by
 * RAW producer name, e.g. "en_US") transformed through `normalizeLocaleKey`
 * (with `langMap` when given). Same signature for every provider under test
 * so `describeProviderContract` below stays provider-agnostic.
 */
type ProviderFactory = (
  catalogs: Record<string, Catalog>,
  langMap?: Record<string, string>,
) => LocaleSourceProvider | Promise<LocaleSourceProvider>;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fsFactory(catalogs: Record<string, Catalog>, langMap?: Record<string, string>): LocaleSourceProvider {
  const dir = mkdtempSync(join(tmpdir(), "typren-locale-contract-"));
  tempDirs.push(dir);
  for (const [name, catalog] of Object.entries(catalogs)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(catalog));
  }
  return createFsSourceProvider(dir, langMap);
}

function exportApiZipFactory(catalogs: Record<string, Catalog>, langMap?: Record<string, string>): LocaleSourceProvider {
  const files: Record<string, Uint8Array> = {};
  for (const [name, catalog] of Object.entries(catalogs)) files[`${name}.json`] = strToU8(JSON.stringify(catalog));
  const zipped = zipSync(files);

  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === `${BASE_URL}/export`) return new Response(JSON.stringify({ url: `${BASE_URL}/bundle.zip` }), { status: 200 });
    if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
    throw new Error(`unexpected url in test fetch: ${url}`);
  });

  return createExportApiSourceProvider(
    {
      type: "export-api",
      baseUrl: BASE_URL,
      projectId: "proj-1",
      token: `\${${TOKEN_ENV_VAR}}`,
      create: { path: "/export" },
      response: { urlPath: "url" },
      bundle: "zip",
      langMap,
    },
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  );
}

function exportApiJsonFactory(catalogs: Record<string, Catalog>, langMap?: Record<string, string>): LocaleSourceProvider {
  const doc: Record<string, unknown> = {};
  for (const [name, catalog] of Object.entries(catalogs)) doc[name] = catalog;

  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = String(input);
    // No `response.urlPath` below: the create response body IS the bundle (synchronous, no poll).
    if (url === `${BASE_URL}/export`) return new Response(JSON.stringify(doc), { status: 200 });
    throw new Error(`unexpected url in test fetch: ${url}`);
  });

  return createExportApiSourceProvider(
    {
      type: "export-api",
      baseUrl: BASE_URL,
      projectId: "proj-1",
      token: `\${${TOKEN_ENV_VAR}}`,
      create: { path: "/export" },
      bundle: "json",
      langMap,
    },
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  );
}

/**
 * Assertions every `LocaleSourceProvider` must satisfy, regardless of
 * producer. `factory` builds a provider backed by `catalogs` (raw producer
 * names); the contract itself never knows whether that's a temp directory of
 * files or a mocked HTTP bundle.
 */
function describeProviderContract(name: string, factory: ProviderFactory): void {
  describe(`${name}: LocaleSourceProvider contract`, () => {
    it("loadSource returns catalogs keyed by canonical '-' locales", async () => {
      const provider = await factory({ en_US: { Greeting: "Hi" }, fr: { Greeting: "Salut" } });
      const catalogs = await provider.loadSource();
      expect(Object.keys(catalogs).sort()).toEqual(["en-US", "fr"]);
      expect(catalogs["en-US"]).toEqual({ Greeting: "Hi" });
    });

    it("keys pass through normalizeLocaleKey (a langMap override is honored)", async () => {
      const provider = await factory({ en_US: { Greeting: "Hi" } }, { en_US: "en-custom" });
      const catalogs = await provider.loadSource();
      expect(Object.keys(catalogs)).toEqual(["en-custom"]);
    });

    it("catalogs are plain objects safe for hashCatalog", async () => {
      const provider = await factory({ en: { Greeting: { Hello: "Hi {name}" } } });
      const catalogs = await provider.loadSource();
      expect(catalogs.en).toEqual({ Greeting: { Hello: "Hi {name}" } });
      await expect(hashCatalog(catalogs.en as Catalog)).resolves.toMatch(/^[0-9a-f]{64}$/);
    });

    it("an unsafe '__proto__' key from the wire never lands", async () => {
      const provider = await factory({ ["__proto__"]: { Greeting: "Hi" }, en: { Greeting: "Yo" } });
      const catalogs = await provider.loadSource();
      expect(Object.getPrototypeOf(catalogs)).toBe(Object.prototype);
      expect(Object.keys(catalogs)).not.toContain("__proto__");
    });
  });
}

describe("createFsSourceProvider", () => {
  describeProviderContract("fs", fsFactory);
});

describe("createExportApiSourceProvider", () => {
  beforeEach(() => vi.stubEnv(TOKEN_ENV_VAR, TOKEN_VALUE));
  afterEach(() => vi.unstubAllEnvs());

  describeProviderContract("export-api (zip bundle, synchronous no-poll)", exportApiZipFactory);
  describeProviderContract("export-api (json bundle, synchronous no-poll)", exportApiJsonFactory);

  it("lokalise preset end-to-end: creates a job, polls until 'finished', fetches the zip bundle from the final poll response", async () => {
    const zipped = zipSync({
      "en.json": strToU8(JSON.stringify({ Greeting: "Hi" })),
      "fr.json": strToU8(JSON.stringify({ Greeting: "Salut" })),
    });
    let pollCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${BASE_URL}/projects/proj-1/files/async-download`) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["X-Api-Token"]).toBe(TOKEN_VALUE);
        expect(JSON.parse(init?.body as string)).toMatchObject({ format: "json" });
        return new Response(JSON.stringify({ process_id: "job-1" }), { status: 200 });
      }
      if (url === `${BASE_URL}/projects/proj-1/processes/job-1`) {
        pollCalls++;
        const status = pollCalls < 2 ? "queued" : "finished";
        return new Response(
          JSON.stringify({ process: { status, details: { download_url: `${BASE_URL}/bundle.zip` } } }),
          { status: 200 },
        );
      }
      if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });

    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        preset: "lokalise",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        poll: { intervalMs: 1, timeoutMs: 1000 },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const catalogs = await provider.loadSource();
    expect(catalogs).toEqual({ en: { Greeting: "Hi" }, fr: { Greeting: "Salut" } });
    expect(pollCalls).toBe(2);
  });

  it("crowdin preset end-to-end: polls the dual-mode download endpoint (status body while building, bare URL body when done), substitutes {projectId} in the poll path, and derives locales from zip folders with per-folder merge", async () => {
    const zipped = zipSync({
      "en/strings.json": strToU8(JSON.stringify({ Greeting: "Hi" })),
      "en/extra.json": strToU8(JSON.stringify({ Farewell: "Bye" })),
      "fr/strings.json": strToU8(JSON.stringify({ Greeting: "Salut" })),
    });
    let pollCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${BASE_URL}/projects/proj-1/translations/builds`) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN_VALUE}`);
        return new Response(JSON.stringify({ data: { id: "build-9", status: "created" } }), { status: 200 });
      }
      if (url === `${BASE_URL}/projects/proj-1/translations/builds/build-9/download`) {
        pollCalls++;
        const body = pollCalls < 2 ? { data: { status: "inProgress" } } : { data: { url: `${BASE_URL}/bundle.zip` } };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });

    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        preset: "crowdin",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        poll: { intervalMs: 1, timeoutMs: 1000 },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const catalogs = await provider.loadSource();
    expect(catalogs).toEqual({ en: { Greeting: "Hi", Farewell: "Bye" }, fr: { Greeting: "Salut" } });
    expect(pollCalls).toBe(2);
  });

  it('zipLocaleFrom "dir" rejects a zip entry with no locale folder', async () => {
    const zipped = zipSync({ "en.json": strToU8(JSON.stringify({ Greeting: "Hi" })) });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${BASE_URL}/projects/proj-1/translations/builds`) {
        return new Response(JSON.stringify({ data: { id: "build-9", status: "created" } }), { status: 200 });
      }
      if (url === `${BASE_URL}/projects/proj-1/translations/builds/build-9/download`) {
        return new Response(JSON.stringify({ data: { url: `${BASE_URL}/bundle.zip` } }), { status: 200 });
      }
      if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });

    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        preset: "crowdin",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        poll: { intervalMs: 1, timeoutMs: 1000 },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await expect(provider.loadSource()).rejects.toThrow('no locale folder');
  });

  it("preset override precedence: an explicit create.path wins over the preset's default, the rest of the preset still applies", async () => {
    const zipped = zipSync({ "en.json": strToU8(JSON.stringify({ Greeting: "Hi" })) });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${BASE_URL}/custom-export`) return new Response(JSON.stringify({ process_id: "job-1" }), { status: 200 });
      if (url === `${BASE_URL}/projects/proj-1/processes/job-1`) {
        return new Response(
          JSON.stringify({ process: { status: "finished", details: { download_url: `${BASE_URL}/bundle.zip` } } }),
          { status: 200 },
        );
      }
      if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });

    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        preset: "lokalise",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        create: { path: "/custom-export" },
        poll: { intervalMs: 1, timeoutMs: 1000 },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const catalogs = await provider.loadSource();
    expect(catalogs.en).toEqual({ Greeting: "Hi" });
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("/projects/proj-1/files/async-download"))).toBe(false);
  });

  it("synchronous no-poll mode with no response.urlPath: the create response body IS the bundle (a single request total)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ en: { Greeting: "Hi" } }), { status: 200 }));
    const provider = createExportApiSourceProvider(
      { type: "export-api", baseUrl: BASE_URL, projectId: "proj-1", token: `\${${TOKEN_ENV_VAR}}`, create: { path: "/export" }, bundle: "json" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const catalogs = await provider.loadSource();
    expect(catalogs.en).toEqual({ Greeting: "Hi" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("poll timeout: throws a clear error naming the phase when doneValues/failValues are never reached", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${BASE_URL}/export`) return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
      if (url === `${BASE_URL}/status/job-1`) return new Response(JSON.stringify({ status: "queued" }), { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });
    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        create: { path: "/export" },
        poll: { idPath: "id", path: "/status/{id}", statusPath: "status", doneValues: ["done"], intervalMs: 1, timeoutMs: 5 },
        response: { urlPath: "url" },
        bundle: "json",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/export-api: poll timed out after 5ms/);
  });

  it("poll fail-status: throws naming the failed status", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${BASE_URL}/export`) return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
      if (url === `${BASE_URL}/status/job-1`) return new Response(JSON.stringify({ status: "error" }), { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });
    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        create: { path: "/export" },
        poll: { idPath: "id", path: "/status/{id}", statusPath: "status", doneValues: ["done"], failValues: ["error"], intervalMs: 1 },
        response: { urlPath: "url" },
        bundle: "json",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/export-api: poll failed, status "error"/);
  });

  it("an unsafe '__proto__' segment in a configured dot-path is never followed", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === `${BASE_URL}/export`) return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
      throw new Error(`unexpected url in test fetch: ${String(input)}`);
    });
    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        create: { path: "/export" },
        poll: { idPath: "__proto__.constructor.name", path: "/status/{id}", statusPath: "status", doneValues: ["done"] },
        bundle: "json",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/create response has no poll id at "__proto__\.constructor\.name"/);
  });

  it("a non-.json entry in a zip bundle is rejected with a clear error", async () => {
    const zipped = zipSync({
      "en.json": strToU8(JSON.stringify({ Greeting: "Hi" })),
      "README.txt": strToU8("not a catalog"),
    });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${BASE_URL}/export`) return new Response(JSON.stringify({ url: `${BASE_URL}/bundle.zip` }), { status: 200 });
      if (url === `${BASE_URL}/bundle.zip`) return new Response(zipped, { status: 200 });
      throw new Error(`unexpected url in test fetch: ${url}`);
    });
    const provider = createExportApiSourceProvider(
      {
        type: "export-api",
        baseUrl: BASE_URL,
        projectId: "proj-1",
        token: `\${${TOKEN_ENV_VAR}}`,
        create: { path: "/export" },
        response: { urlPath: "url" },
        bundle: "zip",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/README\.txt.*not a \.json file/);
  });

  it('a literal-looking token (no "${}") is rejected with a clear error', async () => {
    const provider = createExportApiSourceProvider(
      { type: "export-api", baseUrl: BASE_URL, projectId: "proj-1", token: "sk-literal-secret", create: { path: "/export" }, bundle: "json" },
      { fetchImpl: vi.fn() as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/must be a "\$\{ENV_VAR\}" reference/);
  });

  it("an unknown preset name throws a clear error", async () => {
    const provider = createExportApiSourceProvider(
      { type: "export-api", preset: "not-a-real-tms", projectId: "proj-1", token: `\${${TOKEN_ENV_VAR}}` },
      { fetchImpl: vi.fn() as unknown as typeof fetch },
    );
    await expect(provider.loadSource()).rejects.toThrow(/unknown preset "not-a-real-tms"/);
  });
});
