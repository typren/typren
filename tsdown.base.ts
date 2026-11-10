import { defineConfig, type UserConfig } from "tsdown";

/** One build for every published package: one output file per source file
 *  (the exports maps, the bins and etc/api-surface address dist paths), `.js`
 *  on relative specifiers, a declaration beside each file. `copy` entries land
 *  in dist as they are. */
export function typrenPackage(extra: { exclude?: string[]; copy?: string[] } = {}): UserConfig {
  return defineConfig({
    entry: ["src/**/*.ts", "src/**/*.tsx", "!src/**/*.test.ts", "!src/**/*.test.tsx", "!src/**/*.d.ts", ...(extra.exclude ?? []).map((e) => `!${e}`)],
    outDir: "dist",
    unbundle: true,
    platform: "node",
    fixedExtension: false,
    hash: false,
    // TypeScript 7 ships no JavaScript API, so core and studio (still
    // inferring their declarations) emit through the native compiler; a
    // package with isolatedDeclarations in its tsconfig uses Oxc instead.
    dts: { tsgo: {} },
    minify: false,
    // ES2022 keeps `#private` fields as written; a lower target makes Oxc
    // lower them into a shared helper chunk, a dist path nothing publishes.
    // Every supported Node (see engines) and every bundler reads it.
    target: "es2022",
    clean: true,
    copy: extra.copy?.map((from) => ({ from, to: "dist" })),
    // Unbundle mode keeps module-level directives ("use client"); the warning
    // that it might not is noise here.
    inputOptions: { onLog: (level, log, defaultHandler) => { if (log.code !== "MODULE_LEVEL_DIRECTIVE") defaultHandler(level, log); } },
  }) as UserConfig;
}
