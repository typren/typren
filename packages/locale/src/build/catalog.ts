import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNoHtml } from "../no-html";
import { canonicalize, hashCatalog } from "../canonicalize";
import { diff, isPlaceholderCompatible, merge } from "../delta";
import { resolve } from "../locale";
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

/** The on-disk delta file shape: core's `Delta` plus the additive-merge content address. */
export interface PublishedDelta extends Delta {
  /**
   * Hash of `merge(fromCatalog, delta, {allowRemove:false})`: the catalog an
   * OLD client's additive merge must produce. Pre-wires delta-first OTA. A
   * client applying this delta verifies against `additiveHash`, not the
   * release hash, which a removal release makes unreachable additively.
   */
  additiveHash: string;
}

/** One past release's {app,lang} hashes: the rolling window `buildCatalogs` diffs new catalogs against. */
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

/** Every object key at any depth that contains ".", flatten's separator, reported as its full dot-path. */
function collectDottedKeys(node: Catalog, prefix = ""): string[] {
  const offenders: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key.includes(".")) offenders.push(path);
    if (typeof value !== "string") offenders.push(...collectDottedKeys(value, path));
  }
  return offenders;
}

/**
 * Computes the flat key-path delta between two catalogs via core's `diff`,
 * gates it on placeholder compatibility (a changed string whose `{var}` set
 * differs from the string it replaces would break interpolation on old
 * builds; a publish-time failure, same spirit as `assertNoHtml`), stamps it
 * with `additiveHash`, and optionally writes it to disk when `destPath` is
 * given.
 */
export async function writeDelta(fromCatalog: Catalog, toCatalog: Catalog, destPath?: string): Promise<PublishedDelta> {
  const delta = diff(fromCatalog, toCatalog);

  const incompatible = Object.keys(delta.changed).filter((key) => {
    const fromVal = resolve(fromCatalog, key);
    return fromVal !== undefined && !isPlaceholderCompatible(fromVal.value, delta.changed[key]!);
  });
  if (incompatible.length > 0) {
    throw new Error(
      `writeDelta: incompatible {var} placeholder set for keys: ${incompatible.join(", ")} — version-pin instead of shipping this delta to old builds`,
    );
  }

  const additiveHash = await hashCatalog(merge(fromCatalog, delta, { allowRemove: false }));
  const published: PublishedDelta = { ...delta, additiveHash };
  if (destPath) {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, JSON.stringify(published, null, 2));
  }
  return published;
}

/**
 * Reads every locale from `source` (a dir string, a `SourceConfig`, or an
 * already-built `LocaleSourceProvider`), runs the publish gates on each one:
 * no dotted object keys (flatten uses "." as its path separator, so such a
 * key is ambiguous and an OTA round-trip corrupts it) and core's
 * `assertNoHtml` (throws before anything is written if a translation carries
 * a dangerous tag/handler/URI). It then hashes each via core's `hashCatalog`,
 * and writes `dist/catalog/<app>/<lang>/<hash>.json` + `dist/manifest/<app>.json`.
 * Catalog files are written as the exact canonical bytes the hash covers, so
 * a published file re-hashes to its own filename.
 *
 * Also precomputes `dist/delta/<app>/<lang>/<fromHash>-<toHash>.json` for
 * every still-on-disk release in the last `deltaHistorySize` builds (a
 * rolling history file at `dist/manifest/<app>.history.json` tracks which
 * hashes those were), so an old build's OTA client can request a delta
 * straight from a known-recent hash without a live diff service. A history
 * entry whose catalog file was since pruned is skipped, not an error: that
 * release just falls back to a full-catalog fetch. But if history exists
 * and EVERY prior catalog is missing (fresh CI checkout without the previous
 * publish output), that's warned rather than silently emitting zero deltas.
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
    const dottedKeys = collectDottedKeys(catalog);
    if (dottedKeys.length > 0) {
      throw new Error(
        `buildCatalogs: keys containing "." are not representable (flatten uses "." as the path separator) in ${options.app}/${lang}: ${dottedKeys.join(", ")}`,
      );
    }
    assertNoHtml(catalog, { label: `${options.app}/${lang}` });
    const hash = await hashCatalog(catalog);

    const catalogDir = join(outDir, "catalog", options.app, lang);
    mkdirSync(catalogDir, { recursive: true });
    const catalogPath = join(catalogDir, `${hash}.json`);
    // Published bytes ARE the canonical form the hash covers. A raw-input
    // stringify could differ (key order, unicode form) from what was hashed.
    writeFileSync(catalogPath, canonicalize(catalog));

    // Providers already reject unsafe locale keys; restated as literal
    // comparisons so the prototype-pollution sanitizer is statically provable.
    if (lang === "__proto__" || lang === "constructor" || lang === "prototype") {
      throw new Error(`buildCatalogs: unsafe locale key "${lang}" escaped the provider contract`);
    }
    manifest.apps[options.app]![lang] = { hash };
    catalogPaths[lang] = catalogPath;
  }

  const manifestDir = join(outDir, "manifest");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, `${options.app}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const history = readHistory(outDir, options.app);
  const deltaPaths: string[] = [];
  let deltaCandidates = 0;
  let missingFromPaths = 0;
  for (const [lang, catalog] of Object.entries(catalogsByLang)) {
    const toHash = manifest.apps[options.app]![lang]!.hash;
    for (const release of history) {
      const fromHash = release.hashes[lang];
      if (!fromHash || fromHash === toHash) continue; // no prior release for this lang, or unchanged since it

      deltaCandidates++;
      const fromPath = join(outDir, "catalog", options.app, lang, `${fromHash}.json`);
      if (!existsSync(fromPath)) {
        missingFromPaths++;
        continue; // pruned off disk; that release falls back to a full-catalog fetch
      }

      const fromCatalog: Catalog = JSON.parse(readFileSync(fromPath, "utf8"));
      const destPath = join(outDir, "delta", options.app, lang, `${fromHash}-${toHash}.json`);
      await writeDelta(fromCatalog, catalog, destPath);
      deltaPaths.push(destPath);
    }
  }
  if (deltaCandidates > 0 && missingFromPaths === deltaCandidates) {
    console.warn(
      `buildCatalogs: history for ${options.app} lists ${deltaCandidates} prior release catalog(s) but none exist under ${outDir} — zero deltas emitted (fresh checkout? publish the previous build output alongside).`,
    );
  }

  const currentRelease: ReleaseHistoryEntry = {
    buildVersion: options.buildVersion,
    hashes: Object.fromEntries(Object.entries(manifest.apps[options.app]!).map(([lang, entry]) => [lang, entry.hash])),
  };
  // Dedupe by content hash: an identical rebuild must not occupy another
  // history slot (it would push real releases out of the rolling window).
  const sameHashes = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const deduped = history.filter((release) => !sameHashes(release.hashes, currentRelease.hashes));
  writeHistory(outDir, options.app, [...deduped, currentRelease].slice(-deltaHistorySize));

  return { manifest, manifestPath, catalogPaths, deltaPaths };
}
