import { describe, it, expect } from "vitest";
import { buildSitemap } from "./sitemap";
import { fakeStore } from "./test-fixtures";
import type { SeoConfig } from "./types";

const config: SeoConfig = {
  siteUrl: "https://example.com",
  siteName: "Example",
  entityDescription: "d",
  defaultTitle: "t",
  defaultDescription: "d",
};

describe("buildSitemap", () => {
  it("maps homeSlug to the bare site root at priority 1/weekly; other pages get the defaults", () => {
    const store = fakeStore([{ slug: "home" }, { slug: "about" }]);
    const entries = buildSitemap(store, config, { homeSlug: "home" });

    const home = entries.find((e) => e.url === config.siteUrl);
    expect(home).toMatchObject({ priority: 1, changeFrequency: "weekly" });

    const about = entries.find((e) => e.url === `${config.siteUrl}/about`);
    expect(about).toMatchObject({ priority: 0.7, changeFrequency: "monthly" });
  });

  it("excludes pages with noindex frontmatter", () => {
    const store = fakeStore([{ slug: "hidden", meta: { noindex: true } }]);
    expect(buildSitemap(store, config)).toHaveLength(0);
  });

  it("honors per-page sitemap frontmatter overrides", () => {
    const store = fakeStore([
      { slug: "rare", meta: { sitemap: { priority: 0.2, changeFrequency: "yearly" } } },
    ]);
    const [entry] = buildSitemap(store, config);
    expect(entry).toMatchObject({ priority: 0.2, changeFrequency: "yearly" });
  });
});
