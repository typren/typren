import { PLACEHOLDER } from "../locale";

export type FormatName = "icu" | "vue-i18n" | "i18next" | "typren";
export const FORMAT_NAMES: readonly FormatName[] = ["icu", "vue-i18n", "i18next", "typren"];

export type Feature =
  | "placeholder"
  | "list-placeholder"
  | "double-brace"
  | "typed-arg"
  | "formatter"
  | "plural"
  | "select"
  | "linked"
  | "nesting"
  | "html";

export interface ParsedValue {
  /** Sorted unique names compared for parity with the default locale. */
  placeholders: string[];
  /** Sorted unique. */
  features: Feature[];
  /** Syntax errors in this value on its own; [] when valid. */
  errors: string[];
  /** ICU only ([] otherwise): every plural/select/selectordinal arg with its option keys, sorted. */
  selects: { arg: string; type: "plural" | "select" | "selectordinal"; options: string[] }[];
  /** vue-i18n only: number of "|"-separated branches (1 when none, and for other formats). */
  pipeBranches: number;
  /** vue-i18n only ([] otherwise): unescaped special chars present, from "@", "$", "|", sorted unique. */
  specialChars: string[];
}

/** Features typren's runtime (locale.ts interpolate) renders correctly. */
export const TYPREN_FEATURES: ReadonlySet<Feature> = new Set<Feature>(["placeholder", "list-placeholder", "html"]);
export const PLURAL_CATEGORIES: readonly string[] = ["zero", "one", "two", "few", "many", "other"];

const HTML = /<\/?[A-Za-z][\w-]*(\s[^<>]*)?\/?>/;
const NAME = /[A-Za-z0-9_]+/y;
const TYPED = new Set(["number", "date", "time", "spellout", "ordinal", "duration"]);
const UNBALANCED = "unbalanced braces";

interface Acc {
  placeholders: Set<string>;
  features: Set<Feature>;
  errors: Set<string>;
  selects: ParsedValue["selects"];
  pipeBranches: number;
  specialChars: Set<string>;
}

