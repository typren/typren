#!/usr/bin/env node
/**
 * Post-build fixups for `dist`.
 *
 * `moduleResolution: "bundler"` lets SOURCE keep extensionless relative imports.
 * This is required so bundlers that consume `src` directly (Turbopack, vite) resolve
 * them, and so a workspace/source consumer isn't broken. But raw Node ESM needs
 * real extensions, and the published `bin` (`dist/cli.js`) runs under raw Node.
 *
 * So: extensionless in source, extensions added here in dist only (currently a
 * no-op: `cli.ts` only imports bare package specifiers like `@typren/core`,
 * which Node resolves via `node_modules` either way. It's kept generic so it still
 * does the right thing if this package ever grows local relative imports).
 * Then smoke it: the bin must actually load under `node`.
 */
import { readdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
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
    if (path.extname(spec)) return match; // already .js / .json / .css
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

chmodSync(path.join(DIST, "cli.js"), 0o755);

// Smoke: raw Node ESM must load the bin.
execFileSync(process.execPath, [path.join(DIST, "cli.js"), "--help"], { stdio: "ignore" });

console.log(`postbuild: ${rewrites} dist import specifiers extended, cli loads under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
