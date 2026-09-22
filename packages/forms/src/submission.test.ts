import { describe, expect, it } from "vitest";
import { buildSubmission, honeypotTripped, readFields } from "./submission";
import type { FormSchema } from "./types";

const schema: FormSchema = {
  id: "contact",
  fields: [
    { name: "name", type: "text", required: true },
    { name: "age", type: "text" },
    { name: "consent", type: "checkbox" },
  ],
  honeypot: "website",
};

describe("readFields", () => {
  it("keeps declared string fields and drops undeclared keys", () => {
    const fields = readFields(schema, { name: "Ada", stray: "dropped" });
    expect(fields.name).toBe("Ada");
    expect("stray" in fields).toBe(false);
  });

  it("stringifies finite numbers and drops non-scalar values", () => {
    const fields = readFields(schema, { name: "Ada", age: 42 });
    expect(fields.age).toBe("42");
    expect(readFields(schema, { name: { nested: true }, age: Infinity })).toEqual({});
  });

  it.each([
    ["on", true],
    ["true", true],
    ["1", true],
    ["", false],
    ["false", false],
  ])("coerces checkbox string %j to %j", (raw, expected) => {
    expect(readFields(schema, { consent: raw }).consent).toBe(expected);
  });

  it("passes checkbox booleans through and drops other checkbox types", () => {
    expect(readFields(schema, { consent: true }).consent).toBe(true);
    expect("consent" in readFields(schema, { consent: 1 })).toBe(false);
  });

  it("leaves a prototype-pollution payload inert", () => {
    const body = JSON.parse('{"name":"Ada","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"}}') as Record<string, unknown>;
    const fields = readFields(schema, body);
    expect(fields).toEqual({ name: "Ada" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(fields)).toBeNull();
  });

  it("refuses forbidden names even when a schema declares them", () => {
    const hostile: FormSchema = { id: "x", fields: [{ name: "__proto__", type: "text" }] };
    expect(readFields(hostile, { ["__proto__"]: "boom" })).toEqual({});
  });
});

describe("honeypotTripped", () => {
  it("is false without a honeypot declared", () => {
    expect(honeypotTripped({ id: "x", fields: [] }, { website: "bot" })).toBe(false);
  });

  it("is false when the honeypot arrives empty or absent", () => {
    expect(honeypotTripped(schema, { website: "" })).toBe(false);
    expect(honeypotTripped(schema, {})).toBe(false);
    expect(honeypotTripped(schema, { website: null })).toBe(false);
  });

  it("trips on any value, string or not", () => {
    expect(honeypotTripped(schema, { website: "https://spam.example" })).toBe(true);
    expect(honeypotTripped(schema, { website: true })).toBe(true);
    expect(honeypotTripped(schema, { website: { a: 1 } })).toBe(true);
  });
});

describe("buildSubmission", () => {
  it("builds the canonical shape with a server-assigned timestamp", () => {
    const before = Date.now();
    const submission = buildSubmission(schema, { name: "Ada", consent: "on" });
    expect(submission.formId).toBe("contact");
    expect(submission.fields).toEqual({ name: "Ada", consent: true });
    expect(Date.parse(submission.meta.submittedAt)).toBeGreaterThanOrEqual(before - 1);
    expect(submission.meta.page).toBeUndefined();
  });

  it("reads page and locale from the reserved meta keys, strings only", () => {
    const submission = buildSubmission(schema, { name: "Ada", _page: "/pricing", _locale: "de" });
    expect(submission.meta.page).toBe("/pricing");
    expect(submission.meta.locale).toBe("de");
    expect(buildSubmission(schema, { name: "Ada", _page: 7 }).meta.page).toBeUndefined();
  });
});
