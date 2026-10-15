import { describe, it, expect } from "vitest";
import { decodeXmlEntities, parseListObjectsV2 } from "./xml";

describe("decodeXmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeXmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(`a & b <c> "d" 'e'`);
  });

  it("decodes decimal and hex numeric entities", () => {
    expect(decodeXmlEntities("&#65;&#x42;")).toBe("AB");
  });

  it("leaves an unparseable numeric entity untouched", () => {
    expect(decodeXmlEntities("&#a;")).toBe("&#a;"); // "a" isn't a decimal digit; parseInt(..., 10) is NaN
  });
});

describe("parseListObjectsV2", () => {
  it("throws on a Contents entry missing a required field", () => {
    const xml = "<ListBucketResult><Contents><Key>a.webp</Key></Contents></ListBucketResult>";
    expect(() => parseListObjectsV2(xml)).toThrow(/malformed ListObjectsV2 entry/);
  });
});
