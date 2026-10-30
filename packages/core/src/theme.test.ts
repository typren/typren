import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "theme.css"), "utf8");
const block = (selector: string) => css.slice(css.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"))).split("\n}")[0]!;
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** `rgb(r g b / a)` token composited over an opaque surface. */
function over(token: string, rule: string, surface: number[]) {
  const m = new RegExp(`${token}: rgb\\((\\d+) (\\d+) (\\d+) / ([\\d.]+)\\)`).exec(rule)!;
  const a = Number(m[4]);
  return [1, 2, 3].map((i) => Number(m[i]) * a + surface[i - 1]! * (1 - a));
}

describe("theme contrast (WCAG 1.4.11)", () => {
  // Frame, layer over frame, card: the surfaces a control sits on.
  const light = [[243, 243, 243], [250, 250, 250], [250, 250, 250]];
  const dark = [[32, 32, 32], [46, 46, 46], [44, 44, 44]];

  it.each([
    ["light", ":root", light],
    ["dark", ".dark", dark],
  ] as const)("keeps the %s text field edge at 3:1 against every surface", (_, selector, surfaces) => {
    const rule = block(selector);
    for (const surface of surfaces) {
      expect(ratio(over("--typren-stroke-control-edge", rule, [...surface]), [...surface])).toBeGreaterThanOrEqual(3);
    }
  });
});
