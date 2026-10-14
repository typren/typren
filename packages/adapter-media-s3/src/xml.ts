/**
 * Minimal ListObjectsV2 XML reader. No XML dependency: S3-compatible
 * `ListBucketResult` bodies are flat and predictable enough that a couple of
 * regexes cover it, and a real parser is a new dependency for a format this
 * narrow (see the ladder in AGENTS.md's Style section).
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the XML entities S3 keys can legitimately contain (e.g. a literal
 *  "&" or "<" in an uploaded filename comes back as `&amp;`/`&lt;`). */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITIES[entity];
  });
}

const tag = (block: string, name: string): string | undefined => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

export type ListObjectsV2Result = {
  entries: { key: string; size: number; lastModified: string }[];
  nextContinuationToken?: string;
};

/** Parses one ListObjectsV2 response body: every `<Contents>` entry plus the
 *  pagination token, if the result was truncated. */
export function parseListObjectsV2(xml: string): ListObjectsV2Result {
  const entries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, block]) => {
    const key = tag(block, "Key");
    const size = tag(block, "Size");
    const lastModified = tag(block, "LastModified");
    if (key === undefined || size === undefined || lastModified === undefined) {
      throw new Error("typren: malformed ListObjectsV2 entry");
    }
    return { key: decodeXmlEntities(key), size: Number(size), lastModified };
  });
  const isTruncated = tag(xml, "IsTruncated") === "true";
  const nextContinuationToken = isTruncated ? tag(xml, "NextContinuationToken") : undefined;
  return { entries, nextContinuationToken };
}
