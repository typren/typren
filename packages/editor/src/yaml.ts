import yaml from "js-yaml";

/** Dump a value to YAML text for editing. Scalars come back trimmed. */
export function toYaml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return yaml.dump(value, { lineWidth: 80, noRefs: true }).trimEnd();
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse YAML text back to a value; never throws. */
export function fromYaml(text: string): ParseResult {
  try {
    return { ok: true, value: text.trim() === "" ? null : yaml.load(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
