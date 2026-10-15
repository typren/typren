import { describe, expect, it } from "vitest";
import { parseMatter } from "./safe-matter";

describe("parseMatter", () => {
  it("parses ordinary YAML front matter with gray-matter's semantics", () => {
    const { data, content } = parseMatter("---\ntitle: Hi\nd: 2024-01-02\nb: yes\n---\nbody\n");
    expect(data).toEqual({ title: "Hi", d: new Date("2024-01-02T00:00:00Z"), b: "yes" });
    expect(content).toBe("body\n");
  });

  it("refuses YAML aliases, so a billion-laughs block fails fast instead of expanding", () => {
    const levels = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i < 10; i++) {
      const prev = String.fromCharCode(96 + i);
      const cur = String.fromCharCode(97 + i);
      levels.push(`${cur}: &${cur} [${Array(9).fill(`*${prev}`).join(", ")}]`);
    }
    const started = performance.now();
    expect(() => parseMatter(`---\n${levels.join("\n")}\n---\n`)).toThrow();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("refuses front matter over 256 KB", () => {
    expect(() => parseMatter(`---\nt: "${"x".repeat(256 * 1024)}"\n---\n`)).toThrow(/front matter exceeds 256 KB/);
  });

  it("refuses javascript front matter", () => {
    expect(() => parseMatter("---javascript\n{ x: 1 }\n---\n")).toThrow(/not supported/);
  });
});
