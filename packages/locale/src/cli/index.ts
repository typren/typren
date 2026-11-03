#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseStrictArgs, suggest } from "./args";
import { EXIT_FAILURE, errorMessage, fail, printJson } from "./output";
import { runPull, printPullResult, PULL_HELP } from "./pull";
import { runBake, printBakeResult, BAKE_HELP } from "./bake";
import { runKeys, printKeysResult, KEYS_HELP } from "./keys";
import { diffLocaleDirs, printDiffResult, DIFF_HELP } from "./diff";
import { runDoctor, printDoctorResult, DOCTOR_HELP } from "./doctor";
import { runCompatDownload, printCompatResult, COMPAT_HELP } from "./compat";
import { scanCommand, SCAN_HELP } from "./scan";
import { checkCommand, CHECK_HELP } from "./check";
import { lintCommand, LINT_HELP } from "./lint";

const VERB_HELP: Record<string, string> = {
  pull: PULL_HELP,
  bake: BAKE_HELP,
  keys: KEYS_HELP,
  diff: DIFF_HELP,
  doctor: DOCTOR_HELP,
  compat: COMPAT_HELP,
  scan: SCAN_HELP,
  check: CHECK_HELP,
  lint: LINT_HELP,
};
const KNOWN_VERBS = new Set(Object.keys(VERB_HELP));

const GLOBAL_HELP = `typren-locale: build-time CLI for @typren/locale

Usage:
  typren-locale pull --config <path> [--out <dir>] [--filename-style dash|underscore]
  typren-locale bake --config <path> --out <dir> [--build-version <v>] [--expires-in-days <n>]
  typren-locale keys init|rotate --config <path> [--out <file>] [--json]
  typren-locale diff <dirA> <dirB>
  typren-locale doctor --config <path>
  typren-locale compat lokalise2 file download [options]
  typren-locale scan [--locales <dir|file> | --config <path>] [--default-locale <id>] [--preset <name>]... [--key-pattern <re>]... [--allow-unused] <src...>
  typren-locale check [--locales <dir|file> | --config <path>] [--default-locale <id>] [--format i18next]
  typren-locale lint --format <icu|vue-i18n|i18next|typren> [--to typren] [--locales ...]
  typren-locale --version
  typren-locale <verb> --help

  pull       Snapshot a source's locales to <locale>.json files (no gates).
  bake       Gated publish: hash-addressed catalogs, signed manifest, deltas.
  keys       Create or rotate the manifest signing key.
  diff       Content-compare two locale directories (migration verification).
  doctor     Validate a build config and dry-run its gates.
  compat     lokalise2-compatible "file download" shim.
  scan       Find catalogue keys the source never references.
  check      Missing, empty and extra values per locale vs the default.
  lint       Per-value syntax and placeholder checks for a message format.

  --version, -v   Print the installed @typren/locale version.
  --help, -h      Show this help, or a verb's help with "<verb> --help".
  --json          Machine-readable result on stdout (every verb).

Exit codes: 0 ok, 1 problems found, 2 usage error or failure.
`;

function readCliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** `argv` defaults to the real process argv so a direct run needs no change,
 *  matching packages/cli/src/cli.ts's and adapter-cloudfront's own `main()`. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(readCliVersion());
    return;
  }

  const verb = argv.find((a) => !a.startsWith("-"));
  const wantsHelp = argv.includes("--help") || argv.includes("-h");

  if (!verb || (wantsHelp && !KNOWN_VERBS.has(verb))) {
    console.log(verb && KNOWN_VERBS.has(verb) ? VERB_HELP[verb] : GLOBAL_HELP);
    return;
  }
  if (!KNOWN_VERBS.has(verb)) {
    const close = suggest(verb, [...KNOWN_VERBS]);
    const message = `unknown verb "${verb}" (expected one of: ${[...KNOWN_VERBS].join(", ")})${close ? ` did you mean "${close}"?` : ""}`;
    console.error(`typren-locale: ${message}`);
    if (argv.includes("--json")) printJson({ ok: false, error: message });
    process.exitCode = EXIT_FAILURE;
    return;
  }
  if (wantsHelp) {
    console.log(VERB_HELP[verb]);
    return;
  }

  const rest = argv.slice(argv.indexOf(verb) + 1);

  if (verb === "scan") return scanCommand(rest);
  if (verb === "check") return checkCommand(rest);
  if (verb === "lint") return lintCommand(rest);

  if (verb === "compat") {
    const json = rest.includes("--json");
    const { positionals, flags } = parseArgs(rest.filter((a) => a !== "--json"));
    if (positionals[0] !== "lokalise2" || positionals[1] !== "file" || positionals[2] !== "download") {
      return fail("compat", "usage: typren-locale compat lokalise2 file download [options]", json);
    }
    printCompatResult(await runCompatDownload({ flags }), { json });
    return;
  }

  const specs = {
    pull: { strings: ["config", "out", "filename-style"] },
    bake: { strings: ["config", "out", "build-version", "expires-in-days"] },
    keys: { strings: ["config", "out"] },
    diff: {},
    doctor: { strings: ["config"] },
  };
  const parsed = parseStrictArgs(rest, specs[verb as keyof typeof specs]);
  if (!parsed.ok) return fail(verb, parsed.error, parsed.json);
  const { args } = parsed;
  const { json } = args;
  const configPath = args.strings.config;

  if (verb === "pull") {
    if (!configPath) return fail("pull", "--config <path> is required", json);
    const filenameStyle = args.strings["filename-style"];
    if (filenameStyle !== undefined && filenameStyle !== "dash" && filenameStyle !== "underscore") {
      return fail("pull", `--filename-style must be "dash" or "underscore", got "${filenameStyle}"`, json);
    }
    printPullResult(await runPull({ configPath, outDir: args.strings.out, filenameStyle }), { json });
    return;
  }

  if (verb === "bake") {
    const outDir = args.strings.out;
    if (!configPath || !outDir) return fail("bake", "--config <path> and --out <dir> are required", json);
    const days = args.strings["expires-in-days"];
    const expiresInDays = days === undefined ? undefined : Number(days);
    if (expiresInDays !== undefined && !(expiresInDays > 0)) {
      return fail("bake", `--expires-in-days must be a positive number, got "${days}"`, json);
    }
    printBakeResult(await runBake({ configPath, outDir, buildVersion: args.strings["build-version"], expiresInDays }), { json });
    return;
  }

  if (verb === "keys") {
    const action = args.positionals[0];
    if ((action !== "init" && action !== "rotate") || args.positionals.length !== 1) {
      return fail("keys", "usage: typren-locale keys init|rotate --config <path>", json);
    }
    if (!configPath) return fail("keys", "--config <path> is required", json);
    printKeysResult(await runKeys({ action, configPath, out: args.strings.out }), json);
    return;
  }

  if (verb === "diff") {
    const [dirA, dirB] = args.positionals;
    if (args.positionals.length !== 2 || !dirA || !dirB) return fail("diff", "usage: typren-locale diff <dirA> <dirB>", json);
    try {
      printDiffResult(dirA, dirB, await diffLocaleDirs(dirA, dirB), { json });
    } catch (e) {
      fail("diff", errorMessage(e), json);
    }
    return;
  }

  // verb === "doctor"
  if (!configPath) return fail("doctor", "--config <path> is required", json);
  printDoctorResult(configPath, await runDoctor(configPath), { json });
}

// Only run when executed directly, not when imported by index.test.ts, same
// realpath-resolved guard packages/cli/src/cli.ts and adapter-cloudfront's
// cli.ts use (npx/npm invoke via a node_modules/.bin symlink Node's ESM
// loader resolves through).
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];

/** Node's global fetch ignores proxy variables unless the process starts with
 *  NODE_USE_ENV_PROXY=1 (22.21+/24.5+, ignored by older Node). Returns the env
 *  to re-exec under when a proxy is configured and the flag is not set yet. */
export function envProxyReexecEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined {
  if (env.NODE_USE_ENV_PROXY !== undefined || !PROXY_VARS.some((k) => env[k])) return undefined;
  return { ...env, NODE_USE_ENV_PROXY: "1" };
}

/** Re-runs this CLI under NODE_USE_ENV_PROXY=1 and returns its exit code, or
 *  undefined when no re-exec is needed. */
export function reexecWithEnvProxy(
  env: NodeJS.ProcessEnv = process.env,
  run: typeof spawnSync = spawnSync,
): number | undefined {
  const reexecEnv = envProxyReexecEnv(env);
  if (!reexecEnv) return undefined;
  // ponytail: re-exec costs one extra node startup, only when a proxy is set; no runtime API sets fetch's dispatcher.
  const r = run(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: reexecEnv });
  return r.status ?? 2;
}

/* v8 ignore start -- only runs as a real process; the built-bin test exercises it in a child. */
if (isDirectRun()) {
  const code = reexecWithEnvProxy();
  if (code !== undefined) process.exit(code);
  main().catch((e: unknown) => {
    console.error(`typren-locale: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  });
}
/* v8 ignore stop */
