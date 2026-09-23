import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RedirectEntry } from "@typren/core";

/** One entry in a host-supplied redirect map file: an incoming on-site path
 *  and where it should 301 to (an on-site path or an absolute http(s) URL). */
export type RedirectMapEntry = { from: string; to: string };

const normalize = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

const isExternal = (to: string): boolean => to.startsWith("https://") || to.startsWith("http://");

/**
 * Loads a host-supplied redirect map file into validated `RedirectEntry[]`,
 * the same shape `@typren/core`'s `buildRedirects` emits, so both sources
 * merge into one sync. This is what makes the CLI useful to ANY CloudFront
 * site, not just a typren one: frontmatter aliases describe pages that exist
 * in a content store, while a map file carries everything else a real site
 * accumulates (legacy platform URLs, removed pages, paths that moved
 * off-site entirely).
 *
 * Formats, by extension:
 *   - `.json`: an array of `{ "from": "/old", "to": "/new-or-https-url" }`
 *   - `.mjs`/`.js`: a module whose default export (or a named `REDIRECTS` /
 *     `redirects` export) is that same array. A config module may compute its
 *     entries; the JSON form exists for hosts that would rather not execute
 *     code from the map.
 *
 * Validation (fail loud, never silently drop, matching buildRedirects):
 * `from` must be an absolute on-site path; `to` must be an absolute on-site
 * path or an absolute http(s) URL; duplicate `from`s (after trailing-slash
 * normalization) throw. Entry `slug`s carry the map file's name so a merge
 * collision names its source.
 */
export async function loadRedirectMap(cwd: string, file: string): Promise<RedirectEntry[]> {
  const resolved = path.resolve(cwd, file);
  if (!fs.existsSync(resolved)) throw new Error(`typren-cloudfront: map file not found: ${resolved}`);

  const raw = await readEntries(resolved);
  if (!Array.isArray(raw)) throw new Error(`typren-cloudfront: ${file} must export an array of { from, to } entries`);

  const slug = `map:${path.basename(file)}`;
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const { from, to } = (entry ?? {}) as Partial<RedirectMapEntry>;
    if (typeof from !== "string" || !from.startsWith("/")) {
      throw new Error(`typren-cloudfront: ${file} entry ${i}: 'from' must be an absolute on-site path, got ${JSON.stringify(from)}`);
    }
    if (typeof to !== "string" || to.length === 0 || (!to.startsWith("/") && !isExternal(to))) {
      throw new Error(`typren-cloudfront: ${file} entry ${i}: 'to' must be an absolute path or http(s) URL (from ${from})`);
    }
    const key = normalize(from);
    if (seen.has(key)) throw new Error(`typren-cloudfront: ${file} declares ${key} twice`);
    seen.add(key);
    // External targets stay verbatim; on-site targets get the same slashless
    // normalization core applies, so toKvsEntries canonicalizes both sources
    // identically.
    return { from: key, to: isExternal(to) ? to : normalize(to), slug };
  });
}

async function readEntries(resolved: string): Promise<unknown> {
  if (resolved.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }
  if (resolved.endsWith(".mjs") || resolved.endsWith(".js")) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(resolved).href)) as Record<string, unknown>;
    return mod.default ?? mod.REDIRECTS ?? mod.redirects;
  }
  throw new Error(`typren-cloudfront: unsupported map format "${path.extname(resolved)}" (use .json, .mjs or .js)`);
}

/**
 * Merges content-derived entries with map-file entries, refusing a `from`
 * claimed by both sources: a silent override in either direction would make
 * one source's edit mysteriously not take effect.
 */
export function mergeRedirectEntries(content: RedirectEntry[], map: RedirectEntry[]): RedirectEntry[] {
  const bySource = new Map(content.map((e) => [e.from, e.slug]));
  for (const entry of map) {
    const owner = bySource.get(entry.from);
    if (owner) {
      throw new Error(`typren-cloudfront: ${entry.from} is declared by both "${owner}" (frontmatter) and "${entry.slug}"`);
    }
  }
  return [...content, ...map];
}
