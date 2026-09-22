import type { FormSchema, Submission } from "./types";

// Keys that must never be read off or written into an untrusted record:
// assigning any of them on a plain object can reach Object.prototype.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// How browsers and form encoders spell a checked checkbox. An unchecked one
// is simply absent from the body, which readFields leaves as absent too.
const CHECKED = new Set(["on", "true", "1"]);

/**
 * Reserved body keys the client helper fills so the server can populate
 * SubmissionMeta without guessing from headers. Underscore-prefixed so they
 * cannot collide with a schema field (schema authors own plain names).
 */
export const META_PAGE_KEY = "_page";
export const META_LOCALE_KEY = "_locale";

function readString(body: Record<string, unknown>, key: string): string | undefined {
  if (FORBIDDEN_KEYS.has(key)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Extracts the schema's fields from an untrusted parsed body into a
 * null-prototype record. Iterating schema fields rather than body keys is the
 * prototype-pollution discipline: keys like __proto__ are never read unless a
 * schema declares them, and those names are refused outright. Values that are
 * not string/number/boolean (objects, arrays, null) are dropped, so a crafted
 * nested payload degrades to "field absent" and fails `required` at worst.
 */
export function readFields(schema: FormSchema, body: Record<string, unknown>): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = Object.create(null);
  for (const field of schema.fields) {
    if (FORBIDDEN_KEYS.has(field.name)) continue;
    if (!Object.prototype.hasOwnProperty.call(body, field.name)) continue;
    const raw = body[field.name];
    if (field.type === "checkbox") {
      if (typeof raw === "boolean") fields[field.name] = raw;
      else if (typeof raw === "string") fields[field.name] = CHECKED.has(raw.toLowerCase());
      continue;
    }
    if (typeof raw === "string") fields[field.name] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) fields[field.name] = String(raw);
  }
  return fields;
}

/** True when the schema declares a honeypot and the body carries any value in it. */
export function honeypotTripped(schema: FormSchema, body: Record<string, unknown>): boolean {
  if (!schema.honeypot) return false;
  const value = readString(body, schema.honeypot);
  if (value !== undefined) return value !== "";
  // A non-string value (true, an object) in the honeypot is still a bot.
  return Object.prototype.hasOwnProperty.call(body, schema.honeypot) && body[schema.honeypot] != null && body[schema.honeypot] !== false;
}

/** Builds the canonical Submission every sink receives from an untrusted parsed body. */
export function buildSubmission(schema: FormSchema, body: Record<string, unknown>): Submission {
  const page = readString(body, META_PAGE_KEY);
  const locale = readString(body, META_LOCALE_KEY);
  return {
    formId: schema.id,
    fields: readFields(schema, body),
    meta: {
      submittedAt: new Date().toISOString(),
      ...(page ? { page } : {}),
      ...(locale ? { locale } : {}),
    },
  };
}
