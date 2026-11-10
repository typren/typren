#!/usr/bin/env node
/**
 * Post-build smoke for `dist`; tsdown already writes `.js` on relative
 * specifiers.
 *
 * Only `index.js` gets smoke-loaded under raw Node: `element.js` extends
 * `HTMLElement` at class-definition time, which throws under bare Node (no
 * DOM). Its consumers are always a browser or a DOM-shimmed test environment.
 */
import { execFileSync } from "node:child_process";

const DIST = "dist";

execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/index.js");`], {
  stdio: "inherit",
});

console.log("postbuild: index.js loads under node");
