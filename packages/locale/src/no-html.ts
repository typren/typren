import type { Catalog } from "./types";

// Blocks dangerous tags (open or close), inline event handlers, and
// `javascript:` URIs — case-insensitive. Everything else (plain text, `{var}`
// placeholders, and benign formatting like `<a href>`/`<b>`/`<h3>`/`<ul><li>`)
// passes: catalog values reach the client as OTA strings and a
// `v-html`/`dangerouslySetInnerHTML` sink would turn any of the blocked
// constructs into stored XSS, but real legal/terms copy legitimately
// contains `<a href>`. Denylist, not a tag allowlist, so ordinary
// formatting never needs a codebase change to keep shipping.
const DANGEROUS_TAG_PATTERN = /<\s*\/?\s*(script|iframe|object|embed|svg|style|link|meta)\b/i;
// Fixed allowlist of known DOM event-handler attribute names, not a bare
// `on\w+=` — real translated copy can contain URL query params like
// `?convenioId=133` that a bare `on\w+=` would false-flag if it ever
// appeared word-initial.
const EVENT_HANDLER_PATTERN =
  /\bon(abort|animation(?:start|end|iteration|cancel)|blur|change|click|contextmenu|copy|cut|dblclick|drag(?:start|enter|over|leave|end)?|drop|error|focus(?:in|out)?|input|invalid|key(?:down|press|up)|load|mouse(?:down|up|move|over|out|enter|leave|wheel)|paste|reset|resize|scroll|select|submit|touch(?:start|end|move|cancel)|transition(?:start|end|run|cancel)|wheel)\s*=/i;
const JAVASCRIPT_URI_PATTERN = /javascript:/i;

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
      if (
        DANGEROUS_TAG_PATTERN.test(node) ||
        EVENT_HANDLER_PATTERN.test(node) ||
        JAVASCRIPT_URI_PATTERN.test(node)
      ) {
        offenders.push(path);
      }
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
