import { EXIT_OK, EXIT_PROBLEMS, errorMessage, fail, printJson } from "./output";
import { type FlagSpec, parseStrictArgs } from "./args";
import { type LoadedCatalogs, loadCatalogs } from "./catalogs";
import { FORMAT_NAMES, type FormatName, pluralFamilyPrefix, pluralFamilyPrefixes } from "./formats";

export const CHECK_FLAGS: FlagSpec = { strings: ["locales", "config", "default-locale", "format"] };

export const CHECK_HELP = `typren-locale check: compare every locale against the default locale.

Usage: typren-locale check (--locales <dir|file> | --config <path>) [options]

Reports, per locale: keys missing from it, keys whose value is blank, and keys
it has that the default locale does not. The default locale only reports blanks.

Options:
  --locales <dir|file>     A dir of <locale>.json files, or one <locale>.json file.
  --config <path>          Build config; its source is used when --locales is absent.
  --default-locale <id>    Default locale. Resolution: --default-locale, then the
                           config's defaultLocale, then the single locale found,
                           else an error.
  --format <name>          icu | vue-i18n | i18next | typren. Only i18next changes
                           behaviour: plural keys (item_one, item_other, ...) are
                           compared as families, so a locale may carry a different
                           set of categories than the default. A family is missing
                           only when the locale has no member of it at all.
  --json                   Print the result as JSON.
  --help                   Show this help.

Exit codes: 0 complete, 1 problems found, 2 usage error or could not run.
`;

export interface LocaleCheck {
  locale: string;
  missing: string[];
  empty: string[];
  extra: string[];
}

export interface CheckResult {
  ok: boolean;
  defaultLocale: string;
  locales: LocaleCheck[];
}

const blankKeys = (cat: Record<string, string>) =>
  Object.keys(cat)
    .filter((k) => cat[k]!.trim() === "")
    .sort();

export function checkCatalogs(loaded: LoadedCatalogs, opts: { pluralFamilies?: boolean } = {}): CheckResult {
  const { defaultLocale, catalogs } = loaded;
  const base = catalogs[defaultLocale]!;
  const baseKeys = Object.keys(base);
  const baseFamilies = opts.pluralFamilies ? pluralFamilyPrefixes(baseKeys) : new Set<string>();
  const familyOf = (k: string) => {
    const p = pluralFamilyPrefix(k);
    return p !== undefined && baseFamilies.has(p) ? p : undefined;
  };

  const locales: LocaleCheck[] = loaded.locales.map((locale) => {
    const cat = catalogs[locale]!;
    if (locale === defaultLocale) return { locale, missing: [], empty: blankKeys(cat), extra: [] };

    const have = new Set<string>();
    for (const k of Object.keys(cat)) {
      const f = familyOf(k);
      if (f) have.add(f);
    }
    const missing = baseKeys
      .filter((k) => {
        if (Object.hasOwn(cat, k)) return false;
        const f = familyOf(k);
        return !(f && have.has(f));
      })
      .sort();
    const extra = Object.keys(cat)
      .filter((k) => {
        if (Object.hasOwn(base, k)) return false;
        return !familyOf(k);
      })
      .sort();
    return { locale, missing, empty: blankKeys(cat), extra };
  });

  const ok = locales.every((l) => !l.missing.length && !l.empty.length && !l.extra.length);
  return { ok, defaultLocale, locales };
}

export async function runCheck(opts: {
  locales?: string;
  config?: string;
  defaultLocale?: string;
  format?: FormatName;
}): Promise<CheckResult> {
  if (opts.format !== undefined && !FORMAT_NAMES.includes(opts.format)) {
    throw new Error(`unknown --format "${opts.format}" (expected one of: ${FORMAT_NAMES.join(", ")})`);
  }
  const loaded = await loadCatalogs({ locales: opts.locales, config: opts.config, defaultLocale: opts.defaultLocale });
  return checkCatalogs(loaded, { pluralFamilies: opts.format === "i18next" });
}

export function printCheckResult(result: CheckResult, opts: { json: boolean }): void {
  process.exitCode = result.ok ? EXIT_OK : EXIT_PROBLEMS;
  if (opts.json) return printJson(result);

  console.log(`typren-locale check: default ${result.defaultLocale}, ${result.locales.length} locale(s)`);
  for (const l of result.locales) {
    if (!l.missing.length && !l.empty.length && !l.extra.length) {
      console.log(`  ${l.locale}: ok`);
      continue;
    }
    console.log(`  ${l.locale}: ${l.missing.length} missing, ${l.empty.length} empty, ${l.extra.length} extra`);
    for (const k of l.missing) console.log(`    missing  ${k}`);
    for (const k of l.empty) console.log(`    empty    ${k}`);
    for (const k of l.extra) console.log(`    extra    ${k}`);
  }
  console.log(result.ok ? "typren-locale check: all locales complete." : "typren-locale check: problems found.");
}

export async function checkCommand(argv: string[]): Promise<void> {
  const parsed = parseStrictArgs(argv, CHECK_FLAGS);
  if (!parsed.ok) return fail("check", parsed.error, parsed.json);
  const { args } = parsed;
  if (args.booleans.has("help")) {
    console.log(CHECK_HELP);
    return;
  }
  if (args.positionals.length) {
    return fail("check", `unexpected argument "${args.positionals[0]}" (pass the locale dir with --locales)`, args.json);
  }
  try {
    const result = await runCheck({
      locales: args.strings.locales,
      config: args.strings.config,
      defaultLocale: args.strings["default-locale"],
      format: args.strings.format as FormatName | undefined,
    });
    printCheckResult(result, { json: args.json });
  } catch (e) {
    fail("check", errorMessage(e), args.json);
  }
}
