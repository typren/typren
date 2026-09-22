import { describe, expect, it } from "vitest";
import type { FormSchema } from "./types";
import { validate } from "./validate";

const schema: FormSchema = {
  id: "contact",
  fields: [
    { name: "name", type: "text", required: true, maxLength: 10 },
    { name: "email", type: "email", required: true },
    { name: "message", type: "textarea" },
    { name: "topic", type: "select", options: ["sales", "support"] },
    { name: "consent", type: "checkbox", required: true },
    { name: "newsletter", type: "checkbox" },
    { name: "ref", type: "hidden", pattern: "[a-z-]+" },
  ],
};

const valid = { name: "Ada", email: "ada@example.com", consent: true };

describe("validate", () => {
  it("accepts a minimal valid submission", () => {
    expect(validate(schema, valid)).toEqual({ ok: true, errors: [] });
  });

  it("accepts every optional field filled correctly", () => {
    const result = validate(schema, {
      ...valid,
      message: "hello",
      topic: "sales",
      newsletter: false,
      ref: "landing-page",
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["missing required text", {}, { field: "name", code: "required" }],
    ["empty required text", { name: "" }, { field: "name", code: "required" }],
    ["missing required checkbox", { name: "Ada", email: "a@b.co" }, { field: "consent", code: "required" }],
    ["unchecked required checkbox", { ...valid, consent: false }, { field: "consent", code: "required" }],
    ["malformed email", { ...valid, email: "not-an-email" }, { field: "email", code: "invalid_email" }],
    ["email without dot in domain", { ...valid, email: "a@b" }, { field: "email", code: "invalid_email" }],
    ["value outside select options", { ...valid, topic: "gossip" }, { field: "topic", code: "invalid_option" }],
    ["value over maxLength", { ...valid, name: "x".repeat(11) }, { field: "name", code: "too_long" }],
    ["value failing pattern", { ...valid, ref: "UPPER" }, { field: "ref", code: "pattern" }],
    ["partial pattern match rejected", { ...valid, ref: "ok-but respaced" }, { field: "ref", code: "pattern" }],
    ["boolean in a text field", { ...valid, message: true }, { field: "message", code: "invalid_type" }],
    ["string in a checkbox field", { ...valid, newsletter: "yes" }, { field: "newsletter", code: "invalid_type" }],
  ] as const)("rejects %s", (_label, fields, error) => {
    const result = validate(schema, fields as Record<string, string | boolean>);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(error);
  });

  it("collects one error per broken field instead of stopping at the first", () => {
    const result = validate(schema, { name: "", email: "nope", consent: false });
    expect(result.errors).toHaveLength(3);
  });

  it("leaves optional empty fields alone", () => {
    expect(validate(schema, { ...valid, message: "", topic: "" })).toEqual({ ok: true, errors: [] });
  });

  it("ignores fields the schema does not declare", () => {
    expect(validate(schema, { ...valid, extra: "whatever" }).ok).toBe(true);
  });
});
