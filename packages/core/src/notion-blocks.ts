import type { PageContent, Slice } from "./types";

/**
 * Notion block tree -> typren content, generic and dependency-free: this
 * file knows Notion block SHAPES (paragraph/heading/list/code/table/...),
 * never a site's entities or components. Block payloads are Notion's raw
 * per-type JSON (e.g. `{ rich_text: [...] }` under `paragraph`), so types
 * here stay loose (`Record<string, unknown>`) the same way notion-adapter.ts's
 * property mapper does.
 *
 * Two-stage pipeline:
 *   blocks -> segments (`blocksToSegments`): an ordered list of either prose
 *     (a run of plain content blocks) or a component call (see the directive
 *     convention below). This is the shape closest to what the page actually
 *     contains.
 *   segments -> output: `blocksToMarkdown` renders the prose segments back
 *     into one markdown string (component segments become a visible comment,
 *     never silently vanish); `pageRecordFrom` instead maps EVERY segment,
 *     prose and component alike, into one ordered typren `slices` array;
 *     see its own doc comment for why that mapping is lossless.
 *
 * Component-call convention (generic, no entity/component names live here):
 * a `callout` or `code` block whose first line is `::componentName` is a
 * component call; every remaining line is JSON (not YAML, no yaml parser is
 * already a dependency of this package, and hand-authoring one JSON object
 * in a Notion code block is a small ask) parsed as that component's props.
 * Malformed JSON, a missing name, or an empty prop body after the `::name`
 * line all degrade to treating the block as ordinary prose rather than
 * throwing, a typo in Notion should never break the whole page read.
 *
 * Third-party Notion text (any workspace collaborator's content, not just the
 * integration owner's) is escaped and scheme-checked here specifically so it
 * can't become live markup or a script-executing link. As defense in depth, a
 * host should still render the resulting markdown with raw HTML disabled or
 * sanitized, rather than trusting this module as the only layer.
 */

/** One Notion block, trimmed to what conversion needs. `children` is only
 *  present when the caller (see NotionClient.listBlockChildren) already
 *  resolved nested blocks, this module never fetches anything itself. */
export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
} & Record<string, unknown>;

export type ProseSegment = { kind: "prose"; blocks: NotionBlock[] };
export type ComponentSegment = { kind: "component"; name: string; props: Record<string, unknown> };
export type NotionSegment = ProseSegment | ComponentSegment;

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const asArr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(asObj) : []);

