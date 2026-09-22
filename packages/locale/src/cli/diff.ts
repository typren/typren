import { createFsSourceProvider } from "../build";
import { diff } from "../delta";
import { resolve } from "../locale";
import type { Catalog } from "../types";

export interface LocaleDiffReport {
  locale: string;
  added: number;
  changed: number;
  removed: number;
}

export interface DiffReportResult {
  reports: LocaleDiffReport[];
  hasDifferences: boolean;
}

/**
 * Core of `diff <dirA> <dirB>`: loads both directories through the plain
 * `files` provider and runs core's `diff` per locale (a locale present on
 * only one side diffs against `{}`, which reports it as fully added or fully
 * removed for free). This is a CONTENT comparison only: a key's flattened
 * dot-path and value, nothing else. Filename style (dash vs underscore) and
 * JSON indentation are both normalized away by loading through the provider
 * rather than comparing bytes, which is deliberate: this is the
 * migration-verification tool, and a filename or formatting difference
 * between an old and new export pipeline is exactly the kind of noise it
 * must NOT report as a difference.
 *
 * `diff`'s own `changed` bucket lumps together a brand-new key and a
 * modified one (it's a flat map, not a from/to pair), so "added" vs
 * "changed" is split here by checking whether the key resolves in the
 * source catalog at all.
 */
export async function diffLocaleDirs(dirA: string, dirB: string): Promise<DiffReportResult> {
  const [catalogsA, catalogsB] = await Promise.all([
    createFsSourceProvider(dirA).loadSource(),
    createFsSourceProvider(dirB).loadSource(),
  ]);

  const locales = [...new Set([...Object.keys(catalogsA), ...Object.keys(catalogsB)])].sort();

  const reports: LocaleDiffReport[] = locales.map((locale) => {
    const fromCatalog: Catalog = catalogsA[locale] ?? {};
    const toCatalog: Catalog = catalogsB[locale] ?? {};
    const delta = diff(fromCatalog, toCatalog);

    let added = 0;
    let changed = 0;
    for (const key of Object.keys(delta.changed)) {
      if (resolve(fromCatalog, key) === undefined) added++;
      else changed++;
    }
    return { locale, added, changed, removed: delta.removed.length };
  });

  const hasDifferences = reports.some((r) => r.added > 0 || r.changed > 0 || r.removed > 0);
  return { reports, hasDifferences };
}

export function printDiffResult(dirA: string, dirB: string, result: DiffReportResult): void {
  console.log(`typren-locale diff: ${dirA} vs ${dirB}`);
  for (const r of result.reports) {
    console.log(`  ${r.locale}: +${r.added} ~${r.changed} -${r.removed}`);
  }
  console.log(result.hasDifferences ? "typren-locale diff: content differs." : "typren-locale diff: content-equal.");
  process.exitCode = result.hasDifferences ? 1 : 0;
}

export const DIFF_HELP = `usage: typren-locale diff <dirA> <dirB>

  Per-locale CONTENT comparison of two locale directories (each loaded
  through the plain "files" provider), reporting added/changed/removed key
  counts per locale. Filename style and JSON indentation differences between
  the two directories are deliberately invisible: this is the
  migration-verification tool, comparing what a client reads, not the bytes
  on disk.

  Exit 0 when the two directories are content-equal, 1 when they differ.
`;
