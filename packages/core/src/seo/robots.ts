import type { MetadataRoute } from "next";
import type { SeoConfig } from "./types";

/** AIO: named AI/answer-engine crawlers, explicitly allow-listed even though
 *  redundant with a wildcard allow — kept explicit as a one-line future
 *  revert point (a project may later decide to block training crawlers). */
export const DEFAULT_AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;

export function buildRobots(config: SeoConfig): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: [...(config.aiCrawlers ?? DEFAULT_AI_CRAWLERS)], allow: "/" },
    ],
    sitemap: `${config.siteUrl}/sitemap.xml`,
  };
}
