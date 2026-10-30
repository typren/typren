import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../types";
import { resolveSeoConfig, withSiteSettings } from "./site-settings";
import { organizationJsonLd } from "./json-ld";
import { buildRootMetadata } from "./metadata";
import type { SeoConfig } from "./types";

const asset = (url: string): MediaAsset => ({
  id: url,
  url,
  name: url,
  size: 0,
  mime: "image/webp",
  createdAt: "",
});
const base: SeoConfig = {
  siteUrl: "https://example.test",
  siteName: "Code Name",
  entityDescription: "Entity",
  defaultTitle: "Title",
  defaultDescription: "Code description",
  titleTemplate: "%s | Code",
  defaultOgImage: "/code-og.webp",
  organization: { logo: "/code-logo.webp", sameAs: ["https://example.test/x"] },
};

describe("withSiteSettings", () => {
  it("saved values win over code values", () => {
    const out = withSiteSettings(base, {
      brand: { name: " Saved ", logo: asset("/saved-logo.webp") },
      seo: {
        titleTemplate: "%s - Saved",
        description: "Saved description",
        ogImage: asset("/saved-og.webp"),
      },
    });
    expect(out).toMatchObject({
      siteName: "Saved",
      titleTemplate: "%s - Saved",
      defaultDescription: "Saved description",
      defaultOgImage: "/saved-og.webp",
      organization: {
        logo: "/saved-logo.webp",
        sameAs: ["https://example.test/x"],
      },
    });
  });

  it("falls back to code per field when settings are missing or blank", () => {
    expect(withSiteSettings(base, undefined)).toEqual(base);
    expect(withSiteSettings(base, { brand: { name: "  " }, seo: {} })).toEqual(base);
    expect(withSiteSettings(base, { brand: { name: "Only name" }, seo: {} })).toEqual({
      ...base,
      siteName: "Only name",
    });
  });

  it("adds a logo when code has no organization block", () => {
    const { organization: _o, ...bare } = base;
    void _o;
    expect(withSiteSettings(bare, { brand: { name: "", logo: asset("/l.webp") } }).organization).toEqual({
      logo: "/l.webp",
    });
  });

  it("flows through the metadata and JSON-LD builders", () => {
    const out = withSiteSettings(base, {
      brand: { name: "Saved", logo: asset("/l.webp") },
      seo: { description: "D" },
    });
    expect(buildRootMetadata(out).description).toBe("D");
    expect(organizationJsonLd(out)).toMatchObject({
      name: "Saved",
      logo: "/l.webp",
    });
  });
});

describe("resolveSeoConfig", () => {
  it("reads the settings store for the locale", async () => {
    let seen: string | undefined;
    const out = await resolveSeoConfig(
      base,
      {
        get: async (l) => {
          seen = l;
          return { brand: { name: "From store" }, seo: {} };
        },
      },
      "fr"
    );
    expect(seen).toBe("fr");
    expect(out.siteName).toBe("From store");
  });
});
