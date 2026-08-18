import { describe, expect, it } from "vitest";
// Vite's `?raw` gives us the file's own source text resolved RELATIVE TO THIS
// FILE. Deliberately not `process.cwd()` + a path: vitest runs from the repo
// root, so a cwd-relative path silently breaks the moment the package moves
// (which is exactly what the move into this monorepo did to it).
// @ts-expect-error: `?raw` is a Vite import suffix, not a declared module.
import source from "./client.ts?raw";

/** The "@typren/core/api/client" subpath exists so browser bundles can reach
 *  `createTyprenClient` without the server graph the "@typren/core/api" barrel
 *  pulls in (routes -> store/collection -> node:fs). That only holds while
 *  client.ts imports nothing at runtime. A single value import from a sibling
 *  would silently re-introduce `node:fs` and send the next consumer back to
 *  hand-rolling its own fetch shim. */
describe("typren/api/client is browser-safe", () => {
  /** `import …` / `export … from "x"` at the start of a line. */
  const IMPORTS = /^(import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm;

  it("has no runtime imports", () => {
    expect([...source.matchAll(IMPORTS)].map((m) => m[2])).toEqual([]);
  });

  it("has no bare side-effect or dynamic imports", () => {
    expect(source).not.toMatch(/^import\s*["']/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