function parseIcu(value: string, acc: Acc): void {
  let i = 0;
  const skipWs = () => {
    while (i < value.length && /\s/.test(value[i]!)) i++;
  };
  const bad = (msg: string): never => {
    throw new Error(msg);
  };

  function message(inPlural: boolean, nested: boolean): void {
    while (i < value.length) {
      const c = value[i]!;
      if (c === "'") {
        const n = value[i + 1];
        if (n === "'") i += 2;
        else if (n === "{" || n === "}" || (inPlural && n === "#")) {
          let j = i + 1;
          while (j < value.length && !(value[j] === "'" && value[j + 1] !== "'")) j += value[j] === "'" ? 2 : 1;
          i = j + 1;
        } else i++;
      } else if (c === "{") {
        argument(inPlural);
      } else if (c === "}") {
        if (nested) return;
        acc.errors.add(UNBALANCED);
        i++;
      } else i++;
    }
    if (nested) bad(UNBALANCED);
  }

  function argument(inPlural: boolean): void {
    i++;
    skipWs();
    NAME.lastIndex = i;
    const nameMatch = NAME.exec(value);
    if (!nameMatch) return bad(i >= value.length ? UNBALANCED : "empty or invalid argument name");
    const name = nameMatch[0];
    i += name.length;
    acc.placeholders.add(name);
    skipWs();
    if (i >= value.length) return bad(UNBALANCED);
    if (value[i] === "}") {
      acc.features.add("placeholder");
      i++;
      return;
    }
    if (value[i] !== ",") return bad(`unexpected "${value[i]}" in {${name}}`);
    i++;
    skipWs();
    const typeStart = i;
    while (i < value.length && /[a-z]/.test(value[i]!)) i++;
    const type = value.slice(typeStart, i);
    skipWs();
    if (TYPED.has(type)) {
      acc.features.add("typed-arg");
      if (value[i] === ",") {
        let depth = 0;
        for (i++; i < value.length && !(value[i] === "}" && depth === 0); i++) {
          if (value[i] === "{") depth++;
          else if (value[i] === "}") depth--;
        }
      }
      if (value[i] !== "}") return bad(UNBALANCED);
      i++;
      return;
    }
    if (type !== "plural" && type !== "selectordinal" && type !== "select") {
      return bad(`unknown argument type "${type}" in {${name}, ${type}}`);
    }
    if (value[i] !== ",") return bad(`{${name}, ${type}} has no options`);
    i++;
    skipWs();
    if (type !== "select") {
      acc.features.add("plural");
      const offset = /^offset:\s*\d+/.exec(value.slice(i));
      if (offset) {
        i += offset[0].length;
        skipWs();
      }
    } else acc.features.add("select");
    const entry: ParsedValue["selects"][number] = { arg: name, type, options: [] };
    acc.selects.push(entry);
    const label = `{${name}, ${type}}`;
    while (value[i] !== "}") {
      if (i >= value.length) return bad(UNBALANCED);
      const start = i;
      while (i < value.length && /[^\s{}]/.test(value[i]!)) i++;
      const selector = value.slice(start, i);
      if (!selector) return bad(`${label} expects an option key`);
      skipWs();
      if (value[i] !== "{") return bad(`${label} option "${selector}" needs a {message}`);
      i++;
      if (type !== "select" && !/^=\d+$/.test(selector) && !PLURAL_CATEGORIES.includes(selector)) {
        acc.errors.add(`unknown plural category "${selector}" in ${label}`);
      }
      entry.options.push(selector);
      message(type !== "select" || inPlural, true);
      i++;
      skipWs();
    }
    i++;
    if (entry.options.length === 0) acc.errors.add(`${label} has no options`);
    else if (!entry.options.includes("other")) acc.errors.add(`${label} has no "other" option`);
    entry.options.sort();
  }

  try {
    message(false, false);
  } catch (e) {
    acc.errors.add(e instanceof Error ? e.message : String(e));
  }
}

const LINKED = /^@(?:\.\w+)?:(?:\([\w.-]+\)|[\w.-]+)/;

function parseVue(value: string, acc: Acc): void {
  let i = 0;
  while (i < value.length) {
    const c = value[i]!;
    if (c === "{") {
      const close = value.indexOf("}", i);
      if (close === -1) {
        acc.errors.add(UNBALANCED);
        return;
      }
      const inner = value.slice(i + 1, close).trim();
      if (/^'[^']*'$/.test(inner)) {
        // literal interpolation: neither a placeholder nor scanned for special characters
      } else if (/^\d+$/.test(inner)) {
        acc.placeholders.add(inner);
        acc.features.add("list-placeholder");
      } else if (/^[\w.]+$/.test(inner)) {
        acc.placeholders.add(inner);
        acc.features.add("placeholder");
      } else {
        acc.errors.add(inner ? `invalid placeholder "{${inner}}"` : "empty placeholder {}");
      }
      i = close + 1;
    } else if (c === "}") {
      acc.errors.add(UNBALANCED);
      i++;
    } else if (c === "@") {
      const link = LINKED.exec(value.slice(i));
      if (link) {
        acc.features.add("linked");
        i += link[0].length;
      } else {
        acc.specialChars.add("@");
        acc.errors.add(`"@" must start a linked message (@:key); write {'@'} for a literal @`);
        i++;
      }
    } else {
      if (c === "$") acc.specialChars.add("$");
      else if (c === "|") {
        acc.specialChars.add("|");
        acc.pipeBranches++;
      }
      i++;
    }
  }
  if (acc.pipeBranches >= 2) acc.features.add("plural");
}

