import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalize, hashCatalog } from "../canonicalize";
import { diff, merge } from "../delta";
import { generateSigningKey, parseSigningKey, verifyManifestSignature } from "../sign";
import type { SigningKey } from "../sign";
import type { Catalog } from "../types";
import { buildCatalogs, writeDelta } from "./catalog";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-build-"));
}

describe("buildCatalogs", () => {
  let sourceDir: string;
  let outDir: string;
  let signingKey: SigningKey;

  beforeAll(async () => {
    const generated = await generateSigningKey();
    signingKey = parseSigningKey(generated.secret);
  });

  beforeEach(() => {
    sourceDir = withTmpDir();
    outDir = withTmpDir();
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("a custom provider's traversal locale key is refused before it writes outside outDir", async () => {
    const provider = { type: "custom", loadSource: async () => ({ "../../../escaped": { Greeting: "Hi" } }) };
    await expect(buildCatalogs(provider, { app: "demo", buildVersion: "v1", outDir })).rejects.toThrow(/outside the output directory/);
    expect(existsSync(join(outDir, "..", "escaped"))).toBe(false);
  });

  it("a traversal app name is refused for the manifest and history writes too", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    await expect(buildCatalogs(sourceDir, { app: "../../escaped", buildVersion: "v1", outDir })).rejects.toThrow(
      /outside the output directory/,
    );
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses the unsafe app name %s before writing anything", async (app) => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hi" }));
    await expect(buildCatalogs(sourceDir, { app, buildVersion: "v1", outDir })).rejects.toThrow(/unsafe app name/);
    expect(existsSync(join(outDir, "catalog"))).toBe(false);
  });

  it("writes immutable catalog files + a manifest with matching hashes", async () => {
    const en: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const fr: Catalog = { Greeting: { Hello: "Salut {name}" } };
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify(en));
    writeFileSync(join(sourceDir, "fr.json"), JSON.stringify(fr));

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    expect(result.manifest.v).toBe(1);
    expect(result.manifest.buildVersion).toBe("v1");
    expect(Object.keys(result.manifest)).toEqual(["v", "buildVersion", "sequence", "issuedAt", "expiresAt", "apps"]);
    expect(result.manifest.apps.demo!.en!.hash).toBe(await hashCatalog(en));
    expect(result.manifest.apps.demo!.fr!.hash).toBe(await hashCatalog(fr));

    expect(JSON.parse(readFileSync(result.catalogPaths.en!, "utf8"))).toEqual(en);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toEqual(result.manifest);
  });

  it("publishes the exact canonical bytes the hash addresses", async () => {
    // Deliberately unsorted keys + CRLF: a raw-input stringify would differ
    // from what was hashed.
    const en: Catalog = { Zebra: "last", Alpha: "line1\r\nline2" };
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify(en));

    const result = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    const bytes = readFileSync(result.catalogPaths.en!, "utf8");
    expect(bytes).toBe(canonicalize(en));
    expect(await hashCatalog(JSON.parse(bytes))).toBe(result.manifest.apps.demo!.en!.hash);
  });

  it("runs the no-HTML gate before writing — a dangerous translation fails the whole build", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "<script>alert(1)</script>" }));

    await expect(buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir })).rejects.toThrow(/Greeting/);
    expect(existsSync(join(outDir, "manifest", "demo.json"))).toBe(false);
  });

  it("rejects object keys containing '.' at any level, listing the dot-paths", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Nested: { "Key.With.Dots": "x" }, Fine: "ok" }));

    await expect(buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir })).rejects.toThrow(
      /Nested\.Key\.With\.Dots/,
    );
    expect(existsSync(join(outDir, "manifest", "demo.json"))).toBe(false);
  });

  it("accepts a LocaleSourceProvider directly (no fs dir needed)", async () => {
    const provider = {
      type: "inline",
      loadSource: async () => ({ en: { A: "a" } satisfies Catalog }),
    };

    const result = await buildCatalogs(provider, { app: "demo", buildVersion: "v1", outDir });

    expect(result.manifest.apps.demo!.en!.hash).toBe(await hashCatalog({ A: "a" }));
  });

  it("precomputes a delta (with additiveHash) against the immediately prior release", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "old" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    const fromHash = first.manifest.apps.demo!.en!.hash;

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new", B: "added" }));
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });
    const toHash = second.manifest.apps.demo!.en!.hash;

    expect(second.deltaPaths).toHaveLength(1);
    const deltaPath = join(outDir, "delta", "demo", "en", `${fromHash}-${toHash}.json`);
    expect(second.deltaPaths[0]).toBe(deltaPath);

    const written = JSON.parse(readFileSync(deltaPath, "utf8"));
    expect(written.changed).toEqual({ A: "new", B: "added" });
    expect(written.removed).toEqual([]);
    // The hash an OLD client's additive (no-remove) merge must produce.
    const expectedAdditive = await hashCatalog(
      merge({ A: "old" }, diff({ A: "old" }, { A: "new", B: "added" }), { allowRemove: false }),
    );
    expect(written.additiveHash).toBe(expectedAdditive);
    // The client verifies against the manifest's copy, so it must be published there (and on disk).
    expect(second.manifest.apps.demo!.en!.deltas).toEqual({ [fromHash]: expectedAdditive });
    const onDisk = JSON.parse(readFileSync(second.manifestPath, "utf8"));
    expect(onDisk.apps.demo.en.deltas).toEqual({ [fromHash]: expectedAdditive });
  });

  it("fails the publish when a delta'd string changes its {var} placeholder set", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "Hello {name}" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "{count} left" }));
    await expect(buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir })).rejects.toThrow(
      /incompatible \{var\} placeholder set.*Greeting/,
    );
  });

  it("keeps only the last deltaHistorySize releases and skips a hash pruned off disk", async () => {
    const outDirSmall = withTmpDir();
    try {
      for (const version of ["v1", "v2", "v3"]) {
        writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: version }));
        await buildCatalogs(sourceDir, { app: "demo", buildVersion: version, outDir: outDirSmall, deltaHistorySize: 1 });
      }
      const history = JSON.parse(readFileSync(join(outDirSmall, "manifest", "demo.history.json"), "utf8"));
      expect(history).toHaveLength(1);
      expect(history[0].buildVersion).toBe("v3");
    } finally {
      rmSync(outDirSmall, { recursive: true, force: true });
    }
  });

  it("dedupes identical rebuilds so they never push real releases out of the history window", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "original" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, deltaHistorySize: 2 });
    const fromHash = first.manifest.apps.demo!.en!.hash;

    // Two identical rebuilds. Without dedupe these would fill the size-2
    // window and evict v1.
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1-rebuild-a", outDir, deltaHistorySize: 2 });
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1-rebuild-b", outDir, deltaHistorySize: 2 });

    const history = JSON.parse(readFileSync(join(outDir, "manifest", "demo.history.json"), "utf8"));
    expect(history).toHaveLength(1); // one entry per distinct content, not per rebuild

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "changed" }));
    const next = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir, deltaHistorySize: 2 });
    const toHash = next.manifest.apps.demo!.en!.hash;

    // The delta from the original release still gets emitted.
    expect(next.deltaPaths).toEqual([join(outDir, "delta", "demo", "en", `${fromHash}-${toHash}.json`)]);
  });

  it("skips a delta pair when the prior release's catalog file no longer exists on disk", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "old" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    rmSync(join(outDir, "catalog", "demo", "en", `${first.manifest.apps.demo!.en!.hash}.json`));

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new" }));
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });

    expect(second.deltaPaths).toEqual([]);
  });

  it("warns when history exists but every prior catalog is missing (fresh checkout -> zero deltas)", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "old" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, signingKey });
    rmSync(join(outDir, "catalog", "demo", "en", `${first.manifest.apps.demo!.en!.hash}.json`));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir, signingKey });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/zero deltas/);
  });

  it("does not emit a delta (and does not warn) when a release is unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "same" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, signingKey });
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir, signingKey });

    expect(second.deltaPaths).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("buildCatalogs manifest stamping and signing", () => {
  let sourceDir: string;
  let outDir: string;
  const run = (opts: Partial<Parameters<typeof buildCatalogs>[1]> = {}) =>
    buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, ...opts });

  beforeEach(() => {
    sourceDir = withTmpDir();
    outDir = withTmpDir();
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "a" }));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stamps sequence ~ now and expiresAt 30 days later by default, warning once when unsigned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = Date.now();
    const { manifest } = await run();
    expect(manifest.sequence).toBeGreaterThanOrEqual(before);
    expect(manifest.sequence).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(manifest.expiresAt!) - Date.parse(manifest.issuedAt!)).toBe(30 * 86_400_000);
    expect(manifest.signature).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/UNSIGNED/);
  });

  it("is strictly increasing across bakes even with a frozen clock, and survives a garbage previous manifest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const first = await run();
    const second = await run();
    expect(second.manifest.sequence).toBe(first.manifest.sequence! + 1);

    for (const garbage of ["{nope", JSON.stringify({ sequence: 1.5 })]) {
      writeFileSync(second.manifestPath, garbage);
      expect((await run()).manifest.sequence).toBe(Date.now());
    }
  });

  it("honors expiresInDays and rejects a bad one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manifest } = await run({ expiresInDays: 2 });
    expect(Date.parse(manifest.expiresAt!) - Date.parse(manifest.issuedAt!)).toBe(2 * 86_400_000);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(run({ expiresInDays: bad })).rejects.toThrow("expiresInDays must be a positive number");
    }
  });

  it("signs the manifest: the file verifies against the public key and equals the returned manifest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const generated = await generateSigningKey();
    const result = await run({ signingKey: parseSigningKey(generated.secret) });
    const onDisk = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(onDisk).toEqual(result.manifest);
    expect(Object.keys(onDisk).at(-1)).toBe("signature");
    expect(await verifyManifestSignature(onDisk, [{ kid: generated.kid, jwk: generated.publicJwk }])).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("writeDelta", () => {
  it("computes the diff + additiveHash and optionally writes it to disk", async () => {
    const from: Catalog = { A: "old" };
    const to: Catalog = { A: "new", B: "added" };

    const delta = await writeDelta(from, to);
    expect(delta.changed).toEqual({ A: "new", B: "added" });
    expect(delta.removed).toEqual([]);
    expect(delta.additiveHash).toBe(await hashCatalog(merge(from, diff(from, to), { allowRemove: false })));

    const dir = mkdtempSync(join(tmpdir(), "typren-locale-delta-"));
    try {
      const destPath = join(dir, "nested", "delta.json");
      await writeDelta(from, to, destPath);
      expect(JSON.parse(readFileSync(destPath, "utf8"))).toEqual(delta);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws (listing the keys) when a changed string breaks placeholder compatibility", async () => {
    const from: Catalog = { Greeting: "Hello {name}", Other: "same {x}" };
    const to: Catalog = { Greeting: "{count} left", Other: "same {x}" };

    await expect(writeDelta(from, to)).rejects.toThrow(/incompatible \{var\} placeholder set.*Greeting/);
  });

  it("does not gate a brand-new key (nothing to be compatible with)", async () => {
    const from: Catalog = { A: "a" };
    const to: Catalog = { A: "a", B: "new {var}" };

    const delta = await writeDelta(from, to);
    expect(delta.changed).toEqual({ B: "new {var}" });
  });
});

describe("buildCatalogs aliases", () => {
  let sourceDir: string;
  let outDir: string;

  beforeEach(() => {
    sourceDir = withTmpDir();
    outDir = withTmpDir();
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  const readCatalog = (path: string): Catalog => JSON.parse(readFileSync(path, "utf8"));

  it("serves alias copies in the written catalog and the hash covers them", async () => {
    const en: Catalog = { Menu: { Open: "Open" } };
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify(en));
    const aliases = { "Menu.Start": { to: "Menu.Open", since: "2026-01-01" } };

    const result = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, aliases });

    const expected: Catalog = { Menu: { Open: "Open", Start: "Open" } };
    expect(readCatalog(result.catalogPaths.en!)).toEqual(expected);
    expect(result.manifest.apps.demo!.en!.hash).toBe(await hashCatalog(expected));
  });

  it("throws on invalid aliases and writes nothing", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Open: "Open" } }));
    await expect(
      buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir, aliases: { "Menu.Start": { to: "Menu.Missing", since: "2026-01-01" } } }),
    ).rejects.toThrow(/invalid aliases for demo/);
    expect(existsSync(join(outDir, "catalog"))).toBe(false);
    expect(existsSync(join(outDir, "manifest"))).toBe(false);
  });

  it("a delta across a rename keeps the old key and carries the new value", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Open: "Open" } }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Begin: "Open" } }));
    const result = await buildCatalogs(sourceDir, {
      app: "demo",
      buildVersion: "v2",
      outDir,
      aliases: { "Menu.Open": { to: "Menu.Begin", since: "2026-01-01" } },
    });

    expect(result.deltaPaths).toHaveLength(1);
    const delta = JSON.parse(readFileSync(result.deltaPaths[0]!, "utf8"));
    expect(delta.removed ?? []).not.toContain("Menu.Open");
    expect(readCatalog(result.catalogPaths.en!)).toEqual({ Menu: { Begin: "Open", Open: "Open" } });
  });

  it("a rename whose new value changed its {var} set fails the placeholder gate", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Open: "Hi {name}" } }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Begin: "Hi {user}" } }));
    await expect(
      buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir, aliases: { "Menu.Open": { to: "Menu.Begin", since: "2026-01-01" } } }),
    ).rejects.toThrow(/placeholder/);
  });

  it("a decommissioned key gets no copy", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Menu: { Open: "Open" } }));
    const result = await buildCatalogs(sourceDir, {
      app: "demo",
      buildVersion: "v1",
      outDir,
      aliases: { "Menu.Gone": { to: null, since: "2026-01-01" } },
    });
    expect(readCatalog(result.catalogPaths.en!)).toEqual({ Menu: { Open: "Open" } });
  });
});
