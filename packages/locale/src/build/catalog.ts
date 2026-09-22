import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNoHtml } from "../no-html";
import { hashCatalog } from "../canonicalize";
import { diff } from "../delta";
import type { Catalog, Delta, Manifest } from "../types";
import { resolveProvider } from "./resolve-provider";
import type { LocaleSourceProvider, SourceConfig } from "./provider";

export interface BuildOptions {
  app: string;
  buildVersion: string;
  /** Defaults to "dist" (relative to cwd). */
  outDir?: string;
  /** How many past releases to keep precomputed delta files for. Default 5. */
  deltaHistorySize?: number;
}

export interface BuildResult {
  manifest: Manifest;
  manifestPath: string;
  /** lang -> path of the immutable catalog file written for that lang. */
  catalogPaths: Record<string, string>;
  /** Paths of every precomputed delta file written this build (0+ per lang, one per still-available prior release). */
  deltaPaths: string[];
}

/** One past release's {app,lang} hashes — the rolling window `buildCatalogs` diffs new catalogs against. */
interface ReleaseHistoryEntry {
  buildVersion: string;
  hashes: Record<string, string>;
}

function historyPath(outDir: string, app: string): string {
  return join(outDir, "manifest", `${app}.history.json`);
}

function readHistory(outDir: string, app: string): ReleaseHistoryEntry[] {
  const path = historyPath(outDir, app);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeHistory(outDir: string, app: string, history: ReleaseHistoryEntry[]): void {
  const path = historyPath(outDir, app);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(history, null, 2));
}

/**
 * Computes the flat key-path delta between two catalogs via core's `diff`,
 * optionally writing it to disk when `destPath` is given.
 */
export function writeDelta(fromCatalog: Catalog, toCatalog: Catalog, destPath?: string): Delta {
  const delta = diff(fromCatalog, toCatalog);
  if (destPath) {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, JSON.stringify(delta, null, 2));
  }
  return delta;
}

/**
 * Reads every locale from `source` (a dir string, a `SourceConfig`, or an
 * already-built `LocaleSourceProvider`), runs the no-HTML publish gate on
 * each one (core's `assertNoHtml` — throws before anything is written if a
 * translation carries a dangerous tag/handler/URI), hashes each via core's
 * `hashCatalog`, and writes `dist/catalog/<app>/<lang>/<hash>.json` +
 * `dist/manifest/<app>.json`.
 *
 * Also precomputes `dist/delta/<app>/<lang>/<fromHash>-<toHash>.json` for
 * every still-on-disk release in the last `deltaHistorySize` builds (a
 * rolling history file at `dist/manifest/<app>.history.json` tracks which
 * hashes those were) — an old build's OTA client can request a delta
 * straight from a known-recent hash without a live diff service. A history
 * entry whose catalog file was since pruned is skipped, not an error: that
 * release just falls back to a full-catalog fetch.
 */
export async function buildCatalogs(
  source: string | SourceConfig | LocaleSourceProvider,
  options: BuildOptions,
): Promise<BuildResult> {
  const outDir = options.outDir ?? "dist";
  const deltaHistorySize = options.deltaHistorySize ?? 5;
  const provider = resolveProvider(source);
  const catalogsByLang = await provider.loadSource();

  const manifest: Manifest = {
    v: 1,
    buildVersion: options.buildVersion,
    apps: { [options.app]: {} },
  };
  const catalogPaths: Record<string, string> = {};

  for (const [lang, catalog] of Object.entries(catalogsByLang)) {
    assertNoHtml(catalog, { label: `${options.app}/${lang}` });
    const hash = hashCatalog(catalog);

    const catalogDir = join(outDir, "catalog", options.app, lang);
    mkdirSync(catalogDir, { recursive: true });
    const catalogPath = join(catalogDir, `${hash}.json`);
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

    manifest.apps[options.app]![lang] = { hash };
    catalogPaths[lang] = catalogPath;
  }

  const manifestDir = join(outDir, "manifest");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, `${options.app}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const history = readHistory(outDir, options.app);
  const deltaPaths: string[] = [];
  for (const [lang, catalog] of Object.entries(catalogsByLang)) {
    const toHash = manifest.apps[options.app]![lang]!.hash;
    for (const release of history) {
      const fromHash = release.hashes[lang];
      if (!fromHash || fromHash === toHash) continue; // no prior release for this lang, or unchanged since it

      const fromPath = join(outDir, "catalog", options.app, lang, `${fromHash}.json`);
      if (!existsSync(fromPath)) continue; // pruned off disk — that release falls back to a full-catalog fetch

      const fromCatalog: Catalog = JSON.parse(readFileSync(fromPath, "utf8"));
      const destPath = join(outDir, "delta", options.app, lang, `${fromHash}-${toHash}.json`);
      writeDelta(fromCatalog, catalog, destPath);
      deltaPaths.push(destPath);
    }
  }

  const currentRelease: ReleaseHistoryEntry = {
    buildVersion: options.buildVersion,
    hashes: Object.fromEntries(Object.entries(manifest.apps[options.app]!).map(([lang, entry]) => [lang, entry.hash])),
  };
  writeHistory(outDir, options.app, [...history, currentRelease].slice(-deltaHistorySize));

  return { manifest, manifestPath, catalogPaths, deltaPaths };
}
