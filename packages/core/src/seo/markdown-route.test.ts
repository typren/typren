import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  createMarkdownMirrorMiddleware,
  createMarkdownRouteHandler,
  matchMarkdownMirrorSlug,
} from "./markdown-route";
import { fakeStore } from "./test-fixtures";

describe("matchMarkdownMirrorSlug", () => {
  it("extracts the slug from a single-segment .md path", () => {
    expect(matchMarkdownMirrorSlug("/about.md")).toBe("about");
  });

  it("returns null for a non-.md path or a multi-segment path", () => {
    expect(matchMarkdownMirrorSlug("/about")).toBeNull();
    expect(matchMarkdownMirrorSlug("/a/b.md")).toBeNull();
  });
});

describe("createMarkdownRouteHandler", () => {
  const store = fakeStore([
    { slug: "about", meta: { title: "About" }, slices: [{ slice: "hero", heading: "Hi" }] },
  ]);
  const { GET } = createMarkdownRouteHandler(store);

  it("renders a known slug as flattened markdown", async () => {
    const req = new NextRequest("https://example.com/md/about");
    const res = await GET(req, { params: Promise.resolve({ slug: "about" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# About\n\nHi\n");
  });

  it("404s an unknown slug", async () => {
    const req = new NextRequest("https://example.com/md/nope");
    const res = await GET(req, { params: Promise.resolve({ slug: "nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("createMarkdownMirrorMiddleware", () => {
  const middleware = createMarkdownMirrorMiddleware("/md");

  it("rewrites a matching .md request to the mirror path", () => {
    const request = new NextRequest("https://example.com/about.md");
    const response = middleware(request);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://example.com/md/about");
  });

  it("passes through a non-.md request", () => {
    const request = new NextRequest("https://example.com/about");
    const response = middleware(request);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
