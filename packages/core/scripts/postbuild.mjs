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
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = "dist";
const MIGRATIONS_SRC = path.join("..", "..", "docs", "migrations");
const MIGRATIONS_OUT = "migrations";
const MIGRATIONS_KEEP = 5;

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

// `typren migrate` (the CLI) reads notes from the INSTALLED @typren/core,
// not from this repo's docs/, so each release packs the notes relevant to
// it into the published package here. Keep only the newest few: old notes
// for versions nobody's still upgrading from just bloat the tarball.
// Prerelease versions aren't handled (no project here cuts one yet).
function packMigrationNotes() {
  rmSync(MIGRATIONS_OUT, { recursive: true, force: true });
  if (!existsSync(MIGRATIONS_SRC)) return 0;
  const parsed = readdirSync(MIGRATIONS_SRC)
    .filter((f) => f.startsWith("core-") && f.endsWith(".md"))
    .map((file) => {
      const m = file.match(/^core-(\d+)\.(\d+)\.(\d+)\.md$/);
      return m ? { file, version: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2])
    .slice(0, MIGRATIONS_KEEP);
  if (parsed.length === 0) return 0;
  mkdirSync(MIGRATIONS_OUT, { recursive: true });
  for (const { file } of parsed) copyFileSync(path.join(MIGRATIONS_SRC, file), path.join(MIGRATIONS_OUT, file));
  return parsed.length;
}
const migrationsPacked = packMigrationNotes();

// Smoke: raw Node ESM must load every server-safe entry, including `seo`
// (it imports `next/server.js`; next ships no exports map, so the subpath
// resolves as a file path and Node ESM needs the extension; see changeset).
const SERVER_ENTRIES = ["index.js", "proxy.js", "i18n.js", "auth/local.js", "seo/index.js", "static-host.js"];
execFileSync(
  process.execPath,
  ["--input-type=module", "-e", SERVER_ENTRIES.map((e) => `await import("./${DIST}/${e}");`).join("\n")],
  { stdio: "inherit" },
);

console.log(`postbuild: ${rewrites} dist import specifiers extended, ${SERVER_ENTRIES.length} entries load under node`);
if (skipped.length) console.log(`postbuild: left ${skipped.length} non-dist specifier(s) alone:\n  ${skipped.join("\n  ")}`);
console.log(`postbuild: ${migrationsPacked} migration note(s) packed into ${MIGRATIONS_OUT}/`);
