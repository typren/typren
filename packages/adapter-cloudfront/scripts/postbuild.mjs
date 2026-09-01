#!/usr/bin/env node
/**
 * Post-build fixups for `dist`, same approach as packages/core and
 * packages/cli's own postbuild.mjs (see those for the full rationale):
 * extensionless relative imports in TS source need real extensions for raw
 * Node ESM, added here rather than in source (source stays bundler-friendly).
 */
import { readdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, existsSync } from "node:fs";
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

// The canonical viewer-request function is a raw CloudFront-runtime asset,
// not compiled TS — copy it beside dist/function-source.js so
// readFunctionSource()'s `new URL("./redirects.function.js", import.meta.url)`
// resolves the same way in dist as it does against src.
copyFileSync("src/redirects.function.js", path.join(DIST, "redirects.function.js"));

chmodSync(path.join(DIST, "cli.js"), 0o755);

// Smoke: raw Node ESM must load the bin and the library entry.
execFileSync(process.execPath, [path.join(DIST, "cli.js"), "--help"], { stdio: "ignore" });
execFileSync(process.execPath, ["--input-type=module", "-e", `await import("./${DIST}/index.js");`], { stdio: "inherit" });

console.log(`postbuild: ${rewrites} dist import specifiers extended, cli + index load under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
