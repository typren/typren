import { describe, it, expect } from "vitest";
import type { ResolvingMetadata } from "next";
import { buildMetadata, buildRootMetadata } from "./metadata";
import type { PageContent } from "../types";
import type { SeoConfig } from "./types";

const config: SeoConfig = {
  siteUrl: "https://example.com",
  siteName: "Example",
  entityDescription: "Entity description",
  defaultTitle: "Default title",
  defaultDescription: "Default description",
  titleTemplate: "%s | Example",
  bareTitleSlugs: ["bare-slug"],
  defaultOgImage: "/og.png",
};

const parent = Promise.resolve({
  openGraph: { siteName: "Example" },
  twitter: { card: "summary_large_image" },
}) as unknown as ResolvingMetadata;

const page = (meta: Record<string, unknown>): PageContent => ({ meta, slices: [], body: "" });

describe("buildRootMetadata", () => {
  it("builds root metadata from config defaults", () => {
    const metadata = buildRootMetadata(config);
    expect(metadata.title).toEqual({ default: "Default title", template: "%s | Example" });
    expect(metadata.description).toBe("Default description");
    expect(metadata.openGraph?.images).toEqual(["/og.png"]);
  });

  it("omits template/images when the config doesn't set them", () => {
    const bare: SeoConfig = {
      siteUrl: config.siteUrl,
      siteName: config.siteName,
      entityDescription: config.entityDescription,
      defaultTitle: config.defaultTitle,
      defaultDescription: config.defaultDescription,
    };
    const metadata = buildRootMetadata(bare);
    expect(metadata.title).toBe("Default title");
    expect(metadata.openGraph?.images).toBeUndefined();
  });
});

describe("buildMetadata", () => {
  it("sets title/description/canonical from a page's frontmatter", async () => {
    const result = await buildMetadata(page({ title: "About", description: "About us" }), "about", config, parent);
    expect(result.title).toBe("About");
    expect(result.alternates).toEqual({ canonical: "/about" });
    expect(result.openGraph).toMatchObject({ siteName: "Example", url: "/about", title: "About" });
  });

  it("opts a bareTitleSlugs slug out of the title template via title.absolute", async () => {
    const result = await buildMetadata(page({ title: "Bare" }), "bare-slug", config, parent);
    expect(result.title).toEqual({ absolute: "Bare" });
  });

  it("honors an explicit canonical override", async () => {
    const result = await buildMetadata(page({ canonical: "/custom" }), "about", config, parent);
    expect(result.alternates).toEqual({ canonical: "/custom" });
  });

  it("sets noindex robots and keywords when present", async () => {
    const result = await buildMetadata(page({ noindex: true, keywords: ["a", "b"] }), "x", config, parent);
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.keywords).toEqual(["a", "b"]);
  });

  it("carries forward the parent's openGraph/twitter defaults untouched when a page sets none", async () => {
    const result = await buildMetadata(page({}), "x", config, parent);
    expect(result.openGraph).toMatchObject({ siteName: "Example" });
    expect(result.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("stays canonical-only with a single-locale i18n (byte-identical)", async () => {
    const i18n = { locales: ["en"], defaultLocale: "en", routing: "prefix-except-default" as const };
    const result = await buildMetadata(page({ title: "About" }), "about", config, parent, i18n, "en");
    expect(result.alternates).toEqual({ canonical: "/about" });
  });

  it("emits hreflang languages (+x-default) with more than one locale", async () => {
    const i18n = { locales: ["en", "es"], defaultLocale: "en", routing: "prefix-except-default" as const };
    const result = await buildMetadata(page({ title: "About" }), "about", config, parent, i18n, "es");
    expect(result.alternates).toEqual({
      canonical: "/es/about",
      languages: { en: "/about", es: "/es/about", "x-default": "/about" },
    });
  });
});
