import type { ContentStore } from "../store";
import { mapLimit } from "../concurrency";
import { renderSlicesAsMarkdown, type SliceMarkdownRegistry } from "./markdown-render";

const FANOUT_LIMIT = 8;

/** Generates a detailed, always-fresh markdown export of every page in the
 *  store: the "llms-full.txt" companion to a hand-curated llms.txt (this
 *  function does NOT replace a curated summary file: a hand-authored
 *  llms.txt still needs a human author for marketing copy). */
export async function generateLlmsFullTxt(store: ContentStore, renderOverrides?: SliceMarkdownRegistry): Promise<string> {
  const slugs = await store.listSlugs();
  const sections = await mapLimit(slugs, FANOUT_LIMIT, async (slug) => {
    const page = await store.getPublished(slug);
    // A page kept out of search is kept out of the AI surfaces too.
    if (page.meta.noindex === true) return null;
    const title = typeof page.meta.title === "string" ? page.meta.title : slug;
    return `# ${title}\n\n${renderSlicesAsMarkdown(page.slices, renderOverrides)}`;
  });
  return sections.filter((s) => s !== null).join("\n\n---\n\n");
}
