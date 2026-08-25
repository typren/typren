#!/usr/bin/env node
/**
 * Public .d.ts surface snapshot for @typren/core and typren (the CLI).
 *
 * Why a concatenation script over api-extractor: api-extractor's rollup does
 * the same job (bundle a package's exported type graph into one file to diff
 * across releases) but needs a `.api-extractor.json` per entry point, a
 * doc-comment release-tag convention (@public/@internal) this codebase
 * doesn't use, and a new dependency. This script does the one thing item 2
 * needs — detect when the public type surface moves — in ~80 lines with
 * tools already in devDependencies. Upgrade to api-extractor if the surface
 * ever needs API Review reports or per-symbol release tagging; a diff gate
 * doesn't.
 *
 * Method: for each package, start from the dist/*.d.ts files its own
 * package.json "exports" map actually publishes (a bin-only package with no
 * "exports" field, like the CLI, publishes its whole dist instead), follow
 * every relative import/export specifier those files contain, and
 * concatenate every reachable .d.ts. That naturally includes a file like
 * actions.d.ts (not itself in "exports") because index.d.ts re-exports it,
 * and naturally excludes a file nothing exported ever imports.
 *
 * Run after `bun run build`. `bun run api-surface:generate` writes the
 * snapshot to etc/api-surface/; CI reruns it and diffs against the checked-in
 * copy — any difference means the public type surface changed and needs a
 * changeset.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "etc", "api-surface");
const PACKAGES = [
  { name: "core", dir: "packages/core" },
  { name: "cli", dir: "packages/cli" },
];

// Same shape as packages/core/scripts/postbuild.mjs's RELATIVE_SPECIFIER:
// `from "./x"`, `import("./x")`, `import "./x"`, `export … from "../x"`.
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']*)\1/g;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

/** dist/*.d.ts files a package's package.json actually publishes. Always
 *  absolute: resolveSpecifier() below also resolves to absolute paths, and
 *  the two must use the same key shape or the same file (e.g. api/client.d.ts,
 *  both a direct entry point AND re-exported by api/index.d.ts) dedupes as
 *  two different strings and gets concatenated twice. */
function entryPoints(pkgDir, pkgJson) {
  const dist = path.resolve(pkgDir, "dist");
  if (!pkgJson.exports) return walk(dist).filter((f) => f.endsWith(".d.ts"));

  const files = new Set();
  for (const value of Object.values(pkgJson.exports)) {
    const types = typeof value === "string" ? null : value.types;
    if (!types || !types.endsWith(".d.ts")) continue; // e.g. "./theme.css"
    if (types.includes("*")) {
      const dir = path.resolve(pkgDir, path.dirname(types));
      const suffix = path.basename(types).replace("*", "");
      for (const f of readdirSync(dir)) if (f.endsWith(suffix)) files.add(path.join(dir, f));
    } else {
      files.add(path.resolve(pkgDir, types));
    }
  }
  return [...files];
}

/** Resolve a relative specifier from a .d.ts file back to its sibling .d.ts.
 *  postbuild.mjs already rewrote in-dist specifiers to end in ".js"/"index.js"
 *  (real Node ESM needs extensions); TS maps those straight back to .d.ts. */
function resolveSpecifier(fromFile, spec) {
  const target = path.resolve(path.dirname(fromFile), spec);
  if (target.endsWith(".js") && existsSync(target.replace(/\.js$/, ".d.ts"))) return target.replace(/\.js$/, ".d.ts");
  if (existsSync(target)) return target; // already had a .d.ts extension
  return null; // external package (react, next/server, …) — nothing to follow
}

function collectSurface(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(RELATIVE_SPECIFIER)) {
      const resolved = resolveSpecifier(file, m[2]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

const normalize = (file) => readFileSync(file, "utf8").replace(/[ \t]+$/gm, "").trim() + "\n";

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, dir } of PACKAGES) {
  const pkgJson = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const files = collectSurface(entryPoints(dir, pkgJson));
  const snapshot = files.map((f) => `// ---- ${path.relative(dir, f)} ----\n${normalize(f)}`).join("\n");
  writeFileSync(path.join(OUT_DIR, `${name}.d.ts`), snapshot);
  console.log(`api-surface: ${name} — ${files.length} file(s)`);
}
