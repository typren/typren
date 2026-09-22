import { existsSync, readFileSync } from "node:fs";
import { collectEnvVarNames, resolveConfigEnv, type BuildConfig } from "../build";

export type ReadConfigFileResult =
  | { ok: true; raw: BuildConfig; envVarNames: string[]; resolve: () => BuildConfig }
  | { ok: false; error: string };

function isBuildConfigShape(value: unknown): value is BuildConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { app: unknown }).app === "string" &&
    typeof (value as { source: unknown }).source === "object" &&
    (value as { source: unknown }).source !== null
  );
}

/**
 * Reads and JSON-parses a build config file (the `{ app, source }` shape
 * config.ts's `resolveConfigEnv` expects), shared by every verb that takes
 * `--config <path>`. Shape validation happens here, before any `${VAR}`
 * interpolation: `resolveConfigEnv` itself only throws for a missing var, so
 * a config that's the wrong shape entirely needs its own clear error.
 * `resolve()` is a thunk rather than eagerly resolved so `doctor` can report
 * missing env vars by name before it decides whether to call it.
 */
export function readConfigFile(path: string): ReadConfigFileResult {
  if (!existsSync(path)) return { ok: false, error: `config file not found: ${path}` };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!isBuildConfigShape(raw)) {
    return { ok: false, error: `${path} must be a { app: string, source: object } build config` };
  }

  return { ok: true, raw, envVarNames: collectEnvVarNames(raw), resolve: () => resolveConfigEnv(raw as BuildConfig) };
}
