import { FORMAT_NAMES, type Feature, type FormatName, parseValue, pluralFamilyPrefix, pluralFamilyPrefixes, TYPREN_FEATURES } from "./formats";
import { type FlagSpec, parseStrictArgs } from "./args";
import { loadCatalogs, type LoadedCatalogs } from "./catalogs";
import { EXIT_OK, EXIT_PROBLEMS, errorMessage, fail, printJson } from "./output";

export const LINT_FLAGS: FlagSpec = { strings: ["locales", "config", "default-locale", "format", "to"] };

export const LINT_HELP = `typren-locale lint --format <icu|vue-i18n|i18next|typren> (--locales <dir|file> | --config <path>) [options]

Checks every value of every locale for syntax errors and for parity with the default locale.
Only keys that also exist in the default locale are checked (missing/extra keys are "check"'s job).

Profiles (--format):
  icu        ICU MessageFormat syntax; placeholder parity; select options must match the default;
             plural/selectordinal need "other" (their category sets may differ per language)
  vue-i18n   {name} / {0} placeholders, @:linked messages, "|" branch count must match,
             warns when a translation adds an unescaped @ $ |
  i18next    {{name}} placeholders, $t() nesting, plural families (key_one/key_other):
             every family needs key_other; {{count}} may be omitted in family members
  typren     flat {var} placeholders only; anything else is a syntax error

Options:
  --locales <dir|file>      <locale>.json catalogs
  --config <path>           build config whose source is used when --locales is absent
  --default-locale <id>     default locale (else the config's, else the only catalog)
  --to typren               also flag every feature typren's runtime renders incorrectly
  --json                    machine-readable result on stdout

Severity: error (fails the run), warning, info (never fail).
Exit codes: 0 no errors; 1 errors found; 2 usage error or failure.`;

export type LintSeverity = "error" | "warning" | "info";
export type LintCode =
  | "syntax"
  | "placeholder-mismatch"
  | "select-options"
  | "plural-branches"
  | "plural-family"
  | "special-char"
  | "unsupported"
  | "html";

export interface LintIssue {
  locale: string;
  key: string;
  severity: LintSeverity;
  code: LintCode;
  message: string;
}

export interface LintResult {
  ok: boolean;
  defaultLocale: string;
  format: FormatName;
  to?: "typren";
  issues: LintIssue[];
  counts: { error: number; warning: number; info: number };
}

const UNSUPPORTED: Partial<Record<Feature, string>> = {
  plural: "plural forms are not supported by typren's runtime (flat {var} only)",
  select: "ICU select is not supported by typren's runtime",
  "typed-arg": "typed ICU arguments ({n, number}) render literally in typren",
  linked: "linked messages (@:key) are not supported by typren's runtime",
  nesting: "$t() nesting is not supported by typren's runtime",
  formatter: "{{value, format}} formatters are not supported by typren's runtime",
  "double-brace": "{{name}} renders literally in typren; rewrite as {name}",
};

const side = (names: string[]) => names.map((n) => `{${n}}`).join(", ");

