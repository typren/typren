import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashCatalog } from "../canonicalize";
import type { Catalog } from "../types";
import { buildCatalogs, writeDelta } from "./catalog";

function withTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "typren-locale-build-"));
}

describe("buildCatalogs", () => {
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

  it("writes immutable catalog files + a manifest with matching hashes", async () => {
    const en: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const fr: Catalog = { Greeting: { Hello: "Salut {name}" } };
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify(en));
    writeFileSync(join(sourceDir, "fr.json"), JSON.stringify(fr));

    const result = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    expect(result.manifest.v).toBe(1);
    expect(result.manifest.buildVersion).toBe("v1");
    expect(result.manifest.apps.demo!.en!.hash).toBe(hashCatalog(en));
    expect(result.manifest.apps.demo!.fr!.hash).toBe(hashCatalog(fr));

    expect(JSON.parse(readFileSync(result.catalogPaths.en!, "utf8"))).toEqual(en);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toEqual(result.manifest);
  });

  it("runs the no-HTML gate before writing — a dangerous translation fails the whole build", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ Greeting: "<script>alert(1)</script>" }));

    await expect(buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir })).rejects.toThrow(/Greeting/);
    expect(existsSync(join(outDir, "manifest", "demo.json"))).toBe(false);
  });

  it("accepts a LocaleSourceProvider directly (no fs dir needed)", async () => {
    const provider = {
      type: "inline",
      loadRawEntries: async () => ({}),
      loadSource: async () => ({ en: { A: "a" } satisfies Catalog }),
    };

    const result = await buildCatalogs(provider, { app: "demo", buildVersion: "v1", outDir });

    expect(result.manifest.apps.demo!.en!.hash).toBe(hashCatalog({ A: "a" }));
  });

  it("precomputes a delta against the immediately prior release", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "old" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    const fromHash = first.manifest.apps.demo!.en!.hash;

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new", B: "added" }));
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });
    const toHash = second.manifest.apps.demo!.en!.hash;

    expect(second.deltaPaths).toHaveLength(1);
    const deltaPath = join(outDir, "delta", "demo", "en", `${fromHash}-${toHash}.json`);
    expect(second.deltaPaths[0]).toBe(deltaPath);
    expect(JSON.parse(readFileSync(deltaPath, "utf8"))).toEqual({ changed: { A: "new", B: "added" }, removed: [] });
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

  it("skips a delta pair when the prior release's catalog file no longer exists on disk", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "old" }));
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    rmSync(join(outDir, "catalog", "demo", "en", `${first.manifest.apps.demo!.en!.hash}.json`));

    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new" }));
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });

    expect(second.deltaPaths).toEqual([]);
  });

  it("does not emit a delta when a release is unchanged", async () => {
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "same" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });

    expect(second.deltaPaths).toEqual([]);
  });
});

describe("writeDelta", () => {
  it("computes the diff and optionally writes it to disk", async () => {
    const from: Catalog = { A: "old" };
    const to: Catalog = { A: "new", B: "added" };

    const delta = writeDelta(from, to);
    expect(delta).toEqual({ changed: { A: "new", B: "added" }, removed: [] });

    const dir = withTmpDir();
    try {
      const destPath = join(dir, "nested", "delta.json");
      writeDelta(from, to, destPath);
      expect(JSON.parse(readFileSync(destPath, "utf8"))).toEqual(delta);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
