import type { Slice } from "../types";
import type { SliceJsonLd } from "./types";

/** Walks a page's slices, calls each one's registered SliceJsonLd (if any),
 *  and flattens the results into one array — the host renders these once per
 *  page next to BreadcrumbList, instead of each slice component rendering its
 *  own <script> tag (today's ad hoc faq.tsx behavior). Unregistered slice
 *  names are silently skipped, not an error — most slices have no schema. */
export function collectSliceJsonLd(slices: Slice[], registry: Record<string, SliceJsonLd> = {}): object[] {
  const out: object[] = [];
  for (const s of slices) {
    const fn = registry[s.slice];
    if (!fn) continue;
    try {
      const result = fn(s);
      if (!result) continue;
      out.push(...(Array.isArray(result) ? result : [result]));
    } catch {
      // A slice's props are content-authored (markdown frontmatter) —
      // malformed props must degrade to "no schema for this slice",
      // never break the page.
    }
  }
  return out;
}
