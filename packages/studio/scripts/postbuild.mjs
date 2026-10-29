#!/usr/bin/env node
/**
 * Post-build fixups for `dist`. Same extension-rewrite as `@typren/core`'s
 * and `typren`'s postbuild scripts (see those for the full rationale):
 * `moduleResolution: "bundler"` lets SOURCE keep extensionless relative
 * imports (so Turbopack/vite consuming `src` directly still resolve them),
 * but published ESM needs real extensions for raw Node / strict resolvers.
 *
 * Only `index.js` gets smoke-loaded under raw Node: `element.js` extends
 * `HTMLElement` at class-definition time, which throws under bare Node (no
 * DOM). Its consumers are always a browser or a DOM-shimmed test environment.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";

/** `from "./x"`, `import("./x")`, `import "./x"`, `export … from "../x"`. */
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']*)\2/g;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

let rewrites = 0;
const skipped = [];
for (const file of walk(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"))) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(RELATIVE_SPECIFIER, (match, lead, quote, spec) => {
    if (path.extname(spec)) return match; // already .js / .json
    const target = path.resolve(path.dirname(file), spec);
    // `.js` in a .d.ts is correct too: TS maps ./x.js back to ./x.d.ts.
    const suffix = existsSync(`${target}.js`) ? ".js" : existsSync(path.join(target, "index.js")) ? "/index.js" : null;
    if (!suffix) {
      skipped.push(`${file} → ${spec}`);
      return match;
    }
    rewrites++;
    return `${lead}${quote}${spec}${suffix}${quote}`;
  });
  if (after !== before) writeFileSync(file, after);
}

// Smoke: raw Node ESM must load the main entry.
execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/index.js");`], {
  stdio: "inherit",
});

console.log(`postbuild: ${rewrites} dist import specifiers extended, index.js loads under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
