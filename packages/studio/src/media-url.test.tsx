import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaOriginProvider, resolveMediaUrl, siteOrigin, useMediaUrl } from "./media-url";

const o = "http://localhost:3000";

describe("resolveMediaUrl", () => {
  it("prefixes root-relative urls", () => {
    expect(resolveMediaUrl("/img/a.webp", o)).toBe("http://localhost:3000/img/a.webp");
  });
  it.each(["https://x.test/a.webp", "//cdn.test/a.webp", "data:image/png;base64,AA", "blob:http://a/1"])(
    "leaves %s unchanged",
    (u) => expect(resolveMediaUrl(u, o)).toBe(u),
  );
  it("is a no-op without an origin", () => {
    expect(resolveMediaUrl("/img/a.webp")).toBe("/img/a.webp");
  });
});

describe("siteOrigin", () => {
  it("reads the origin of an absolute previewUrl", () => {
    expect(siteOrigin({ previewUrl: (s) => `${o}/${s}/` })).toBe(o);
  });
  it("is undefined for relative or missing previewUrl", () => {
    expect(siteOrigin({ previewUrl: () => "/p/" })).toBeUndefined();
    expect(siteOrigin({})).toBeUndefined();
  });
});

describe("useMediaUrl", () => {
  function Img() {
    const r = useMediaUrl();
    // eslint-disable-next-line @next/next/no-img-element -- test double
    return <img src={r("/img/a.webp")} alt="a" />;
  }
  it("resolves through the provider", () => {
    render(
      <MediaOriginProvider origin={o}>
        <Img />
      </MediaOriginProvider>,
    );
    expect(screen.getByAltText("a").getAttribute("src")).toBe("http://localhost:3000/img/a.webp");
  });
});
