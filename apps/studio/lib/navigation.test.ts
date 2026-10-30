import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageInfo } from "@typren/core";
import { navigatePage, pageAt } from "./navigation";

const pages = [{ slug: "home" }, { slug: "about" }, { slug: "docs/intro" }] as PageInfo[];

afterEach(() => vi.restoreAllMocks());

describe("pageAt", () => {
  it("maps page URLs to listed slugs and everything else to home", () => {
    expect(pageAt("/pages/about", pages)).toBe("about");
    expect(pageAt("/pages/docs%2Fintro", pages)).toBe("docs/intro");
    expect(pageAt("/", pages)).toBe("home");
    expect(pageAt("/assets/icons", pages)).toBe("home");
    expect(pageAt("/pages/gone", pages)).toBeNull();
    expect(pageAt("/", [])).toBeNull();
  });

  it("previews the configured home slug", () => {
    expect(pageAt("/", [{ slug: "index" }] as PageInfo[], "index")).toBe("index");
  });
});

describe("navigatePage", () => {
  it("moves between listed pages through history alone, so the studio stays mounted", () => {
    const router = { push: vi.fn() };
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    navigatePage("about", pages, router);
    expect(push).toHaveBeenCalledWith(null, "", "/pages/about");
    navigatePage("home", pages, router, true);
    expect(replace).toHaveBeenCalledWith(null, "", "/pages/home");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks the server for a page it has not listed yet, or for none", () => {
    const router = { push: vi.fn() };
    const push = vi.spyOn(window.history, "pushState");
    navigatePage("new-page", pages, router);
    navigatePage(null, pages, router);
    expect(router.push.mock.calls).toEqual([["/pages/new-page"], ["/"]]);
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a page in edit mode when asked", () => {
    const router = { push: vi.fn() };
    const push = vi.spyOn(window.history, "pushState");
    navigatePage("fresh", pages, router, false, true);
    navigatePage("about", pages, router, false, true);
    navigatePage(null, pages, router, false, true);
    expect(router.push.mock.calls).toEqual([["/pages/fresh?edit"], ["/"]]);
    expect(push).toHaveBeenCalledWith(null, "", "/pages/about?edit");
  });
});