function parseI18next(value: string, acc: Acc): void {
  let i = 0;
  while (i < value.length) {
    if (value.startsWith("{{", i)) {
      const close = value.indexOf("}}", i + 2);
      if (close === -1) {
        acc.errors.add('unclosed "{{"');
        return;
      }
      const inner = value.slice(i + 2, close).replace(/^\s*-/, "");
      const comma = inner.indexOf(",");
      const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      if (/^[\w.$-]+$/.test(name)) {
        acc.placeholders.add(name);
        acc.features.add("double-brace");
        if (comma !== -1) acc.features.add("formatter");
      } else {
        acc.errors.add(`invalid placeholder "{{${inner.trim()}}}"`);
      }
      i = close + 2;
    } else if (value.startsWith("}}", i)) {
      acc.errors.add('stray "}}"');
      i += 2;
    } else if (value.startsWith("$t(", i)) {
      let depth = 0;
      let j = i + 2;
      for (; j < value.length; j++) {
        if (value[j] === "(") depth++;
        else if (value[j] === ")" && --depth === 0) break;
      }
      if (j >= value.length) {
        acc.errors.add('unclosed "$t("');
        return;
      }
      acc.features.add("nesting");
      i = j + 1;
    } else i++;
  }
}

function parseTypren(value: string, acc: Acc): void {
  for (const m of value.matchAll(PLACEHOLDER)) {
    acc.placeholders.add(m[1]!);
    acc.features.add("placeholder");
  }
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}") {
      if (depth === 0) {
        acc.errors.add(UNBALANCED);
      } else if (--depth === 0) {
        const group = value.slice(start, i + 1);
        if (!/^\{\w+\}$/.test(group) || value[i + 1] === "}") {
          acc.errors.add(`"${group}" renders literally: typren only supports flat {var} placeholders`);
        }
      }
    }
  }
  if (depth > 0) acc.errors.add(UNBALANCED);
}

export function parseValue(format: FormatName, value: string): ParsedValue {
  const acc: Acc = {
    placeholders: new Set(),
    features: new Set(),
    errors: new Set(),
    selects: [],
    pipeBranches: 1,
    specialChars: new Set(),
  };
  if (format === "icu") parseIcu(value, acc);
  else if (format === "vue-i18n") parseVue(value, acc);
  else if (format === "i18next") parseI18next(value, acc);
  else parseTypren(value, acc);
  if (HTML.test(value)) acc.features.add("html");
  return {
    placeholders: [...acc.placeholders].sort(),
    features: [...acc.features].sort(),
    errors: [...acc.errors],
    selects: acc.selects,
    pipeBranches: format === "vue-i18n" ? acc.pipeBranches : 1,
    specialChars: [...acc.specialChars].sort(),
  };
}

const FAMILY = new RegExp(`^(.+?)_((?:ordinal_)?(?:${PLURAL_CATEGORIES.join("|")}))$`);

/** i18next plural key: "item_one" -> { base: "item", category: "one" }, "place_ordinal_two" -> { base: "place", category: "ordinal_two" }. */
export function pluralFamily(key: string): { base: string; category: string } | undefined {
  const m = FAMILY.exec(key);
  return m ? { base: m[1]!, category: m[2]! } : undefined;
}

/** "item_one" -> "item", "place_ordinal_two" -> "place_ordinal". */
export function pluralFamilyPrefix(key: string): string | undefined {
  const f = pluralFamily(key);
  if (!f) return undefined;
  return f.category.startsWith("ordinal_") ? `${f.base}_ordinal` : f.base;
}

/** Prefixes that are real plural families: the default locale has `<prefix>_other`. Keys like step_one/step_two alone are not. */
export function pluralFamilyPrefixes(defaultKeys: readonly string[]): Set<string> {
  const keys = new Set(defaultKeys);
  const out = new Set<string>();
  for (const k of defaultKeys) {
    const p = pluralFamilyPrefix(k);
    if (p && keys.has(`${p}_other`)) out.add(p);
  }
  return out;
}
