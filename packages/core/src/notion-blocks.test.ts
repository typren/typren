import { describe, it, expect } from "vitest";
import { blocksToMarkdown, blocksToSegments, pageRecordFrom, richTextToMarkdown, type NotionBlock } from "./notion-blocks";

const text = (s: string, extra: Record<string, unknown> = {}) => [{ plain_text: s, ...extra }];

function block(type: string, payload: Record<string, unknown>, extra: Partial<NotionBlock> = {}): NotionBlock {
  return { id: `${type}-${Math.random()}`, type, [type]: payload, ...extra };
}

describe("richTextToMarkdown", () => {
  it("applies bold/italic/strikethrough/code annotations and links", () => {
    expect(richTextToMarkdown(text("plain"))).toBe("plain");
    expect(richTextToMarkdown(text("b", { annotations: { bold: true } }))).toBe("**b**");
    expect(richTextToMarkdown(text("i", { annotations: { italic: true } }))).toBe("_i_");
    expect(richTextToMarkdown(text("s", { annotations: { strikethrough: true } }))).toBe("~~s~~");
    expect(richTextToMarkdown(text("c", { annotations: { code: true } }))).toBe("`c`");
    expect(richTextToMarkdown(text("link", { href: "https://x.test" }))).toBe("[link](https://x.test)");
  });

  it("escapes markup in prose text so a Notion page cannot inject HTML", () => {
    expect(richTextToMarkdown(text('<img src=x onerror="alert(1)"> & co'))).toBe(
      '&lt;img src=x onerror="alert\\(1\\)"&gt; &amp; co'
    );
  });

  it("fences inline code past its own backticks instead of escaping it", () => {
    expect(richTextToMarkdown(text("a<b", { annotations: { code: true } }))).toBe("`a<b`");
    expect(richTextToMarkdown(text("x`<script>", { annotations: { code: true } }))).toBe("``x`<script>``");
    expect(richTextToMarkdown(text("`y", { annotations: { code: true } }))).toBe("`` `y ``");
  });

  // Regression: a line ending inside an inline-code run ended the paragraph and left the rest as a
  // live HTML block.
  it("collapses line endings inside inline code so the span can't end its paragraph", () => {
    const payload = "<div><img src=x onerror=alert(1)></div>";
    for (const nl of ["\n", "\r", "\r\n", "\n\n"]) {
      const md = richTextToMarkdown(text(`x${nl}${payload}`, { annotations: { code: true } }));
      expect(md).not.toMatch(/[\r\n]/);
      expect(md).toMatch(/^`x +<div>.*`$/);
    }
    const caption = blocksToMarkdown([
      block("bookmark", { url: "https://ok.test", caption: text(`a\n\n${payload}`, { annotations: { code: true } }) }),
    ]);
    expect(caption).not.toMatch(/\n\s*<div>/);
    expect(caption).toContain("`a  <div><img src=x onerror=alert(1)></div>`");
  });

  it("keeps the text but drops a link whose scheme is not http(s) or mailto", () => {
    expect(richTextToMarkdown(text("x", { href: "javascript:alert(1)" }))).toBe("x");
    expect(richTextToMarkdown(text("x", { href: "data:text/html,<b>" }))).toBe("x");
    expect(richTextToMarkdown(text("x", { href: "not a url" }))).toBe("x");
    expect(richTextToMarkdown(text("m", { href: "mailto:a@b.test" }))).toBe("[m](mailto:a@b.test)");
    expect(richTextToMarkdown(text("x", { text: { content: "x", link: { url: "javascript:void 0" } } }))).toBe("x");
  });

  it("percent-encodes characters that could close a link target and append markup", () => {
    expect(richTextToMarkdown(text("x", { href: "https://a.test/)<img src=x onerror=alert(1)>" }))).toBe(
      "[x](https://a.test/%29%3Cimg%20src=x%20onerror=alert%281%29%3E)"
    );
  });

  it("joins multiple runs and tolerates a non-array input", () => {
    expect(richTextToMarkdown([...text("a"), ...text(" b")])).toBe("a b");
    expect(richTextToMarkdown(undefined)).toBe("");
  });

  it("escapes a plain-text fake link so it never becomes a live javascript: link", () => {
    const md = richTextToMarkdown(text("[x](javascript:alert(1))"));
    expect(md).not.toContain("[x](javascript:alert(1))");
    expect(md).not.toMatch(/(?<!\\)\[x\](?<!\\)\(javascript:/);
  });

  it("still renders Notion's own bold/italic/code/link annotations over escaped text", () => {
    expect(richTextToMarkdown(text("a (b) c", { annotations: { bold: true } }))).toBe("**a \\(b\\) c**");
    expect(richTextToMarkdown(text("i", { annotations: { italic: true } }))).toBe("_i_");
    expect(richTextToMarkdown(text("link", { href: "https://x.test" }))).toBe("[link](https://x.test)");
  });

  it("round-trips ordinary punctuated text to the same visible characters", () => {
    const original = "Price: $5 (on sale!) - don't miss it.";
    const escaped = richTextToMarkdown(text(original));
    expect(escaped.replace(/\\(.)/g, "$1")).toBe(original);
  });

  it("escapes a line-leading block marker so plain text can't open a heading/quote/list", () => {
    expect(richTextToMarkdown(text("# not a heading"))).toBe("\\# not a heading");
    expect(richTextToMarkdown(text("> not a quote"))).toBe("&gt; not a quote"); // escapeHtml already defuses this
    expect(richTextToMarkdown(text("- not a list"))).toBe("\\- not a list");
    expect(richTextToMarkdown(text("+ not a list"))).toBe("\\+ not a list");
    expect(richTextToMarkdown(text("1. not a list"))).toBe("1\\. not a list");
  });

  it("escapes a bare line of = or - so it can't become a setext heading underline or thematic break", () => {
    expect(richTextToMarkdown(text("Title\n===="))).toBe("Title\n\\====");
    expect(richTextToMarkdown(text("Title\n----"))).toBe("Title\n\\----");
    expect(richTextToMarkdown(text("Title\n--"))).toBe("Title\n\\--");
    expect(richTextToMarkdown(text("- - -"))).toBe("\\- - -"); // a leading single "-" already escapes the rest inert
    // a single "-" is still caught by the existing bullet-marker escape, not double-escaped
    expect(richTextToMarkdown(text("-"))).toBe("\\-");
  });

  it("escapes a pipe so plain text can't open a table column it never asked for", () => {
    expect(richTextToMarkdown(text("a | b"))).toBe("a \\| b");
  });
});

describe("blocksToMarkdown", () => {
  it("renders paragraph/heading/list/quote/divider/code", () => {
    const blocks: NotionBlock[] = [
      block("heading_1", { rich_text: text("Title") }),
      block("heading_2", { rich_text: text("Subtitle") }),
      block("heading_3", { rich_text: text("Detail") }),
      block("paragraph", { rich_text: text("Hello world") }),
      block("bulleted_list_item", { rich_text: text("one") }),
      block("bulleted_list_item", { rich_text: text("two") }),
      block("quote", { rich_text: text("wise words") }),
      block("divider", {}),
      block("code", { rich_text: text("const x = 1;"), language: "ts" }),
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      [
        "# Title",
        "## Subtitle",
        "### Detail",
        "Hello world",
        "- one",
        "- two",
        "> wise words",
        "---",
        "```ts\nconst x = 1;\n```",
      ].join("\n\n")
    );
  });

  it("numbers consecutive numbered_list_item blocks and resets across interruptions", () => {
    const blocks: NotionBlock[] = [
      block("numbered_list_item", { rich_text: text("first") }),
      block("numbered_list_item", { rich_text: text("second") }),
      block("paragraph", { rich_text: text("break") }),
      block("numbered_list_item", { rich_text: text("restarts at one") }),
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      ["1. first", "2. second", "break", "1. restarts at one"].join("\n\n")
    );
  });

  it("renders to_do checked state, nested children, and a toggle as details", () => {
    const blocks: NotionBlock[] = [
      block("to_do", { rich_text: text("done"), checked: true }),
      block("to_do", { rich_text: text("not done"), checked: false }),
      block(
        "bulleted_list_item",
        { rich_text: text("parent") },
        { children: [block("bulleted_list_item", { rich_text: text("child") })] }
      ),
      block(
        "toggle",
        { rich_text: text("more") },
        { children: [block("paragraph", { rich_text: text("hidden content") })] }
      ),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] not done");
    expect(md).toContain("- parent\n  - child");
    expect(md).toContain("<details><summary>more</summary>\n\n  hidden content\n\n</details>");
  });

  it("renders an image from file or external, a table, and a bookmark", () => {
    const blocks: NotionBlock[] = [
      block("image", { file: { url: "https://x.test/a.png" }, caption: text("a photo") }),
      block("image", { external: { url: "https://x.test/b.png" } }),
      block("bookmark", { url: "https://x.test", caption: [] }),
      block("table", {}, { children: [block("table_row", { cells: [text("h1"), text("h2")] }), block("table_row", { cells: [text("v1"), text("v2")] })] }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("![a photo](https://x.test/a.png)");
    expect(md).toContain("![image](https://x.test/b.png)");
    expect(md).toContain("[https://x.test](https://x.test)");
    expect(md).toContain("| h1 | h2 |\n| --- | --- |\n| v1 | v2 |");
  });

  it("drops image and bookmark URLs with a disallowed scheme, keeping the caption", () => {
    const md = blocksToMarkdown([
      block("image", { external: { url: "javascript:alert(1)" }, caption: text("cap") }),
      block("bookmark", { url: "javascript:alert(2)", caption: text("bm") }),
    ]);
    expect(md).toBe("cap\n\nbm");
  });

  it("renders a code block as plain text in a fence its content cannot close, with a sanitized language", () => {
    const md = blocksToMarkdown([
      block("code", { rich_text: text("```\n<script>alert(1)</script>", { annotations: { bold: true } }), language: "js\n<x>" }),
    ]);
    expect(md).toBe("````\n```\n<script>alert(1)</script>\n````");
  });

  it("escapes a bookmark/image caption so it can't close its wrapper early and open a javascript: link", () => {
    const md = blocksToMarkdown([
      block("bookmark", { url: "https://ok.test", caption: text("a](javascript:alert(2)) [b") }),
      block("image", { external: { url: "https://ok.test/a.png" }, caption: text("a](javascript:alert(3)) [b") }),
    ]);
    expect(md).not.toMatch(/\]\(javascript:/);
  });

  describe("keeps every nested code block line indented inside its container (regression: fence breakout)", () => {
    // renderBlock used to indent only a code block's fence lines, not its
    // content lines. CommonMark closes a list item/quote/to_do at the first
    // line that drops below the marker's indent, so an unindented payload
    // line ended the container (and the fence with it) early and fell
    // through as a top-level HTML block in any renderer that allows raw HTML.
    const payload = "x\n<img src=x onerror=alert(1)>\ny";

    const containers: [string, NotionBlock][] = [
      ["bulleted_list_item", block("bulleted_list_item", { rich_text: text("parent") }, { children: [block("code", { rich_text: text(payload) })] })],
      ["numbered_list_item", block("numbered_list_item", { rich_text: text("parent") }, { children: [block("code", { rich_text: text(payload) })] })],
      ["to_do", block("to_do", { rich_text: text("parent"), checked: false }, { children: [block("code", { rich_text: text(payload) })] })],
      ["quote", block("quote", { rich_text: text("parent") }, { children: [block("code", { rich_text: text(payload) })] })],
    ];

    it.each(containers)("%s", (_kind, container) => {
      const md = blocksToMarkdown([container]);
      const fenceStart = md.indexOf("```");
      const fenceEnd = md.indexOf("```", fenceStart + 3);
      expect(fenceStart).toBeGreaterThan(-1);
      expect(fenceEnd).toBeGreaterThan(fenceStart);
      const lines = md.slice(fenceStart, fenceEnd).split("\n");
      const contentLines = lines.slice(1, -1); // drop the fence line itself and the trailing blank before the closing fence
      expect(contentLines.length).toBe(3); // x / <img .../> / y
      for (const line of contentLines) expect(line.startsWith("  ")).toBe(true);
      // The payload must never surface as an unindented (column-0) line,
      // which is what would let a markdown parser read it as a top-level
      // HTML block.
      expect(md).not.toMatch(/^<img/m);
    });
  });

  it("never lets a block type close the unsupported-block comment", () => {
    expect(blocksToMarkdown([block("x--><script>", {})])).toBe('<!-- typren: unsupported notion block type "?" -->');
  });

  it("degrades an unsupported block type to a comment instead of throwing", () => {
    const blocks: NotionBlock[] = [block("synced_block", {})];
    expect(() => blocksToMarkdown(blocks)).not.toThrow();
    expect(blocksToMarkdown(blocks)).toBe('<!-- typren: unsupported notion block type "synced_block" -->');
  });
});

describe("component-call directive + blocksToSegments", () => {
  it("splits prose runs and component calls from a callout directive", () => {
    const blocks: NotionBlock[] = [
      block("paragraph", { rich_text: text("intro") }),
      block("callout", { rich_text: text('::widget\n{"size":"lg"}') }),
      block("paragraph", { rich_text: text("outro") }),
    ];
    const segments = blocksToSegments(blocks);
    expect(segments).toEqual([
      { kind: "prose", blocks: [blocks[0]] },
      { kind: "component", name: "widget", props: { size: "lg" } },
      { kind: "prose", blocks: [blocks[2]] },
    ]);
  });

  it("also recognizes a code block directive, and allows no-prop calls", () => {
    const blocks: NotionBlock[] = [block("code", { rich_text: text("::spacer") })];
    expect(blocksToSegments(blocks)).toEqual([{ kind: "component", name: "spacer", props: {} }]);
  });

  it("falls back to prose on malformed directive JSON instead of throwing", () => {
    const blocks: NotionBlock[] = [block("callout", { rich_text: text("::widget\nnot json") })];
    expect(() => blocksToSegments(blocks)).not.toThrow();
    expect(blocksToSegments(blocks)).toEqual([{ kind: "prose", blocks }]);
  });

  it("treats a directive name outside [A-Za-z0-9_-] as prose, so it never reaches an HTML comment", () => {
    const blocks: NotionBlock[] = [block("callout", { rich_text: text("::x--><script>alert(1)</script>") })];
    expect(blocksToSegments(blocks)).toEqual([{ kind: "prose", blocks }]);
    expect(blocksToMarkdown(blocks)).not.toContain("<script>");
  });

  it("treats a bare callout with no name after :: as ordinary prose", () => {
    const blocks: NotionBlock[] = [block("callout", { rich_text: text("::") })];
    expect(blocksToSegments(blocks)).toEqual([{ kind: "prose", blocks }]);
  });

  it("omits a component segment from the markdown rendering with a visible marker", () => {
    const blocks: NotionBlock[] = [
      block("paragraph", { rich_text: text("before") }),
      block("callout", { rich_text: text("::widget") }),
      block("paragraph", { rich_text: text("after") }),
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      ['before', '<!-- typren: component "widget" omitted from markdown body, see slices -->', "after"].join("\n\n")
    );
  });
});

describe("pageRecordFrom", () => {
  it("maps every segment into one ordered slices array, in order, with an empty body", () => {
    const blocks: NotionBlock[] = [
      block("paragraph", { rich_text: text("intro") }),
      block("callout", { rich_text: text('::widget\n{"size":"lg"}') }),
      block("paragraph", { rich_text: text("outro") }),
    ];
    const record = pageRecordFrom(blocksToSegments(blocks), { meta: { title: "Page" } });
    expect(record).toEqual({
      meta: { title: "Page" },
      slices: [
        { slice: "prose", markdown: "intro" },
        { slice: "widget", size: "lg" },
        { slice: "prose", markdown: "outro" },
      ],
      body: "",
    });
  });

  it("defaults meta to {} and honors a custom proseSlice name", () => {
    const blocks: NotionBlock[] = [block("paragraph", { rich_text: text("hi") })];
    const record = pageRecordFrom(blocksToSegments(blocks), { proseSlice: "markdown-block" });
    expect(record).toEqual({ meta: {}, slices: [{ slice: "markdown-block", markdown: "hi" }], body: "" });
  });
});