export function lintCatalogs(loaded: LoadedCatalogs, format: FormatName, opts: { to?: "typren" } = {}): LintResult {
  const def = loaded.catalogs[loaded.defaultLocale]!;
  const i18next = format === "i18next";
  const families = new Map<string, string[]>();
  if (i18next) {
    const prefixes = pluralFamilyPrefixes(Object.keys(def));
    for (const key of Object.keys(def)) {
      const prefix = pluralFamilyPrefix(key);
      if (prefix && prefixes.has(prefix)) families.set(prefix, [...(families.get(prefix) ?? []), key]);
    }
  }
  const familyOf = (key: string) => {
    const prefix = i18next ? pluralFamilyPrefix(key) : undefined;
    return prefix !== undefined && families.has(prefix) ? prefix : undefined;
  };

  const issues: LintIssue[] = [];
  for (const locale of loaded.locales) {
    const isDefault = locale === loaded.defaultLocale;
    const catalog = loaded.catalogs[locale]!;
    const found: LintIssue[] = [];
    const add = (key: string, severity: LintSeverity, code: LintCode, message: string) =>
      found.push({ locale, key, severity, code, message });
    const present = new Set<string>();

    for (const [key, value] of Object.entries(catalog)) {
      const prefix = familyOf(key);
      if (!(key in def) && !prefix) continue;
      if (prefix) present.add(prefix);
      if (value === "") continue;

      const p = parseValue(format, value);
      for (const e of p.errors) add(key, "error", "syntax", e);
      if (p.features.includes("html")) add(key, "info", "html", "contains HTML");

      if (!isDefault) {
        const counterpartKey =
          key in def ? key : (def[`${prefix}_other`] !== undefined ? `${prefix}_other` : families.get(prefix!)![0]!);
        const d = parseValue(format, def[counterpartKey]!);
        const ignoreCount = i18next && prefix !== undefined;
        const keep = (n: string) => !(ignoreCount && n === "count");
        const implicitPlural = format === "vue-i18n" && (p.pipeBranches >= 2 || d.pipeBranches >= 2);
        const skip = (n: string) => !keep(n) || (implicitPlural && (n === "n" || n === "count"));
        const mine = p.placeholders.filter((n) => !skip(n));
        const theirs = d.placeholders.filter((n) => !skip(n));
        const missing = theirs.filter((n) => !mine.includes(n));
        const extra = mine.filter((n) => !theirs.includes(n));
        if (missing.length || extra.length) {
          const parts = [missing.length && `missing ${side(missing)}`, extra.length && `extra ${side(extra)}`];
          add(key, "error", "placeholder-mismatch", `placeholders differ from ${loaded.defaultLocale}: ${parts.filter(Boolean).join("; ")}`);
        }
        for (const s of d.selects.filter((x) => x.type === "select")) {
          const t = p.selects.find((x) => x.arg === s.arg);
          if (!t || t.options.join("|") !== s.options.join("|")) {
            add(key, "error", "select-options", `{${s.arg}, select} options differ from ${loaded.defaultLocale}: expected ${s.options.join(", ")}; got ${t ? t.options.join(", ") : "none"}`);
          }
        }
        if (p.pipeBranches !== d.pipeBranches) {
          const pluralVsNot = p.pipeBranches === 1 || d.pipeBranches === 1;
          add(key, pluralVsNot ? "error" : "warning", "plural-branches", `${p.pipeBranches} "|" branch(es), ${loaded.defaultLocale} has ${d.pipeBranches}`);
        }
        for (const c of p.specialChars.filter((c) => !d.specialChars.includes(c))) {
          add(key, "warning", "special-char", `adds "${c}", which vue-i18n treats as syntax; escape it as {'${c}'}`);
        }
      }

      if (opts.to === "typren") {
        const features = new Set(p.features);
        if (prefix) features.add("plural");
        for (const f of features) {
          if (!TYPREN_FEATURES.has(f)) add(key, "error", "unsupported", UNSUPPORTED[f]!);
        }
      }
    }

    for (const prefix of present) {
      if (catalog[`${prefix}_other`] === undefined) {
        add(`${prefix}_other`, "error", "plural-family", `plural family "${prefix}" has no "${prefix}_other" form`);
      }
    }

    found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    issues.push(...found);
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { ok: counts.error === 0, defaultLocale: loaded.defaultLocale, format, ...(opts.to && { to: opts.to }), issues, counts };
}

export async function runLint(opts: {
  locales?: string;
  config?: string;
  defaultLocale?: string;
  format: FormatName;
  to?: "typren";
}): Promise<LintResult> {
  if (!FORMAT_NAMES.includes(opts.format)) {
    throw new Error(`unknown --format "${opts.format}" (expected ${FORMAT_NAMES.join("|")})`);
  }
  if (opts.to !== undefined && opts.to !== "typren") throw new Error('--to only supports "typren"');
  const loaded = await loadCatalogs({ locales: opts.locales, config: opts.config, defaultLocale: opts.defaultLocale });
  return lintCatalogs(loaded, opts.format, { to: opts.to });
}

export function printLintResult(result: LintResult, opts: { json: boolean }): void {
  if (opts.json) printJson(result);
  else {
    for (const i of result.issues) {
      console.log(`  [${i.severity.padEnd(7)}] ${i.locale}  ${i.key}  ${i.code}: ${i.message}`);
    }
    const { error, warning, info } = result.counts;
    console.log(`typren-locale lint: ${error} error(s), ${warning} warning(s), ${info} info.`);
  }
  process.exitCode = result.ok ? EXIT_OK : EXIT_PROBLEMS;
}

export async function lintCommand(argv: string[]): Promise<void> {
  const parsed = parseStrictArgs(argv, LINT_FLAGS);
  if (!parsed.ok) return fail("lint", parsed.error, parsed.json);
  const { args } = parsed;
  if (args.booleans.has("help")) {
    console.log(LINT_HELP);
    return;
  }
  const json = args.json;
  if (args.positionals.length > 0) return fail("lint", `unexpected argument "${args.positionals[0]}"`, json);
  const format = args.strings.format;
  if (!format) return fail("lint", "--format <icu|vue-i18n|i18next|typren> is required", json);
  try {
    const result = await runLint({
      locales: args.strings.locales,
      config: args.strings.config,
      defaultLocale: args.strings["default-locale"],
      format: format as FormatName,
      to: args.strings.to as "typren" | undefined,
    });
    printLintResult(result, { json });
  } catch (e) {
    fail("lint", errorMessage(e), json);
  }
}
