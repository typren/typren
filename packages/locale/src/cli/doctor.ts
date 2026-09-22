import { resolveProvider } from "../build";
import { assertNoHtml } from "../no-html";
import type { Catalog } from "../types";
import { readConfigFile } from "./config-file";

export interface DoctorCheck {
  id: string;
  status: "pass" | "fail" | "skip";
  message?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

/**
 * Same dotted-key scan as build/catalog.ts's private `collectDottedKeys`,
 * duplicated rather than imported: it isn't exported (buildCatalogs is the
 * only intended caller), and this is 8 lines, not worth widening that
 * module's public surface for a dry-run report that never writes anything.
 */
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
 * Core of `doctor`: validates `--config`'s shape, reports which `${ENV}`
 * vars it references and whether each is currently set (names only, never
 * values), and, when every var resolves, dry-runs the same publish gates
 * `bake` runs (no dotted keys, no dangerous HTML) against a live
 * `loadSource()` without writing anything to disk.
 */
export async function runDoctor(configPath: string): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  const loaded = readConfigFile(configPath);
  if (!loaded.ok) {
    checks.push({ id: "config.shape", status: "fail", message: loaded.error });
    return { ok: false, checks };
  }
  checks.push({ id: "config.shape", status: "pass" });

  for (const name of loaded.envVarNames) {
    const isSet = process.env[name] !== undefined;
    checks.push({ id: `env.\${${name}}`, status: isSet ? "pass" : "fail", message: isSet ? "set" : "unset" });
  }

  let config;
  try {
    config = loaded.resolve();
  } catch (e) {
    checks.push({ id: "config.env-resolve", status: "fail", message: e instanceof Error ? e.message : String(e) });
    checks.push({ id: "source.reachable", status: "skip", message: "skipped: unresolved env var(s)" });
    return { ok: false, checks };
  }

  try {
    const catalogs = await resolveProvider(config.source).loadSource();
    checks.push({ id: "source.reachable", status: "pass", message: `${Object.keys(catalogs).length} locale(s)` });

    let gatesOk = true;
    for (const [lang, catalog] of Object.entries(catalogs)) {
      const dotted = collectDottedKeys(catalog);
      if (dotted.length > 0) {
        gatesOk = false;
        checks.push({ id: `gate.no-dotted-keys.${lang}`, status: "fail", message: dotted.join(", ") });
      }
      try {
        assertNoHtml(catalog, { label: lang });
      } catch (e) {
        gatesOk = false;
        checks.push({ id: `gate.no-html.${lang}`, status: "fail", message: e instanceof Error ? e.message : String(e) });
      }
    }
    if (gatesOk) checks.push({ id: "gate.publish-checks", status: "pass" });
  } catch (e) {
    checks.push({ id: "source.reachable", status: "fail", message: e instanceof Error ? e.message : String(e) });
  }

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}

export function printDoctorResult(configPath: string, result: DoctorResult): void {
  console.log(`typren-locale doctor: ${configPath}`);
  for (const c of result.checks) {
    console.log(`  [${c.status.padEnd(4)}] ${c.id}${c.message ? `: ${c.message}` : ""}`);
  }
  console.log(result.ok ? "typren-locale doctor: all checks passed." : "typren-locale doctor: one or more checks failed.");
  process.exitCode = result.ok ? 0 : 1;
}

export const DOCTOR_HELP = `usage: typren-locale doctor --config <path>

  Validates --config's shape, reports each referenced \${ENV} var by name
  (set/unset only, values are never printed), and, when every var resolves,
  dry-runs the same publish gates "bake" runs (no dotted keys, no dangerous
  HTML) against a live loadSource() without writing anything to disk.

  --config <path>    Build config file (required).
  --help             Show this help.
`;
