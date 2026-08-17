import type { Slice } from "../types";

/** Best-effort generic slice -> prose flattener: pulls heading/body (common
 *  to nearly every slice), plus common repeating-item shapes (columns/cards/
 *  items/quotes/stats), each rendered as "title: body"-style lines. This is
 *  a *default*, not a registry — a typren consumer whose slices don't fit
 *  this shape can pass its own `renderSlice` override per slice name (mirrors
 *  the sliceJsonLd registry's opt-in shape) via `overrides`. */
export type SliceMarkdownRegistry = Record<string, (props: Record<string, unknown>) => string>;

function flattenSlice(slice: Slice): string {
  const s = slice as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof s.heading === "string") lines.push(s.heading.replaceAll("**", ""));
  if (typeof s.body === "string") lines.push(s.body.replaceAll("**", ""));
  const repeating = (s.columns ?? s.cards ?? s.items ?? s.quotes ?? s.stats) as
    | Record<string, unknown>[]
    | undefined;
  for (const item of repeating ?? []) {
    const title = item.title ?? item.question ?? item.name ?? item.label;
    const body = item.body ?? item.answer ?? item.quote ?? item.value;
    if (title || body) lines.push([title, body].filter(Boolean).join(": "));
  }
  return lines.join("\n");
}

/** Renders one page's slices as plain-text prose, in slice order. Used for
 *  both the raw-markdown mirror and llms-full.txt — one flattening pass, two
 *  consumers, so a slice-shape fix only happens once. */
export function renderSlicesAsMarkdown(slices: Slice[], overrides: SliceMarkdownRegistry = {}): string {
  return slices
    .map((s) => (overrides[s.slice] ? overrides[s.slice](s) : flattenSlice(s)))
    .filter(Boolean)
    .join("\n\n");
}
