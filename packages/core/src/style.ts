/** The site's visual tokens as an editable `--typren-*` set. Stored on
 *  `SiteSettingsRuntime.style` (custom property name to value) and turned into
 *  CSS with {@link styleCss}; a site reads them with `var(--typren-primary, ...)`. */
/** `number` is unitless (a line height, a ratio). */
export type StyleTokenKind = "color" | "text" | "length" | "number";
export type StyleTokenGroup = "colors" | "typography" | "shape";
export interface StyleToken {
  /** The CSS custom property, always `--typren-*`. */
  name: string;
  label: string;
  group: StyleTokenGroup;
  kind: StyleTokenKind;
}

export const STYLE_TOKENS: readonly StyleToken[] = [
  { name: "--typren-bg", label: "Background", group: "colors", kind: "color" },
  { name: "--typren-fg", label: "Text", group: "colors", kind: "color" },
  { name: "--typren-primary", label: "Primary", group: "colors", kind: "color" },
  { name: "--typren-primary-fg", label: "Text on primary", group: "colors", kind: "color" },
  { name: "--typren-secondary", label: "Secondary", group: "colors", kind: "color" },
  { name: "--typren-accent", label: "Accent", group: "colors", kind: "color" },
  { name: "--typren-muted", label: "Muted", group: "colors", kind: "color" },
  { name: "--typren-border", label: "Border", group: "colors", kind: "color" },
  { name: "--typren-font-body", label: "Body font", group: "typography", kind: "text" },
  { name: "--typren-font-heading", label: "Heading font", group: "typography", kind: "text" },
  { name: "--typren-font-size", label: "Base font size", group: "typography", kind: "length" },
  { name: "--typren-line-height", label: "Body line height", group: "typography", kind: "number" },
  { name: "--typren-heading-line-height", label: "Heading line height", group: "typography", kind: "number" },
  // Each heading level is the one below it times this ratio, e.g.
  // h2 = calc(var(--typren-font-size) * pow(var(--typren-type-scale), 3)).
  { name: "--typren-type-scale", label: "Type scale", group: "typography", kind: "number" },
  { name: "--typren-radius", label: "Corner radius", group: "shape", kind: "length" },
  { name: "--typren-space", label: "Base spacing", group: "shape", kind: "length" },
];

const KNOWN = new Set(STYLE_TOKENS.map((t) => t.name));
// Values land inside a stylesheet, so anything that could end the declaration
// or the rule, pull in another resource, or comment out what follows in the
// same <style> is dropped rather than escaped.
const UNSAFE_VALUE = /[;{}<>\\]|\/\*|url\(|image-set\(|src\(|@import|expression\(/i;

/** The known tokens of `style` whose values are safe to emit. */
export function sanitizeStyle(style: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style ?? {})) {
    const value = typeof v === "string" ? v.trim() : "";
    if (KNOWN.has(k) && value && !UNSAFE_VALUE.test(value)) out[k] = value;
  }
  return out;
}

/** Which of the site's own custom properties each token drives: a set token
 *  is emitted under its mapped name as well as its own, and the editor reads a
 *  token's current value from the mapped name. A site sets its own map as
 *  `studio.style` in `typren.config.json`; one that styles with `--typren-*`
 *  directly maps a token to itself.
 *  ponytail: a plain name-to-name map. A StyleAdapter (design-token files,
 *  per-mode values) is the upgrade once a site needs more than renaming. */
export type StyleMap = Readonly<Record<string, string>>;

/** The stock shadcn names, used when a site gives no map, so a shadcn
 *  site restyles with no config. The same names core's theme.css reads as its
 *  host fallbacks. */
export const STYLE_MAP_DEFAULT: StyleMap = Object.freeze({
  "--typren-bg": "--background",
  "--typren-fg": "--foreground",
  "--typren-primary": "--primary",
  "--typren-primary-fg": "--primary-foreground",
  "--typren-secondary": "--secondary",
  "--typren-accent": "--accent",
  "--typren-muted": "--muted",
  "--typren-border": "--border",
  "--typren-font-body": "--font-sans",
  "--typren-radius": "--radius",
});

/** A custom property name safe to write into a stylesheet. */
export const CUSTOM_PROPERTY = /^--[a-z0-9-]+$/;

/** Why `map` can't be a style map, or null when it can: every key a known
 *  token, every value a plain lowercase custom property name. */
export function styleMapError(map: unknown): string | null {
  if (!map || typeof map !== "object" || Array.isArray(map)) return "must be an object of token to custom property";
  for (const [k, v] of Object.entries(map)) {
    if (!KNOWN.has(k)) return `"${k}" is not a Typren style token`;
    if (typeof v !== "string" || !CUSTOM_PROPERTY.test(v)) return `"${k}" must map to a custom property like "--primary", got ${JSON.stringify(v)}`;
  }
  return null;
}

/** The name `token` writes to and is read from under `map`; the token itself
 *  when the map leaves it out. */
export function mappedName(token: string, map: StyleMap = STYLE_MAP_DEFAULT): string {
  const to = map[token];
  return typeof to === "string" && CUSTOM_PROPERTY.test(to) ? to : token;
}

/** The declarations a site style makes: each safe token under its own name
 *  and its mapped one, with the same concrete value. A site whose CSS sets
 *  `--typren-x: var(--x)` gets both overridden at once, so neither refers to
 *  the other and no cycle can form. An invalid map entry is skipped. */
export function styleVars(style: Record<string, string> | undefined, map: StyleMap = STYLE_MAP_DEFAULT): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sanitizeStyle(style))) {
    out[k] = v;
    out[mappedName(k, map)] = v;
  }
  return out;
}

/** A rule for the site's stylesheet (empty string when nothing is set). The
 *  doubled `:root:root` outranks the site's own `:root`, `.dark` and
 *  `html.dark` blocks whatever order the stylesheets load in or which layer
 *  they sit in, as long as this rule is unlayered; only `!important` or an
 *  inline style on `<html>` beat it. */
export function styleCss(style: Record<string, string> | undefined, map: StyleMap = STYLE_MAP_DEFAULT): string {
  const decls = Object.entries(styleVars(style, map)).map(([k, v]) => `  ${k}: ${v};`);
  return decls.length ? `:root:root {\n${decls.join("\n")}\n}\n` : "";
}
