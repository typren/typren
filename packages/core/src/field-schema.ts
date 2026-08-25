import type { FieldDef, SliceSchema } from "./types";

const FIELD_TYPES = new Set<NonNullable<FieldDef["type"]>>([
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "yaml",
  "image",
  "media",
  "richtext",
  "icon",
  "color",
  "link",
  "slot",
]);

/** `CmsConfig["fieldSchema"]`'s shape, named for its own module: the set of
 *  per-slice field hints, keyed by slice name. Already plain data (strings,
 *  arrays, nested objects, no functions) -- this type exists so a hosted
 *  dashboard reading it from a repo-committed JSON file has something to
 *  import instead of reaching into `CmsConfig`. */
export type SerializedFieldSchema = Record<string, SliceSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldDef(value: unknown): value is FieldDef {
  if (!isPlainObject(value)) return false;
  if (
    value.type !== undefined &&
    (typeof value.type !== "string" || !FIELD_TYPES.has(value.type as NonNullable<FieldDef["type"]>))
  )
    return false;
  if (value.options !== undefined && !(Array.isArray(value.options) && value.options.every((o) => typeof o === "string")))
    return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;
  if (value.itemLabel !== undefined && typeof value.itemLabel !== "string") return false;
  // "slot" only, but recursion is validated regardless of `type` so a
  // malformed `of` fails loudly rather than being silently ignored.
  if (value.of !== undefined && !isSliceSchema(value.of)) return false;
  return true;
}

function isSliceSchema(value: unknown): value is SliceSchema {
  return isPlainObject(value) && Object.values(value).every(isFieldDef);
}

/** Runtime type guard for a full fieldSchema document (every slice, every
 *  field). Exported so a caller can validate without also wanting the throw
 *  behavior `parseFieldSchema` has for the string-in-string-out case. */
export function isFieldSchema(value: unknown): value is SerializedFieldSchema {
  return isPlainObject(value) && Object.values(value).every(isSliceSchema);
}

/** Serialize a TS-authored `CmsConfig.fieldSchema` to the JSON a hosted
 *  dashboard commits alongside content and reads back on load. The TS shape
 *  is already JSON-serializable, so this is JSON.stringify with stable
 *  formatting for a readable diff; the real work is `parseFieldSchema`'s
 *  validation on the way back in. */
export function serializeFieldSchema(schema: SerializedFieldSchema): string {
  return JSON.stringify(schema, null, 2);
}

/** Parse + validate a fieldSchema JSON document. Throws with a descriptive
 *  message on malformed JSON or anything not shaped like
 *  `Record<sliceName, Record<fieldName, FieldDef>>`, so a hand-edited or
 *  stale file fails loudly instead of silently feeding a control garbage. */
export function parseFieldSchema(json: string): SerializedFieldSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`typren: invalid fieldSchema JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isFieldSchema(parsed)) {
    throw new Error(
      "typren: fieldSchema JSON does not match the expected shape (Record<sliceName, Record<fieldName, FieldDef>>)"
    );
  }
  return parsed;
}
