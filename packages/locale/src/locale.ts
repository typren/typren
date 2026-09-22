import type { Catalog } from "./types";

/**
 * Dot-path lookup into a nested catalog, e.g. "Namespace.KeyName". Returns
 * `{ value: string }` rather than a bare string. That wrapper shape is
 * this package's stable return convention (see `t` below), kept even here
 * for callers that resolve without interpolating.
 */
export function resolve(catalog: Catalog, key: string): { value: string } | undefined {
  const parts = key.split(".");
  let node: string | Catalog = catalog;
  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return undefined;
    }
    node = node[part]!;
  }
  return typeof node === "string" ? { value: node } : undefined;
}

// Matches a single `{var}` placeholder, but not one embedded inside a
// doubled `{{var}}`. Those are left alone verbatim (not our syntax).
const PLACEHOLDER = /(?<!\{)\{(\w+)\}(?!\})/g;

/**
 * Flat single-brace `{var}` substitution only. No ICU plural/select, no
 * `{{ }}`. A missing arg leaves the placeholder literal instead of throwing.
 */
export function interpolate(template: string, args?: Record<string, string | number>): string {
  if (!args) return template;
  return template.replace(PLACEHOLDER, (full, name: string) => {
    const value = args[name];
    return value === undefined ? full : String(value);
  });
}

/** resolve + interpolate; unknown key returns `{ value: key }` so a missing translation renders as its own key instead of throwing. */
export function t(catalog: Catalog, key: string, args?: Record<string, string | number>): { value: string } {
  const found = resolve(catalog, key);
  if (!found) return { value: key };
  return { value: interpolate(found.value, args) };
}

/**
 * Closest-locale fallback: exact match -> override remap -> en-US/en-GB kept
 * distinct (not collapsed to a single "en" bucket) -> language-only match ->
 * supported[0] as the last-resort default.
 *
 * `overrides` carries site-specific remaps (e.g. a backend quirk that needs
 * one locale routed to another's catalog) as data, not a hardcoded case in
 * this function.
 */
export function getClosestLocale(
  supported: string[],
  requested: string,
  overrides: Record<string, string> = {},
): string {
  if (supported.length === 0) {
    throw new Error("getClosestLocale: supported must be non-empty");
  }

  const remapped = overrides[requested] ?? requested;
  if (supported.includes(remapped)) return remapped;
  if (supported.includes(requested)) return requested;

  const language = requested.split("-")[0];
  if (language === "en") {
    if (supported.includes("en-US")) return "en-US";
    if (supported.includes("en-GB")) return "en-GB";
  }

  const languageMatch = supported.find((s) => s.split("-")[0] === language);
  if (languageMatch) return languageMatch;

  return supported[0]!;
}
