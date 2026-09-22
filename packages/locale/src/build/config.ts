import type { SourceConfig } from "./provider";

/** The committed `locale-adapter.config.json` shape — no secret values, ${VAR} placeholders resolved at run time. */
export interface BuildConfig {
  app: string;
  source: SourceConfig;
}

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Recursively interpolates `${VAR}` placeholders in every string leaf of
 * `config` against `env` (defaults to `process.env`). Throws a clear error
 * naming the missing var + the dot-path it was referenced at — never
 * silently sends an empty token to a source. Non-string values pass through
 * unchanged.
 */
export function resolveConfigEnv<T>(config: T, env: Record<string, string | undefined> = process.env): T {
  function resolveValue(value: unknown, path: string): unknown {
    if (typeof value === "string") {
      return value.replace(ENV_VAR_PATTERN, (_match, name: string) => {
        const envValue = env[name];
        if (envValue === undefined) {
          throw new Error(`resolveConfigEnv: missing required env var "${name}" (referenced at ${path || "<root>"})`);
        }
        return envValue;
      });
    }
    if (Array.isArray(value)) return value.map((item, i) => resolveValue(item, `${path}[${i}]`));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, path ? `${path}.${key}` : key);
      return out;
    }
    return value;
  }
  return resolveValue(config, "") as T;
}

/** Every distinct `${VAR}` name referenced anywhere in `config` — reports every missing var at once instead of failing fast on the first. */
export function collectEnvVarNames(config: unknown): string[] {
  const names = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(ENV_VAR_PATTERN)) names.add(match[1]!);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(config);
  return [...names];
}
