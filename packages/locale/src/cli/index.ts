#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stringFlag } from "./args";
import { runPull, printPullResult, PULL_HELP } from "./pull";
import { runBake, printBakeResult, BAKE_HELP } from "./bake";
import { diffLocaleDirs, printDiffResult, DIFF_HELP } from "./diff";
import { runDoctor, printDoctorResult, DOCTOR_HELP } from "./doctor";
import { runCompatDownload, printCompatResult, COMPAT_HELP } from "./compat";

const VERB_HELP: Record<string, string> = {
  pull: PULL_HELP,
  bake: BAKE_HELP,
  diff: DIFF_HELP,
  doctor: DOCTOR_HELP,
  compat: COMPAT_HELP,
};
const KNOWN_VERBS = new Set(Object.keys(VERB_HELP));

const GLOBAL_HELP = `typren-locale: build-time CLI for @typren/locale

Usage:
  typren-locale pull --config <path> [--out <dir>] [--filename-style dash|underscore]
  typren-locale bake --config <path> --out <dir>
  typren-locale diff <dirA> <dirB>
  typren-locale doctor --config <path>
  typren-locale compat lokalise2 file download [options]
  typren-locale --version
  typren-locale <verb> --help

  pull       Snapshot a source's locales to <locale>.json files (no gates).
  bake       Gated publish: hash-addressed catalogs, manifest, deltas.
  diff       Content-compare two locale directories (migration verification).
  doctor     Validate a build config and dry-run its gates.
  compat     lokalise2-compatible "file download" shim.

  --version, -v   Print the installed @typren/locale version.
  --help, -h      Show this help, or a verb's help with "<verb> --help".
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

function badArgs(verb: string, message: string): void {
  console.error(`typren-locale ${verb}: ${message}`);
  process.exitCode = 1;
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
    console.error(`typren-locale: unknown verb "${verb}" (expected one of: ${[...KNOWN_VERBS].join(", ")})`);
    process.exitCode = 1;
    return;
  }
  if (wantsHelp) {
    console.log(VERB_HELP[verb]);
    return;
  }

  const rest = argv.slice(argv.indexOf(verb) + 1);

  if (verb === "pull") {
    const { flags } = parseArgs(rest);
    const configPath = stringFlag(flags, "config");
    if (!configPath) return badArgs("pull", "--config <path> is required");
    const filenameStyleRaw = stringFlag(flags, "filename-style");
    if (filenameStyleRaw !== undefined && filenameStyleRaw !== "dash" && filenameStyleRaw !== "underscore") {
      return badArgs("pull", `--filename-style must be "dash" or "underscore", got "${filenameStyleRaw}"`);
    }
    const result = await runPull({ configPath, outDir: stringFlag(flags, "out"), filenameStyle: filenameStyleRaw });
    printPullResult(result);
    return;
  }

  if (verb === "bake") {
    const { flags } = parseArgs(rest);
    const configPath = stringFlag(flags, "config");
    const outDir = stringFlag(flags, "out");
    if (!configPath || !outDir) return badArgs("bake", "--config <path> and --out <dir> are required");
    const result = await runBake({ configPath, outDir, buildVersion: stringFlag(flags, "build-version") });
    printBakeResult(result);
    return;
  }

  if (verb === "diff") {
    const { positionals } = parseArgs(rest);
    const [dirA, dirB] = positionals;
    if (!dirA || !dirB) return badArgs("diff", "usage: typren-locale diff <dirA> <dirB>");
    const result = await diffLocaleDirs(dirA, dirB);
    printDiffResult(dirA, dirB, result);
    return;
  }

  if (verb === "doctor") {
    const { flags } = parseArgs(rest);
    const configPath = stringFlag(flags, "config");
    if (!configPath) return badArgs("doctor", "--config <path> is required");
    const result = await runDoctor(configPath);
    printDoctorResult(configPath, result);
    return;
  }

  // verb === "compat"
  const { positionals, flags } = parseArgs(rest);
  if (positionals[0] !== "lokalise2" || positionals[1] !== "file" || positionals[2] !== "download") {
    return badArgs("compat", "usage: typren-locale compat lokalise2 file download [options]");
  }
  const result = await runCompatDownload({ flags });
  printCompatResult(result);
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

if (isDirectRun()) {
  main().catch((e: unknown) => {
    console.error(`typren-locale: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  });
}
