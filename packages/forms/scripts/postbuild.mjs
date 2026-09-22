#!/usr/bin/env node
/**
 * Post-build fixups for `dist`, same approach as packages/core and
 * packages/adapter-cloudfront's own postbuild.mjs (see those for the full
 * rationale): extensionless relative imports in TS source need real
 * extensions for raw Node ESM, added here rather than in source (source
 * stays bundler-friendly).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";

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
    if (path.extname(spec)) return match; // already .js/.json
    const target = path.resolve(path.dirname(file), spec);
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

// Smoke: raw Node ESM must load every published entry point.
for (const entry of ["index.js", "sinks/index.js", "server/index.js", "client/index.js"]) {
  execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/${entry}");`], {
    stdio: "inherit",
  });
}

console.log(`postbuild: ${rewrites} dist import specifiers extended, all entries load under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
