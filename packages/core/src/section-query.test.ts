import { describe, expect, it } from "vitest";
import { DOCUMENT_LIMITS, parseSectionDocument, parseSectionMap, parseSectionQuery } from "./section-query";

const keys = ["hero", "prose"];

describe("parseSectionQuery", () => {
  it("returns a valid slice, by key list or predicate", () => {
    const raw = JSON.stringify({ slice: "hero", heading: "Hi", cta: { label: "Go" } });
    const want = { slice: "hero", heading: "Hi", cta: { label: "Go" } };
    expect(parseSectionQuery(raw, keys)).toEqual(want);
    expect(parseSectionQuery(raw, (k) => k === "hero")).toEqual(want);
  });

  it("returns null for missing, empty and malformed input", () => {
    expect(parseSectionQuery(undefined, keys)).toBeNull();
    expect(parseSectionQuery(null, keys)).toBeNull();
    expect(parseSectionQuery("", keys)).toBeNull();
    expect(parseSectionQuery("{not json", keys)).toBeNull();
  });

  it("returns null for an unknown slice", () => {
    expect(parseSectionQuery('{"slice":"nope"}', keys)).toBeNull();
    expect(parseSectionQuery('{"slice":"toString"}', keys)).toBeNull();
    expect(parseSectionQuery('{"slice":"hero"}', () => false)).toBeNull();
  });

  it("returns null when the value is not a plain object with a string slice", () => {
    for (const raw of ["null", "[]", '["hero"]', '"hero"', "1", "{}", '{"slice":1}', '{"slice":["hero"]}']) {
      expect(parseSectionQuery(raw, keys), raw).toBeNull();
    }
  });

  it("drops __proto__ keys at any depth without polluting", () => {
    const got = parseSectionQuery('{"slice":"hero","__proto__":{"polluted":1},"a":{"__proto__":{"polluted":2}}}', keys);
    expect(got).toEqual({ slice: "hero", a: {} });
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("drops raw-HTML keys and script or data URLs under URL-like keys, at any depth", () => {
    const raw = JSON.stringify({
      slice: "hero",
      __html: "<img src=x onerror=alert(1)>",
      body: { dangerouslySetInnerHTML: { __html: "<script>1</script>" }, text: "kept" },
      href: "javascript:alert(1)",
      ctaHref: " \tJava\nScript:alert(1)",
      image_url: "data:text/html,<script>1</script>",
      items: [{ link: "vbscript:x" }, { link: "/about" }],
      heading: "javascript: is just text here",
      src: "/img/a.webp",
      website: "https://example.com",
      count: 3,
    });
    expect(parseSectionQuery(raw, keys)).toEqual({
      slice: "hero",
      body: { text: "kept" },
      items: [{}, { link: "/about" }],
      heading: "javascript: is just text here",
      src: "/img/a.webp",
      website: "https://example.com",
      count: 3,
    });
  });
});

describe("parseSectionMap", () => {
  it("keeps the entries that are valid slices, cleaned like one slice", () => {
    const raw = JSON.stringify({
      a: { slice: "hero", heading: "Hi", href: "javascript:alert(1)", body: { dangerouslySetInnerHTML: { __html: "x" } } },
      b: { slice: "nope" },
      c: "hero",
      d: { slice: "prose" },
    }).replace("{", '{"__proto__":{"slice":"hero"},');
    expect(parseSectionMap(raw, keys)).toEqual({ a: { slice: "hero", heading: "Hi", body: {} }, d: { slice: "prose" } });
  });

  it("returns {} for anything but an object", () => {
    for (const raw of [undefined, null, "", "{x", "[]", '[{"slice":"hero"}]', "null", '"a"']) {
      expect(parseSectionMap(raw, keys), String(raw)).toEqual({});
    }
  });
});

describe("parseSectionDocument", () => {
  const known = (k: string) => Object.hasOwn({ hero: 1, prose: 1 }, k);

  it("keeps keyed slices in order and marks unknown ones null", () => {
    expect(
      parseSectionDocument(
        [
          { key: "a", slice: { slice: "hero", heading: "Hi", list: [1, "x", null, { y: true }] } },
          { key: "b", slice: { slice: "nope" } },
          { key: "c", slice: { slice: "toString" } },
          { key: "d", slice: "hero" },
        ],
        known,
      ),
    ).toEqual([
      { key: "a", slice: { slice: "hero", heading: "Hi", list: [1, "x", null, { y: true }] } },
      { key: "b", slice: null },
      { key: "c", slice: null },
      { key: "d", slice: null },
    ]);
  });

  it("applies the query's rules to structured-clone values without polluting", () => {
    const hostile = JSON.parse('{"slice":"hero","__proto__":{"polluted":1},"a":{"__proto__":{"polluted":2}}}');
    const [entry] = parseSectionDocument(
      [
        {
          key: "a",
          slice: {
            ...hostile,
            __html: "<script>1</script>",
            body: { dangerouslySetInnerHTML: { __html: "x" }, text: "kept" },
            ctaHref: " \tJava\nScript:alert(1)",
            items: [{ link: "data:text/html,x" }, { link: "/about" }],
            when: new Date(0),
            map: new Map([[1, 2]]),
            n: Number.NaN,
            fn: undefined,
          },
        },
      ],
      known,
    )!;
    expect(entry!.slice).toEqual({ slice: "hero", a: {}, body: { text: "kept" }, items: [{}, { link: "/about" }] });
    expect(Object.getPrototypeOf(entry!.slice)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses malformed documents, bad or duplicate keys, and anything over the caps", () => {
    const one = { slice: "hero" };
    for (const raw of [
      null,
      {},
      [null],
      [{ slice: one }],
      [{ key: "", slice: one }],
      [{ key: "x".repeat(65), slice: one }],
      [{ key: "a", slice: one }, { key: "a", slice: one }],
      Array.from({ length: DOCUMENT_LIMITS.slices + 1 }, (_, i) => ({ key: `k${i}`, slice: one })),
      [{ key: "a", slice: { slice: "hero", big: "x".repeat(DOCUMENT_LIMITS.size) } }],
    ]) {
      expect(parseSectionDocument(raw, known)).toBeNull();
    }
    let deep: Record<string, unknown> = { slice: "hero" };
    for (let i = 0; i < DOCUMENT_LIMITS.depth + 1; i++) deep = { slice: "hero", child: deep };
    expect(parseSectionDocument([{ key: "a", slice: deep }], known)).toBeNull();
    const many = Array.from({ length: DOCUMENT_LIMITS.slices }, (_, i) => ({ key: `k${i}`, slice: one }));
    expect(parseSectionDocument(many, ["hero"])).toHaveLength(DOCUMENT_LIMITS.slices);
  });
});
