import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";
import type { Catalog } from "./types";

export type { Purifier };

// Allowlist, not a denylist: catalog values reach the client as OTA strings and may land in a
// `v-html`/`dangerouslySetInnerHTML` sink, and every denylist this gate ever had was bypassed by a
// handler or URI spelling nobody listed. Legal/terms copy legitimately needs links and light
// formatting, so exactly that survives; anything else fails the publish.
const GATE_CONFIG: Config = {
  ALLOWED_TAGS: ["a", "b", "i", "strong", "em", "ul", "ol", "li", "p", "br", "h3", "span", "code"],
  ALLOWED_ATTR: ["href", "title"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  // Without it the parser hoists a leading `<script>`/`<base>` into <head>, where DOMPurify never
  // sees it, so it would vanish from the output without ever being reported as removed.
  FORCE_BODY: true,
  // http(s), mailto, or relative: no scheme-like `name:` before the first `/`, `?` or `#`.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^:/?#]*(?:[/?#]|$))/i,
};

let windowPurifier: Purifier | undefined;

function resolvePurifier(purifier: Purifier | undefined): Purifier {
  if (purifier) return purifier;
  if (typeof window !== "undefined") windowPurifier ??= DOMPurify(window);
  // Without a DOM, DOMPurify returns input unchanged, which would turn this gate into a silent pass.
  if (!windowPurifier?.isSupported) {
    throw new Error("assertNoHtml: no DOM available; pass opts.purifier (createNodePurifier from @typren/locale/build)");
  }
  return windowPurifier;
}

/**
 * True when the allowlist sanitizer would remove anything from `value`. This is a publish gate, not a
 * sanitizer: a string it would change fails instead of shipping a silently different translation.
 * `removed` (not a string comparison) is the signal so that harmless parser re-serialization, such as
 * `&` becoming `&amp;`, never counts as a change. `{var}` placeholders are plain text and pass.
 */
export function isUnsafeHtml(value: string, purifier?: Purifier): boolean {
  const p = resolvePurifier(purifier);
  p.sanitize(value, GATE_CONFIG);
  // DOMPurify reports its own parse scaffolding as removed: the BODY it built the fragment in, and the
  // one `<remove>` marker FORCE_BODY prepends. Neither says anything about the input; anything else does.
  const own = new Set(["BODY", "REMOVE"]);
  return p.removed.some((entry) => {
    const name = "element" in entry ? entry.element.nodeName : "";
    return !own.delete(name);
  });
}

/**
 * Throws if any leaf string in `catalog` holds markup outside the allowlist (tags a, b, i, strong, em,
 * ul, ol, li, p, br, h3, span, code; attributes href and title; http(s), mailto or relative URLs).
 * Lists every offending leaf as a dot-path (e.g. "Greeting.Hello") so the failure points straight at
 * the bad translation. Uses the page's `window` when there is one; Node callers pass a purifier.
 */
export function assertNoHtml(catalog: Catalog, opts?: { label?: string; purifier?: Purifier }): void {
  const purifier = resolvePurifier(opts?.purifier);
  const offenders: string[] = [];

  const walk = (node: Catalog | string, path: string) => {
    if (typeof node === "string") {
      if (isUnsafeHtml(node, purifier)) offenders.push(path);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(catalog, "");

  if (offenders.length > 0) {
    const label = opts?.label ? ` in ${opts.label}` : "";
    throw new Error(`assertNoHtml: markup outside the allowlist found${label} at: ${offenders.join(", ")}`);
  }
}
