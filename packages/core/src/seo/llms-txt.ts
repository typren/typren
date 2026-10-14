import type { ContentStore } from "../store";
import { renderSlicesAsMarkdown, type SliceMarkdownRegistry } from "./markdown-render";

/** Generates a detailed, always-fresh markdown export of every page in the
 *  store: the "llms-full.txt" companion to a hand-curated llms.txt (this
 *  function does NOT replace a curated summary file: a hand-authored
 *  llms.txt still needs a human author for marketing copy). */
export async function generateLlmsFullTxt(store: ContentStore, renderOverrides?: SliceMarkdownRegistry): Promise<string> {
  const pages = await store.listPages();
  const sections = await Promise.all(
    pages.map(async ({ slug }) => {
      const page = await store.getPublished(slug);
      const title = typeof page.meta.title === "string" ? page.meta.title : slug;
      return `# ${title}\n\n${renderSlicesAsMarkdown(page.slices, renderOverrides)}`;
    })
  );
  return sections.join("\n\n---\n\n");
}
