#!/usr/bin/env node
/**
 * Post-build smoke for `dist`; tsdown already writes `.js` on relative
 * specifiers, so raw Node ESM must load every published entry point.
 */
import { execFileSync } from "node:child_process";

const DIST = "dist";

for (const entry of ["index.js", "sinks/index.js", "server/index.js", "client/index.js"]) {
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/${entry}");`], {
    stdio: "inherit",
  });
}

console.log("postbuild: all entries load under node");
