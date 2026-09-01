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

  it("joins multiple runs and tolerates a non-array input", () => {
    expect(richTextToMarkdown([...text("a"), ...text(" b")])).toBe("a b");
    expect(richTextToMarkdown(undefined)).toBe("");
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
