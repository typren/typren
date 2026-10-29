/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const NATIVE_SCROLL = /overflow-(?:[xy]-)?(?:auto|scroll)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  );
}

describe("one scrollbar", () => {
  it("scrolls through ScrollArea only, never a native overflow class", () => {
    const offenders = sources(SRC)
      .filter((f) => !f.endsWith(join("primitives", "scroll-area.tsx")))
      .filter((f) => NATIVE_SCROLL.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
