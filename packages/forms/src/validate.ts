import type { FormSchema, ValidationError, ValidationResult } from "./types";

// Deliberately loose: one non-space local part, one @, a dot somewhere in the
// domain. Real deliverability can only be proven by sending mail; a stricter
// check only rejects real addresses. String operations rather than a regex:
// adjacent unbounded quantifiers backtrack polynomially on long non-matching
// input, and this runs on untrusted submission bodies. Length cap per RFC
// 5321's 254-octet ceiling.
function isEmailShaped(value: string): boolean {
  if (value.length > 254) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/**
 * Server-authoritative validation over an already-coerced field record (see
 * readFields in submission.ts). Client-side validation reuses this for UX,
 * but the server never trusts that it ran. Fields not declared in the schema
 * are ignored here; readFields drops them before they reach a sink.
 */
export function validate(schema: FormSchema, fields: Record<string, string | boolean>): ValidationResult {
  const errors: ValidationError[] = [];

  for (const field of schema.fields) {
    const value = Object.prototype.hasOwnProperty.call(fields, field.name) ? fields[field.name] : undefined;

    if (field.type === "checkbox") {
      if (value !== undefined && typeof value !== "boolean") {
        errors.push({ field: field.name, code: "invalid_type" });
      } else if (field.required && value !== true) {
        errors.push({ field: field.name, code: "required" });
      }
      continue;
    }

    if (value === undefined || value === "") {
      if (field.required) errors.push({ field: field.name, code: "required" });
      continue;
    }
    if (typeof value !== "string") {
      errors.push({ field: field.name, code: "invalid_type" });
      continue;
    }

    if (field.type === "email" && !isEmailShaped(value)) {
      errors.push({ field: field.name, code: "invalid_email" });
      continue;
    }
    if (field.type === "select" && field.options && !field.options.includes(value)) {
      errors.push({ field: field.name, code: "invalid_option" });
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors.push({ field: field.name, code: "too_long" });
      continue;
    }
    // Anchored so a partial match cannot pass. A malformed pattern throws:
    // the schema is author-controlled, so that is a programming error, not
    // untrusted input.
    if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
      errors.push({ field: field.name, code: "pattern" });
    }
  }

  return { ok: errors.length === 0, errors };
}
