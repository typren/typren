import { describe, it, expect } from "vitest";
import { serializeFieldSchema, parseFieldSchema, isFieldSchema, type SerializedFieldSchema } from "./field-schema";

const SCHEMA: SerializedFieldSchema = {
  hero: {
    headline: { type: "text", label: "Headline" },
    tone: { type: "select", options: ["light", "dark"] },
    items: {
      type: "slot",
      itemLabel: "title",
      of: { title: { type: "text" }, link: { type: "link" } },
    },
  },
  cta: {
    label: { type: "text" },
  },
};

describe("field-schema round-trip", () => {
  it("serializes then parses back to an equivalent value", () => {
    const json = serializeFieldSchema(SCHEMA);
    expect(parseFieldSchema(json)).toEqual(SCHEMA);
  });

  it("produces readable (indented) JSON", () => {
    expect(serializeFieldSchema(SCHEMA)).toContain("\n");
  });
});

describe("isFieldSchema", () => {
  it("accepts an empty schema and a well-formed nested slot", () => {
    expect(isFieldSchema({})).toBe(true);
    expect(isFieldSchema(SCHEMA)).toBe(true);
  });

  it.each([
    ["not an object", "nope"],
    ["an array at the top", []],
    ["null", null],
    ["a non-object slice", { hero: "nope" }],
    ["an unknown field type", { hero: { headline: { type: "bogus" } } }],
    ["non-string options", { hero: { tone: { type: "select", options: [1, 2] } } }],
    ["non-string label", { hero: { headline: { label: 42 } } }],
    ["a malformed nested slot ('of')", { hero: { items: { type: "slot", of: { title: "nope" } } } }],
  ])("rejects %s", (_name, value) => {
    expect(isFieldSchema(value)).toBe(false);
  });
});

describe("parseFieldSchema", () => {
  it("throws a descriptive error on invalid JSON", () => {
    expect(() => parseFieldSchema("{not json")).toThrow(/invalid fieldSchema JSON/);
  });

  it("throws a descriptive error on well-formed JSON with the wrong shape", () => {
    expect(() => parseFieldSchema('{"hero": {"headline": {"type": "bogus"}}}')).toThrow(
      /does not match the expected shape/
    );
  });
});
