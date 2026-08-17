import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { JsonLd, organizationJsonLd, websiteJsonLd, breadcrumbJsonLd } from "./json-ld";
import type { SeoConfig } from "./types";

afterEach(cleanup);

const config: SeoConfig = {
  siteUrl: "https://example.com",
  siteName: "Example",
  entityDescription: "Entity description",
  defaultTitle: "t",
  defaultDescription: "d",
};

describe("JsonLd", () => {
  it("renders the given data as a JSON-LD script tag, escaping `<`", () => {
    const { container } = render(<JsonLd data={{ evil: "</script>" }} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain("</script>");
    expect(JSON.parse(script.innerHTML.replaceAll("\\u003c", "<"))).toEqual({ evil: "</script>" });
  });
});

describe("organizationJsonLd", () => {
  it("includes only the required fields when no organization config is given", () => {
    expect(organizationJsonLd(config)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Example",
      url: "https://example.com",
      description: "Entity description",
    });
  });

  it("adds logo/alternateName/parentOrganization/sameAs when given", () => {
    const result = organizationJsonLd({
      ...config,
      organization: {
        logo: "/logo.png",
        alternateName: "Ex",
        parentOrganization: "Parent Co",
        sameAs: ["https://x.com"],
      },
    });
    expect(result).toMatchObject({
      logo: "/logo.png",
      alternateName: "Ex",
      parentOrganization: { "@type": "Organization", name: "Parent Co" },
      sameAs: ["https://x.com"],
    });
  });

  it("omits sameAs entirely when the array is empty", () => {
    const result = organizationJsonLd({ ...config, organization: { sameAs: [] } });
    expect(result).not.toHaveProperty("sameAs");
  });
});

describe("websiteJsonLd", () => {
  it("builds a WebSite entity", () => {
    expect(websiteJsonLd(config)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Example",
      url: "https://example.com",
    });
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers items from 1 and resolves each path against siteUrl", () => {
    const result = breadcrumbJsonLd(config, [
      { name: "Home", path: "" },
      { name: "About", path: "/about" },
    ]);
    expect(result.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com" },
      { "@type": "ListItem", position: 2, name: "About", item: "https://example.com/about" },
    ]);
  });
});
