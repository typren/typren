import { createFsSourceProvider } from "./fs-provider";
import type { LocaleSourceProvider, SourceConfig } from "./provider";

function isProvider(value: unknown): value is LocaleSourceProvider {
  return typeof value === "object" && value !== null && typeof (value as LocaleSourceProvider).loadSource === "function";
}

/**
 * Resolves a `LocaleSourceProvider` from a bare dir string, a `SourceConfig`,
 * or an already-built provider (passed straight through — the escape hatch
 * for tests and for callers wiring their own provider). The switch is the
 * whole registry: a follow-up config shape (added to `SourceConfig` in
 * provider.ts) gets one more case here.
 */
export function resolveProvider(source: string | SourceConfig | LocaleSourceProvider): LocaleSourceProvider {
  if (isProvider(source)) return source;

  const config: SourceConfig = typeof source === "string" ? { type: "files", dir: source } : source;
  switch (config.type) {
    case "files":
      return createFsSourceProvider(config.dir, config.langMap);
    default: {
      const unknownType: string = (config as { type: string }).type;
      throw new Error(`resolveProvider: unknown source type "${unknownType}"`);
    }
  }
}
