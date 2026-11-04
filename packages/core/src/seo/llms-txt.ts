import type { ContentStore } from "../store";
import type { SeoConfig } from "./types";
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

/** The llms.txt index (llmstxt.org): the site name, its entity description as
 *  the summary, then one link per indexable page with its description, and a
 *  pointer to llms-full.txt for the whole text. Serve it at "/llms.txt". */
export async function generateLlmsTxt(store: ContentStore, config: SeoConfig): Promise<string> {
  const slugs = await store.listSlugs();
  const links = await mapLimit(slugs, FANOUT_LIMIT, async (slug) => {
    const { meta } = await store.getPublished(slug);
    if (meta.noindex === true) return null;
    const title = typeof meta.title === "string" ? meta.title : slug;
    const url = slug === config.homeSlug ? config.siteUrl : `${config.siteUrl}/${slug}`;
    const description = typeof meta.description === "string" && meta.description ? `: ${meta.description}` : "";
    return `- [${title}](${url})${description}`;
  });
  return [
    `# ${config.siteName}`,
    `> ${config.entityDescription}`,
    `## Pages\n\n${links.filter((l) => l !== null).join("\n")}`,
    `## Optional\n\n- [Full content](${config.siteUrl}/llms-full.txt): every page as one markdown document`,
  ].join("\n\n") + "\n";
}
