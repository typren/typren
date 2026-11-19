#!/usr/bin/env node
/**
 * Post-build smoke for `dist`; tsdown already writes `.js` on relative
 * specifiers, so raw Node ESM must load every published entry point. This
 * adapter must also load unbundled in a Worker runtime, which is why the
 * output stays one file per source file.
 */
import { execFileSync } from "node:child_process";

const DIST = "dist";

for (const entry of ["index.js"]) {
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/${entry}");`], {
    stdio: "inherit",
  });
}

console.log("postbuild: all entries load under node");
