export type UsagePresetName = "vue-i18n" | "i18next" | "react-intl" | "typren";
export const USAGE_PRESET_NAMES: readonly UsagePresetName[] = ["vue-i18n", "i18next", "react-intl", "typren"];

export interface KeyRef {
  /** Static key, or the static prefix when dynamic. */
  key: string;
  /** True: `key` is a prefix ('a.b.' + x, `a.b.${x}`). */
  dynamic: boolean;
  /** 1-based. */
  line: number;
}

// Each regex's match ends exactly where the key argument expression begins.
// ponytail: this is a regex scan, not a parser. Commented-out calls count as used, which is the safe direction.
const SITES: Record<UsagePresetName, RegExp[]> = {
  "vue-i18n": [
    /(?<![\w$])\$?(?:t|tc|te|tm)\s*\(\s*/g,
    /\bv-t\s*=\s*["']\s*(?:\{\s*path\s*:\s*)?/g,
    /(?<![\w$:-])keypath\s*=\s*|:keypath\s*=\s*["']\s*/g,
  ],
  i18next: [/(?<![\w$])t\s*\(\s*/g, /(?<![\w$-])i18nKey\s*=\s*\{?\s*/g],
  "react-intl": [
    /(?<![\w$-])id\s*=\s*\{?\s*/g,
    // ponytail: any `id: '<literal>'` counts as a reference. Over-matching can only hide an unused key that shares a name with some id literal; it never invents one.
    /(?<![\w$])id\s*:\s*/g,
  ],
  typren: [/(?<![\w$])(?:t|resolve)\s*\(\s*[\w$.]+\s*,\s*/g],
};

const I18NEXT_KEY_PREFIX = /\bkeyPrefix\s*:\s*(['"])([\w.-]+)\1/;
const I18NEXT_NS = /\b(?:useTranslation|withTranslation)\s*\(\s*(?:\[\s*)?(['"])([\w.-]+)\1/;

function readKeyArg(source: string, index: number): { key: string; dynamic: boolean } | undefined {
  const quote = source[index];
  if (quote === "'" || quote === '"') {
    let j = index + 1;
    while (j < source.length && source[j] !== quote) {
      if (source[j] === "\n") return undefined;
      j += source[j] === "\\" ? 2 : 1;
    }
    if (j >= source.length) return undefined;
    const key = source.slice(index + 1, j);
    const after = /\S/.exec(source.slice(j + 1, j + 1 + 64));
    return key ? { key, dynamic: after?.[0] === "+" } : undefined;
  }
  if (quote === "`") {
    let j = index + 1;
    while (j < source.length && source[j] !== "`") j += source[j] === "\\" ? 2 : 1;
    if (j >= source.length) return undefined;
    const text = source.slice(index + 1, j);
    const cut = text.indexOf("${");
    const key = cut === -1 ? text : text.slice(0, cut);
    return key ? { key, dynamic: cut !== -1 } : undefined;
  }
  return undefined;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Every key reference found in one source file. Deduped by key+dynamic+line. */
export function findKeyRefs(
  source: string,
  presets: readonly UsagePresetName[],
  keyPatterns: readonly RegExp[] = [],
  knownKeys?: ReadonlySet<string>,
): KeyRef[] {
  const starts = lineStarts(source);
  const seen = new Set<string>();
  const refs: KeyRef[] = [];
  const add = (key: string, dynamic: boolean, line: number) => {
    const id = `${key}\0${dynamic}\0${line}`;
    if (seen.has(id)) return;
    seen.add(id);
    refs.push({ key, dynamic, line });
  };
  // ponytail: assumes the single-file layout where a namespace is a top-level key ({ "common": {...} }); locales/en/common.json is unsupported.
  const ns = I18NEXT_NS.exec(source)?.[2];
  const keyPrefix = I18NEXT_KEY_PREFIX.exec(source)?.[2];

  for (const preset of presets) {
    for (const site of SITES[preset]) {
      for (const m of source.matchAll(site)) {
        const at = m.index + m[0].length;
        const arg = readKeyArg(source, at);
        if (!arg) continue;
        const line = lineOf(starts, at);
        if (preset !== "i18next") {
          add(arg.key, arg.dynamic, line);
        } else if (arg.key.includes(":")) {
          add(arg.key.replace(":", "."), arg.dynamic, line);
        } else {
          for (const k of keyPrefix ? [arg.key, `${keyPrefix}.${arg.key}`] : [arg.key]) {
            add(k, arg.dynamic, line);
            if (ns) add(`${ns}.${k}`, arg.dynamic, line);
          }
        }
      }
    }
  }

  // ponytail: any quoted literal equal to a catalog key counts as used (ternaries, arrays, indirection). Over-matches, never invents.
  if (knownKeys?.size) {
    for (const m of source.matchAll(/(['"`])([^'"`\n\\]+)\1/g)) if (knownKeys.has(m[2]!)) add(m[2]!, false, lineOf(starts, m.index));
  }

  for (const pattern of keyPatterns) {
    const g = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of source.matchAll(g)) if (m[1]) add(m[1], false, lineOf(starts, m.index));
  }
  return refs;
}

/** Compiles a --key-pattern into a /g RegExp whose first capture group is the key. */
export function compileKeyPattern(pattern: string): RegExp {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch (e) {
    throw new Error(`--key-pattern "${pattern}" is not a valid regex: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (new RegExp(`${pattern}|`).exec("")!.length < 2) {
    throw new Error(`--key-pattern "${pattern}" needs a capture group (the key)`);
  }
  return re;
}
