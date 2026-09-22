import type { Catalog } from "./types";

// Blocks dangerous tags (open or close), inline event handlers, and
// `javascript:` URIs, case-insensitive. Everything else (plain text, `{var}`
// placeholders, and benign formatting like `<a href>`/`<b>`/`<h3>`/`<ul><li>`)
// passes: catalog values reach the client as OTA strings and a
// `v-html`/`dangerouslySetInnerHTML` sink would turn any of the blocked
// constructs into stored XSS, but real legal/terms copy legitimately
// contains `<a href>`. Denylist, not a tag allowlist, so ordinary
// formatting never needs a codebase change to keep shipping.
// A single bounded character class (not adjacent unbounded quantifiers) keeps
// the scan linear on hostile input; anything mixing whitespace and slashes
// before the tag name is dangerous regardless of the exact arrangement.
const DANGEROUS_TAG_PATTERN = /<[\s/]{0,32}(script|iframe|object|embed|svg|style|link|meta)\b/i;
// Fixed allowlist of known DOM event-handler attribute names, not a bare
// `on\w+=`. Real translated copy can contain URL query params like
// `?convenioId=133` that a bare `on\w+=` would false-flag if it ever
// appeared word-initial.
const EVENT_HANDLER_PATTERN =
  /\bon(abort|animation(?:start|end|iteration|cancel)|auxclick|blur|change|click|contextmenu|copy|cut|dblclick|drag(?:start|enter|over|leave|end)?|drop|error|focus(?:in|out)?|gotpointercapture|input|invalid|key(?:down|press|up)|load|lostpointercapture|mouse(?:down|up|move|over|out|enter|leave|wheel)|paste|pointer(?:down|up|move|over|out|enter|leave|cancel)|reset|resize|scroll|select|submit|toggle|touch(?:start|end|move|cancel)|transition(?:start|end|run|cancel)|wheel)\s*=/i;
const JAVASCRIPT_URI_PATTERN = /javascript:/i;

// Decimal (`&#106;`) and hex (`&#x6a;`) character references, with optional
// leading zeros and an optional (missing) trailing semicolon. HTML parsers
// accept all of those, so an attacker can spell `javascript:` or `<script`
// entirely out of them and slip past a raw-text scan.
const NUMERIC_ENTITY_PATTERN = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g;

function decodeNumericEntities(value: string): string {
  return value.replace(NUMERIC_ENTITY_PATTERN, (match, hex: string | undefined, dec: string | undefined) => {
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec!, 10);
    if (!Number.isFinite(code) || code > 0x10ffff) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

/**
 * Runs all three scans on the raw string AND on a numeric-entity-decoded
 * copy, so `&#106;avascript:` is treated exactly like `javascript:`. The URI
 * scan additionally runs with tab/newline/CR stripped. URL parsers discard
 * those inside a scheme, so `jav<TAB>ascript:` (or its `&#x09;` spelling) is
 * live in a browser even though the raw text never contains `javascript:`.
 * Stripping stays scoped to the URI scan: tag and attribute names cannot
 * legally contain that whitespace, and stripping before those scans would
 * re-open the false-positive window the fixed handler list exists to close.
 */
function isDangerous(value: string): boolean {
  const decoded = decodeNumericEntities(value);
  for (const candidate of decoded === value ? [value] : [value, decoded]) {
    if (
      DANGEROUS_TAG_PATTERN.test(candidate) ||
      EVENT_HANDLER_PATTERN.test(candidate) ||
      JAVASCRIPT_URI_PATTERN.test(candidate)
    ) {
      return true;
    }
  }
  return JAVASCRIPT_URI_PATTERN.test(decoded.replace(/[\t\n\r]/g, ""));
}

/**
 * Throws if any leaf string in `catalog` contains a dangerous tag, an inline
 * event handler, or a `javascript:` URI. Lists every offending leaf as a
 * dot-path (e.g. "Greeting.Hello") so the failure points straight at the bad
 * translation.
 */
export function assertNoHtml(catalog: Catalog, opts?: { label?: string }): void {
  const offenders: string[] = [];

  const walk = (node: Catalog | string, path: string) => {
    if (typeof node === "string") {
      if (isDangerous(node)) offenders.push(path);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(catalog, "");

  if (offenders.length > 0) {
    const label = opts?.label ? ` in ${opts.label}` : "";
    throw new Error(`assertNoHtml: dangerous content found${label} at: ${offenders.join(", ")}`);
  }
}
