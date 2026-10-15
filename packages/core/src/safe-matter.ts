import matter from "gray-matter";
import { CORE_SCHEMA, load, mergeTag, timestampTag } from "js-yaml";

// gray-matter's default engine set includes `javascript` (alias `js`), which
// eval()s the front-matter block when a file opens with `---js`. Content is
// data, and a content-only change must never run code on a build runner or
// server, so every front-matter parse in core goes through this.
const refuse = (): never => {
  throw new Error("typren: JavaScript front matter is not allowed");
};

// gray-matter's bundled YAML engine expands aliases without limit, so a few
// hundred bytes of nested `*ref`s (billion laughs) build gigabytes of objects.
// Aliases are refused outright and the block is size-capped. The schema keeps
// what gray-matter's engine accepted (timestamps as Date, `<<` merge keys) so
// existing content parses to the same data.
const MAX_FRONT_MATTER_BYTES = 256 * 1024;
// noRefs (below) inlines every shared reference, so a ~1 KB DAG of shared
// objects (`n = { l: n, r: n }`, twenty-odd deep) expands to gigabytes before
// the byte cap above ever sees it. Counting nodes per visit bounds that first.
// A real page is a few thousand nodes; this is far above any of them.
const MAX_FRONT_MATTER_NODES = 100_000;
const SCHEMA = CORE_SCHEMA.withTags(timestampTag, mergeTag);
const yaml = (src: string): object => {
  if (Buffer.byteLength(src) > MAX_FRONT_MATTER_BYTES) {
    throw new Error(`typren: front matter exceeds ${MAX_FRONT_MATTER_BYTES / 1024} KB`);
  }
  return (load(src, { schema: SCHEMA, maxAliases: 0 }) as object | null) ?? {};
};
const SAFE_ENGINES = { js: refuse, javascript: refuse, yaml };

export const parseMatter = (raw: string) => matter(raw, { engines: SAFE_ENGINES });

// gray-matter's default YAML dump re-encodes a shared object reference (e.g. two
// slices with the same nested prop) as a `&ref`/`*ref` anchor pair, which
// parseMatter's engine refuses on read (aliases are disabled above, deliberately,
// against billion-laughs). noRefs forces a full inline dump instead, so every
// write here stays within what this file's own parser accepts. Reading the
// result back before returning it catches that, and the size cap, before
// anything is written to disk.
const assertDumpable = (data: object): void => {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown): void => {
    if (++nodes > MAX_FRONT_MATTER_NODES) throw new Error("typren: front matter too large");
    if (typeof value !== "object" || value === null) return;
    if (ancestors.has(value)) throw new Error("typren: front matter contains a circular reference");
    ancestors.add(value);
    // Shared (non-ancestor) references are legitimate, e.g. a shallow-copied
    // duplicate slice; they are just counted again on every visit.
    for (const child of Object.values(value)) visit(child);
    ancestors.delete(value);
  };
  visit(data);
};

export const stringifyMatter = (body: string, data: object): string => {
  assertDumpable(data);
  // gray-matter forwards unknown stringify options straight through to its
  // bundled js-yaml dump (its own docs: "options to pass to gray-matter and
  // js-yaml"), but its shipped .d.ts doesn't declare js-yaml's own options.
  const noRefs = { noRefs: true } as Parameters<typeof matter.stringify>[2];
  const raw = matter.stringify(body, data, noRefs);
  parseMatter(raw);
  return raw;
};
