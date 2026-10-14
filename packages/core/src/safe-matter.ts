import matter from "gray-matter";

// gray-matter's default engine set includes `javascript` (alias `js`), which
// eval()s the front-matter block when a file opens with `---js`. Content is
// data, and a content-only change must never run code on a build runner or
// server, so every front-matter parse in core goes through this.
const refuse = (): never => {
  throw new Error("typren: JavaScript front matter is not allowed");
};
const SAFE_ENGINES = { js: refuse, javascript: refuse };

export const parseMatter = (raw: string) => matter(raw, { engines: SAFE_ENGINES });
