// Secrets never live in sink config literals; config carries a "${VAR}"
// reference and the value is read from the environment at deliver time.
// Deliver-time (not sink-construction-time) resolution matters twice over:
// edge runtimes may only expose bindings per request, and a missing variable
// becomes one sink's failure detail instead of a boot crash that takes the
// other sinks down with it.
const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export type EnvRecord = Record<string, string | undefined>;

export function defaultEnv(): EnvRecord {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/** Resolves a "${VAR}" reference against `env`; any other string passes through unchanged. */
export function resolveEnvRef(value: string, env: EnvRecord): string {
  const match = ENV_REF.exec(value);
  if (!match) return value;
  const resolved = env[match[1]];
  if (resolved === undefined) throw new Error(`environment variable ${match[1]} is not set`);
  return resolved;
}

/**
 * Like resolveEnvRef, but for fields that only ever hold credentials: a
 * literal is refused so a token pasted into config (and then into version
 * control) fails fast instead of silently working.
 */
export function requireEnvRef(value: string, env: EnvRecord, what: string): string {
  if (!ENV_REF.test(value)) {
    throw new Error(`${what} must be a \${VAR} environment reference, not a literal`);
  }
  return resolveEnvRef(value, env);
}
