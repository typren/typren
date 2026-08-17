import { describe, it, expect } from "vitest";
import { buildRobots, DEFAULT_AI_CRAWLERS } from "./robots";
import type { SeoConfig } from "./types";

const config: SeoConfig = {
  siteUrl: "https://example.com",
  siteName: "Example",
  entityDescription: "d",
  defaultTitle: "t",
  defaultDescription: "d",
};

describe("buildRobots", () => {
  it("allows every crawler by default and lists the AI-crawler default set", () => {
    const { rules, sitemap } = buildRobots(config);
    const ruleList = Array.isArray(rules) ? rules : [rules];
    expect(ruleList[0]).toEqual({ userAgent: "*", allow: "/" });
    expect(ruleList[1]).toEqual({ userAgent: [...DEFAULT_AI_CRAWLERS], allow: "/" });
    expect(sitemap).toBe("https://example.com/sitemap.xml");
  });

  it("uses config.aiCrawlers instead of the default list when given", () => {
    const { rules } = buildRobots({ ...config, aiCrawlers: ["MyBot"] });
    const ruleList = Array.isArray(rules) ? rules : [rules];
    expect(ruleList[1]).toEqual({ userAgent: ["MyBot"], allow: "/" });
  });
});