// Notion text is third-party input, and the markdown this file emits is
// rendered as HTML by the host. Raw `<`/`>`/`&` would pass through markdown
// as live markup, so prose text is entity-escaped; code is fenced instead
// (markdown never decodes entities inside code, so escaping would show them).
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A backtick fence longer than any backtick run inside `s`, so `s` cannot close it early. */
const fenceFor = (s: string, min: number) =>
  "`".repeat(Math.max(min, ...(s.match(/`+/g) ?? []).map((run) => run.length + 1)));

/** `url` as a markdown link target when it is http(s) or mailto, else null. Whitespace, `<`, `>`,
 *  quotes and parentheses are percent-encoded so the target cannot close the link early and
 *  append raw markup. */
function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    if (!["http:", "https:", "mailto:"].includes(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  // encodeURIComponent leaves `(`, `)` and `'` alone, hence the second pass.
  return url.replace(/[\s<>"'()`]/g, (c) =>
    encodeURIComponent(c).replace(/[()']/g, (p) => `%${p.charCodeAt(0).toString(16).toUpperCase()}`)
  );
}

// Directive and block-type names land inside `<!-- ... -->`; anything outside this set could close the comment.
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

function runToMarkdown(run: Record<string, unknown>): string {
  let text = (run.plain_text as string | undefined) ?? (asObj(run.text).content as string | undefined) ?? "";
  const a = asObj(run.annotations);
  if (a.code) {
    const fence = fenceFor(text, 1);
    const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
    text = `${fence}${pad}${text}${pad}${fence}`;
  } else {
    text = escapeHtml(text);
  }
  if (a.bold) text = `**${text}**`;
  if (a.italic) text = `_${text}_`;
  if (a.strikethrough) text = `~~${text}~~`;
  // A link with a disallowed scheme (javascript:, data:, ...) keeps its text and loses the link.
  const href = safeUrl(run.href ?? asObj(asObj(run.text).link).url);
  if (href) text = `[${text}](${href})`;
  return text;
}

/** A Notion rich_text array -> one inline markdown string (bold/italic/
 *  strikethrough/code/link annotations applied). */
export function richTextToMarkdown(runs: unknown): string {
  return asArr(runs).map(runToMarkdown).join("");
}

/** Same, but plain: no markdown escaping. Used for the component-directive
 *  parser, where a run of `**bold**` markup inside a code block must not
 *  corrupt the JSON it's meant to carry. */
function richTextToPlain(runs: unknown): string {
  return asArr(runs)
    .map((r) => (r.plain_text as string | undefined) ?? (asObj(r.text).content as string | undefined) ?? "")
    .join("");
}

/** `{ name, props }` when `block` is a callout/code block whose text starts
 *  with `::name`; `null` for anything else (including a `::` line with
 *  invalid JSON after it, malformed is "not a directive", not an error). */
function componentDirective(block: NotionBlock): { name: string; props: Record<string, unknown> } | null {
  if (block.type !== "callout" && block.type !== "code") return null;
  const payload = asObj(block[block.type]);
  const raw = richTextToPlain(payload.rich_text);
  const lines = raw.split("\n");
  const head = lines[0]?.trim() ?? "";
  if (!head.startsWith("::")) return null;
  const name = head.slice(2).trim();
  if (!SAFE_NAME.test(name)) return null;
  const propsText = lines.slice(1).join("\n").trim();
  if (!propsText) return { name, props: {} };
  try {
    const parsed: unknown = JSON.parse(propsText);
    return { name, props: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return null; // malformed props JSON: fall back to rendering the block as prose
  }
}

/** Group a page's top-level blocks into an ordered list of prose runs and
 *  component calls (see this file's header for the directive convention).
 *  Nested children of a NON-directive block stay attached to it and render
 *  as part of whichever prose segment that block belongs to (see
 *  `blocksToMarkdown`'s use of `renderBlocks`, which walks `children`). */
export function blocksToSegments(blocks: NotionBlock[]): NotionSegment[] {
  const segments: NotionSegment[] = [];
  let prose: NotionBlock[] = [];
  const flush = () => {
    if (prose.length) segments.push({ kind: "prose", blocks: prose });
    prose = [];
  };
  for (const block of blocks) {
    const directive = componentDirective(block);
    if (directive) {
      flush();
      segments.push({ kind: "component", name: directive.name, props: directive.props });
    } else {
      prose.push(block);
    }
  }
  flush();
  return segments;
}

function imageMarkdown(payload: Record<string, unknown>): string {
  const url = safeUrl(asObj(payload.file ?? payload.external).url);
  const caption = richTextToMarkdown(payload.caption);
  return url ? `![${caption || "image"}](${url})` : caption;
}

function tableMarkdown(block: NotionBlock, indent: string): string {
  const rows = block.children ?? [];
  if (!rows.length) return "";
  const cellsOf = (row: NotionBlock): string[] =>
    ((asObj(row.table_row).cells as unknown[][] | undefined) ?? []).map(richTextToMarkdown);
  return rows
    .map((row, i) => {
      const cells = cellsOf(row);
      const line = `${indent}| ${cells.join(" | ")} |`;
      // Best-effort: treat the first row as the header (Notion's
      // `has_column_header` toggle isn't threaded through here, good enough
      // for a generic markdown render, not a lossless table round-trip).
      return i === 0 ? `${line}\n${indent}| ${cells.map(() => "---").join(" | ")} |` : line;
    })
    .join("\n");
}

function renderBlock(block: NotionBlock, depth: number, numberedIndex: number): string {
  const indent = "  ".repeat(depth);
  const payload = asObj(block[block.type]);
  const text = () => richTextToMarkdown(payload.rich_text);
  const nestedBlocks = () => (block.children?.length ? renderBlocks(block.children, depth + 1) : "");
  const withNested = (line: string) => {
    const nested = nestedBlocks();
    return nested ? `${line}\n${nested}` : line;
  };

  switch (block.type) {
    case "paragraph":
      return withNested(indent + text());
    case "heading_1":
      return indent + "# " + text();
    case "heading_2":
      return indent + "## " + text();
    case "heading_3":
      return indent + "### " + text();
    case "bulleted_list_item":
      return withNested(indent + "- " + text());
    case "numbered_list_item":
      return withNested(indent + `${numberedIndex}. ` + text());
    case "to_do":
      return withNested(indent + `- [${payload.checked ? "x" : " "}] ` + text());
    case "quote":
      return withNested(indent + "> " + text());
    case "code": {
      // Plain text, fenced past its own longest backtick run: markdown shows code verbatim, so
      // annotations or entity escapes would be visible noise, and a short fence could be closed early.
      const raw = richTextToPlain(payload.rich_text);
      const fence = fenceFor(raw, 3);
      const lang = typeof payload.language === "string" && /^[\w+#. -]*$/.test(payload.language) ? payload.language : "";
      // Every content line carries the container's indent, not just the
      // fence: CommonMark closes a list item/quote/to_do at the first line
      // that drops below the marker's indent, so an unindented code line
      // would end the container (and the fence with it) early, spilling the
      // rest of the code out as a top-level block.
      const code = raw
        .split("\n")
        .map((line) => indent + line)
        .join("\n");
      return indent + fence + lang + "\n" + code + "\n" + indent + fence;
    }
    case "divider":
      return indent + "---";
    case "image":
      return indent + imageMarkdown(payload);
    case "bookmark":
    case "link_preview":
    case "embed": {
      const url = safeUrl(payload.url);
      const caption = richTextToMarkdown(payload.caption);
      return indent + (url ? `[${caption || escapeHtml(url)}](${url})` : caption);
    }
    case "table":
      return tableMarkdown(block, indent);
    case "toggle":
      return `${indent}<details><summary>${text()}</summary>\n\n${nestedBlocks()}\n\n${indent}</details>`;
    default:
      // Never throw on a block type this converter doesn't know: a page with
      // one exotic block (a synced block, a column layout, ...) should still
      // render everything else, not blow up the whole read.
      return `${indent}<!-- typren: unsupported notion block type "${SAFE_NAME.test(block.type) ? block.type : "?"}" -->`;
  }
}

function renderBlocks(blocks: NotionBlock[], depth: number): string {
  let numbered = 0;
  return blocks
    .map((block) => {
      numbered = block.type === "numbered_list_item" ? numbered + 1 : 0;
      return renderBlock(block, depth, numbered);
    })
    .join("\n\n");
}

/** Notion block children (already recursively resolved, see
 *  `NotionClient.listBlockChildren`) -> one markdown string: every PROSE
 *  segment rendered and joined (paragraph, heading_1/2/3, bulleted/numbered
 *  lists, to_do, quote, code, divider, image, table, toggle, bookmark/
 *  link_preview/embed; anything else degrades to an HTML comment, see
 *  `renderBlock`). A component segment (see the directive convention above)
 *  is NOT prose, it becomes a visible marker comment instead of silently
 *  disappearing from the body; callers that want it realized as a real
 *  component belong in `pageRecordFrom` instead. */
export function blocksToMarkdown(blocks: NotionBlock[]): string {
  return blocksToSegments(blocks)
    .map((segment) =>
      segment.kind === "prose"
        ? renderBlocks(segment.blocks, 0)
        : `<!-- typren: component "${segment.name}" omitted from markdown body, see slices -->`
    )
    .join("\n\n");
}

/** Segments -> a typren `PageContent`, ordered slices only (no `body`): a
 *  prose segment becomes one `{ slice: proseSlice, markdown }` entry, a
 *  component segment becomes `{ slice: name, ...props }`, the exact shape
 *  `CmsConfig.registry` already expects (see types.ts's `Slice`). This is
 *  lossless on ORDER (typren's `slices` is itself an ordered array, so
 *  interleaved prose/component runs survive exactly as authored) but NOT on
 *  markdown-body position: typren's page model renders `slices` and `body`
 *  as two separate channels, not one interleaved stream, so putting every
 *  segment into `slices` (leaving `body` empty) is the one mapping that
 *  doesn't need a channel that doesn't exist. A host must register a
 *  `proseSlice`-named component (default `"prose"`) that renders `markdown`,
 *  same as registering any other slice; this module doesn't render one. */
export function pageRecordFrom(
  segments: NotionSegment[],
  opts: { proseSlice?: string; meta?: Record<string, unknown> } = {}
): PageContent {
  const proseSlice = opts.proseSlice ?? "prose";
  const slices: Slice[] = segments.map((s) =>
    s.kind === "prose" ? { slice: proseSlice, markdown: renderBlocks(s.blocks, 0) } : { slice: s.name, ...s.props }
  );
  return { meta: opts.meta ?? {}, slices, body: "" };
}
