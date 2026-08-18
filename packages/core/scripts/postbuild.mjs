#!/usr/bin/env node
/**
 * Post-build fixups for `dist`.
 *
 * `moduleResolution: "bundler"` lets SOURCE keep extensionless relative imports.
 * This is required so bundlers that consume `src` directly (Turbopack, vite) resolve
 * them, and so a workspace/source consumer isn't broken. But raw Node ESM needs
 * real extensions, and the `typren` CLI package's `dist/cli.js` (a separate package) runs
 * under raw Node and imports this package by its published specifiers, not by
 * reaching into dist directly, so this package's own server-safe entries must
 * load standalone.
 *
 * So: extensionless in source, extensions added here in dist only. Then smoke
 * it: every server-safe entry must actually load under `node`.
 */
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
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
    // Doesn't resolve inside dist → it isn't a dist import. `templates/init.js`
    // embeds the scaffolded app's own source as strings; those specifiers belong
    // to the HOST app (bundler-resolved) and must be left alone. Real breakage
    // still surfaces: the smoke below loads the graph under raw Node.
    if (!suffix) {
      skipped.push(`${file} → ${spec}`);
      return match;
    }
    rewrites++;
    return `${lead}${quote}${spec}${suffix}${quote}`;
  });
  if (after !== before) writeFileSync(file, after);
}

copyFileSync("src/theme.css", path.join(DIST, "theme.css"));

// Smoke: raw Node ESM must load every server-safe entry. Excluded on purpose:
// `seo` imports `next/server`, which next@16 leaves out of its exports map,
// so that entry is Next-runtime-only and can't load under bare node by
// construction.
const SERVER_ENTRIES = ["index.js", "proxy.js", "i18n.js", "auth/local.js"];
execFileSync(
  process.execPath,
  ["--input-type=module", "-e", SERVER_ENTRIES.map((e) => `await import("./${DIST}/${e}");`).join("\n")],
  { stdio: "inherit" },
);

console.log(`postbuild: ${rewrites} dist import specifiers extended, ${SERVER_ENTRIES.length} entries load under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
