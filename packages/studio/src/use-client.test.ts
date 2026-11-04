/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Server components import these barrels; without the directive on the first
// line, Next fails the RSC build on the hook-using primitives behind them.
describe("client barrels", () => {
  it.each(["ui.ts", "index.ts"])("%s starts with the use-client directive", (file) => {
    const first = readFileSync(join(import.meta.dirname, file), "utf8").split("\n")[0];
    expect(first).toBe('"use client";');
  });
});
