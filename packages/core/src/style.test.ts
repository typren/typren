import { describe, expect, it } from "vitest";
import { STYLE_MAP_DEFAULT, mappedName, sanitizeStyle, styleCss, styleMapError, styleVars } from "./style";

describe("style tokens", () => {
  it("emits known tokens under their own and their shadcn names by default, in a rule that outranks :root", () => {
    expect(styleCss({ "--typren-primary": " #f74c25 ", "--typren-space": "1rem" })).toBe(
      ":root:root {\n  --typren-primary: #f74c25;\n  --primary: #f74c25;\n  --typren-space: 1rem;\n}\n"
    );
  });

  // Generic fixtures for the two shapes of site: one styled with stock shadcn
  // variables (no config), one whose CSS reads its own names through a map.
  it("a shadcn-only site needs no map", () => {
    expect(styleVars({ "--typren-bg": "#fff", "--typren-font-body": "Inter", "--typren-radius": "6px" })).toEqual({
      "--typren-bg": "#fff",
      "--background": "#fff",
      "--typren-font-body": "Inter",
      "--font-sans": "Inter",
      "--typren-radius": "6px",
      "--radius": "6px",
    });
  });

  it("a site with its own names maps tokens onto them, or onto themselves, and skips bad entries", () => {
    const map = { "--typren-accent": "--surface-raised", "--typren-primary": "--typren-primary", "--typren-bg": "--x; }" };
    expect(styleVars({ "--typren-accent": "#eee", "--typren-primary": "red", "--typren-bg": "#000", "--typren-fg": "#111" }, map)).toEqual({
      "--typren-accent": "#eee",
      "--surface-raised": "#eee",
      "--typren-primary": "red",
      "--typren-bg": "#000",
      "--typren-fg": "#111",
    });
    expect(mappedName("--typren-fg", map)).toBe("--typren-fg");
    expect(mappedName("--typren-fg")).toBe(STYLE_MAP_DEFAULT["--typren-fg"]);
  });

  it("validates a style map", () => {
    expect(styleMapError({ "--typren-primary": "--brand-500" })).toBeNull();
    expect(styleMapError([])).toMatch(/object/);
    expect(styleMapError({ "--other": "--x" })).toMatch(/not a Typren style token/);
    expect(styleMapError({ "--typren-primary": "--Brand" })).toMatch(/custom property/);
    expect(styleMapError({ "--typren-primary": "red; }" })).toMatch(/custom property/);
    expect(Object.isFrozen(STYLE_MAP_DEFAULT)).toBe(true);
  });

  it("drops unknown names, empty values and anything that could escape the declaration", () => {
    const style = {
      "--other": "red",
      "--typren-fg": "",
      "--typren-bg": "red; } body { display: none",
      "--typren-accent": "url(https://x.test/a.png)",
      "--typren-muted": "blue",
    };
    expect(sanitizeStyle(style)).toEqual({ "--typren-muted": "blue" });
  });

  it("drops values that fetch through image-set() or src(), or open a comment", () => {
    for (const value of [
      'image-set("https://x.test/a.png" 1x)',
      '-webkit-image-set("https://x.test/a.png" 1x)',
      'src("https://x.test/a.png")',
      "URL(https://x.test/a.png)",
      "red /* rest of the sheet",
    ]) {
      expect(sanitizeStyle({ "--typren-bg": value }), value).toEqual({});
    }
    expect(sanitizeStyle({ "--typren-bg": "oklch(0.98 0 0)", "--typren-font-heading": "Inter, sans-serif" })).toEqual({
      "--typren-bg": "oklch(0.98 0 0)",
      "--typren-font-heading": "Inter, sans-serif",
    });
  });

  it("knows the type scale tokens", () => {
    expect(sanitizeStyle({ "--typren-line-height": "1.6", "--typren-type-scale": "1.25" })).toEqual({
      "--typren-line-height": "1.6",
      "--typren-type-scale": "1.25",
    });
  });

  it("is empty for no style", () => {
    expect(styleCss(undefined)).toBe("");
    expect(styleCss({})).toBe("");
  });
});
