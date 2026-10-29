import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { resolveStyleCss, TyprenStyle } from "./typren-style";

const store = (style?: Record<string, string>) => ({ get: vi.fn(async () => ({ brand: { name: "" }, seo: {}, style })) });

afterEach(cleanup);

describe("resolveStyleCss", () => {
  it("emits the saved tokens under their own and mapped names, sanitised", async () => {
    const s = store({ "--typren-primary": "#123456", "--typren-bg": "red; } body { x: y", "--not-a-token": "#fff" });
    const css = await resolveStyleCss(s, { "--typren-primary": "--brand" }, "fr");
    expect(css).toBe(":root:root {\n  --typren-primary: #123456;\n  --brand: #123456;\n}\n");
    expect(s.get).toHaveBeenCalledWith("fr");
  });

  it("falls back to the shadcn names without a map, and is empty with nothing saved", async () => {
    expect(await resolveStyleCss(store({ "--typren-primary": "#123456" }))).toContain("--primary: #123456;");
    expect(await resolveStyleCss(store())).toBe("");
  });
});

describe("TyprenStyle", () => {
  it("renders the rule as a hoisted <style>, or nothing", async () => {
    render(await TyprenStyle({ store: store({ "--typren-radius": "4px" }), map: {} }));
    const el = document.head.querySelector('style[data-precedence="typren"]');
    expect(el?.textContent).toBe(":root:root {\n  --typren-radius: 4px;\n}\n");
    expect(await TyprenStyle({ store: store() })).toBeNull();
  });
});
