import matter from "gray-matter";
import { CORE_SCHEMA, load, mergeTag, timestampTag } from "js-yaml";

// gray-matter ships a `javascript` front-matter engine that eval()s the block
// when a file opens with `---javascript`. Both `review` and `migrate` parse
// content this CLI did not author (merged markdown, migration notes, and for
// `migrate --remote`, a third party's server). Content is data, never code.
//
// For the same reason the YAML engine refuses aliases (gray-matter's bundled
// one expands them without limit: billion laughs) and caps the block's size.
// The schema keeps gray-matter's timestamps and `<<` merge keys, so existing
// content parses to the same data. Mirrors @typren/core's safe-matter.ts,
// which is internal to core.
const MAX_FRONT_MATTER_BYTES = 256 * 1024;
const SCHEMA = CORE_SCHEMA.withTags(timestampTag, mergeTag);
const SAFE_ENGINES = {
  javascript: (): never => {
    throw new Error("typren: javascript front-matter is not supported");
  },
  yaml: (src: string): object => {
    if (Buffer.byteLength(src) > MAX_FRONT_MATTER_BYTES) {
      throw new Error(`typren: front matter exceeds ${MAX_FRONT_MATTER_BYTES / 1024} KB`);
    }
    return (load(src, { schema: SCHEMA, maxAliases: 0 }) as object | null) ?? {};
  },
};

export const parseMatter = (raw: string) => matter(raw, { engines: SAFE_ENGINES });
