#!/usr/bin/env node
/**
 * Post-build smoke for `dist`; tsdown already writes `.js` on relative
 * specifiers, so raw Node ESM must load every published entry point.
 */
import { execFileSync } from "node:child_process";

const DIST = "dist";

for (const entry of ["index.js", "build/index.js", "ota/index.js", "vue/index.js"]) {
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/${entry}");`], {
    stdio: "inherit",
  });
}

console.log("postbuild: all 4 entry points load under node");
