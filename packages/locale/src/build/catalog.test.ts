import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalize, hashCatalog } from "../canonicalize";
import { diff, merge } from "../delta";
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
    vi.restoreAllMocks();
  });

  it("writes immutable catalog files + a manifest with matching hashes", async () => {
    const en: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const fr: Catalog = { Greeting: { Hello: "Salut {name}" } };
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify(en));
    writeFileSync(join(sourceDir, "fr.json"), JSON.stringify(fr));

    const result = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });

    expect(result.manifest.v).toBe(1);
    expect(result.manifest.buildVersion).toBe("v1");
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
    const first = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    rmSync(join(outDir, "catalog", "demo", "en", `${first.manifest.apps.demo!.en!.hash}.json`));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "new" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/zero deltas/);
  });

  it("does not emit a delta (and does not warn) when a release is unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(sourceDir, "en.json"), JSON.stringify({ A: "same" }));
    await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v1", outDir });
    const second = await buildCatalogs(sourceDir, { app: "demo", buildVersion: "v2", outDir });

    expect(second.deltaPaths).toEqual([]);
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
