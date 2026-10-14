import matter from "gray-matter";

// gray-matter ships a `javascript` front-matter engine that eval()s the block
// when a file opens with `---javascript`. Both `review` and `migrate` parse
// content this CLI did not author (merged markdown, migration notes, and for
// `migrate --remote`, a third party's server). Content is data, never code.
const SAFE_ENGINES = {
  javascript: (): never => {
    throw new Error("typren: javascript front-matter is not supported");
  },
};

export const parseMatter = (raw: string) => matter(raw, { engines: SAFE_ENGINES });
