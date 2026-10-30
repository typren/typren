#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { buildTemplates, TYPREN_BOOTSTRAP_MARKER } from "@typren/core/templates/init";
import { createFsSettingsAdapter, validateBootstrap, type SiteSettingsBootstrap, type Slice } from "@typren/core";
import { firstRunNotice, isEnabled, readCliVersion, record, setEnabled } from "./telemetry";
import { parseMatter } from "./safe-matter";
import { envWithoutGit, migrate, printMigrateReport, parseMigrateArgs } from "./migrate";
import { CONTENT_COMMANDS, readStdin, runContent } from "./content";
import {
  browserCommand,
  buildStudioManifest,
  connectUrl,
  parseStudioArgs,
  previewCommand,
  resolveStudioDir,
  runStudio,
  studioCommand,
  type Foreground,
} from "./studio";
import { serveOnLoopback, studioApi } from "./studio-server";

/** `fs.existsSync` follows symlinks, so a dangling symlink at a scaffold
 *  target reads as "doesn't exist" and `writeFileSync` then creates a file at
 *  wherever the link points, which may be outside the project. `lstatSync`
 *  sees the link itself, so a dangling (or any) symlink counts as "exists"
 *  and is left alone unless `--force`. */
function pathExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** True when the write target itself, or any directory between `cwd` and
 *  it, is a symlink. `init` only ever writes inside the project: a symlinked
 *  parent directory could redirect a write outside it, and `--force`
 *  overwriting a symlinked target file would overwrite whatever that link
 *  points at rather than create a fresh file in the project. Refusing is
 *  simpler than replacing the link (no unlink-then-write race to get right)
 *  and the project author can always remove the symlink themselves. */
function hasSymlinkOnPath(cwd: string, abs: string): boolean {
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) return true;
  } catch {
    // target doesn't exist yet; only its ancestors can be symlinks
  }
  const root = path.resolve(cwd);
  let dir = path.dirname(abs);
  while (dir.startsWith(root) && dir !== path.dirname(dir)) {
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) return true;
    } catch {
      // ancestor doesn't exist yet; mkdirSync will create a plain directory
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return false;
}

export type ScaffoldResult =
  | { ok: true; baseDir: string; created: string[]; skipped: string[]; devScript: DevScriptStatus }
  | { ok: false; error: string };

/**
 * Core of `typren init`: detect the App Router base dir, write every
 * template that doesn't already exist (or all of them, with `force`), and
 * report what happened. No process.exit/console, kept pure so it's directly
 * testable (see cli.test.ts) and reusable if another entry point ever wants it.
 */
export function scaffold(cwd: string, opts: { force?: boolean } = {}): ScaffoldResult {
  const hasSrcApp = fs.existsSync(path.join(cwd, "src", "app"));
  const hasApp = fs.existsSync(path.join(cwd, "app"));
  const baseDir = hasSrcApp ? "src" : hasApp ? "." : null;
  if (!baseDir) {
    return {
      ok: false,
      error:
        "no Next.js App Router project detected (expected a `src/app` or `app` directory in the current directory).\n" +
        "Run `typren init` from the root of a Next.js App Router project.",
    };
  }

  const contentDirLiteral = baseDir === "." ? "content" : `${baseDir}/content`;
  const templates = buildTemplates(contentDirLiteral);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [relPath, content] of Object.entries(templates)) {
    // A "/"-prefixed key (typren.config.json) always lands at
    // the project root, never under baseDir. See buildTemplates' doc comment.
    const abs = relPath.startsWith("/") ? path.join(cwd, relPath.slice(1)) : path.join(cwd, baseDir, relPath);
    const rel = path.relative(cwd, abs);
    // A dangling (or any) symlink at the target counts as "exists" below
    // (see pathExists) and is left alone same as a real file, unless
    // --force: only once a write is actually about to happen is it a
    // symlink problem, whether that's this target or one of its parent
    // directories redirecting the write outside the project.
    if (pathExists(abs) && !opts.force) {
      skipped.push(rel);
      continue;
    }
    if (hasSymlinkOnPath(cwd, abs)) {
      return { ok: false, error: `refusing to write ${rel}: a symlink is on its path (the target itself or a parent directory). Remove it and retry.` };
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  }

  return { ok: true, baseDir, created, skipped, devScript: bindDevScriptToLoopback(cwd) };
}

/** What `scaffold` did to package.json's `dev` script. "custom" means a
 *  script it couldn't safely rewrite (not plain `next dev`, or an explicit
 *  non-loopback `-H`), so the user has to bind it themselves. */
export type DevScriptStatus = "bound" | "already-bound" | "custom" | "no-package-json";

/** The dev server renders drafts while `typren studio` previews it, and
 *  `next dev` listens on all interfaces by default, so the scaffold binds it
 *  to 127.0.0.1, the origin the studio frames by default.
 *  ponytail: a regex over the script string, not a shell parser. Anything
 *  past "add -H to a plain `next dev`" is reported as "custom" instead of
 *  guessed at. */
function bindDevScriptToLoopback(cwd: string): DevScriptStatus {
  const file = path.join(cwd, "package.json");
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return "no-package-json";
  }
  const dev = pkg.scripts?.dev;
  if (dev !== undefined && /(^|\s)(-H|--hostname)[\s=]127\.0\.0\.1(\s|$)/.test(dev)) return "already-bound";
  if (dev !== undefined && !/^next dev(\s|$)/.test(dev)) return "custom";
  if (dev !== undefined && /(^|\s)(-H|--hostname)(\s|=|$)/.test(dev)) return "custom";
  pkg.scripts = { ...pkg.scripts, dev: dev === undefined ? "next dev -H 127.0.0.1" : dev.replace(/^next dev/, "next dev -H 127.0.0.1") };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  return "bound";
}

const CMS_CONFIG_CANDIDATES = ["cms.config.ts", "src/cms.config.ts", "cms.config.js", "src/cms.config.js"];

type CmsConfigStatus = "already-wired" | "needs-manual-update" | "not-found";

export type ApplySettingsResult =
  | { ok: true; bootstrap: SiteSettingsBootstrap; cmsConfig: CmsConfigStatus; notes: string[] }
  | { ok: false; error: string };

/**
 * Core of `typren apply-settings`: validates typren.config.json's bootstrap
 * tier and checks the host's cms.config reads it. Never writes: an existing
 * cms.config is only grepped for the marker comment the template embeds, and
 * a missing wire-up prints exact instructions instead of guessing at an edit.
 */
export function applySettings(cwd: string): ApplySettingsResult {
  const bootstrapFile = path.join(cwd, "typren.config.json");
  const bootstrap = createFsSettingsAdapter({ file: bootstrapFile }).readBootstrap();

  const error = validateBootstrap(bootstrap);
  if (error) return { ok: false, error: `invalid typren.config.json: ${error}` };

  const notes: string[] = [];

  let cmsConfig: CmsConfigStatus;
  const foundCmsConfig = CMS_CONFIG_CANDIDATES.map((f) => path.join(cwd, f)).find(fs.existsSync);
  if (!foundCmsConfig) {
    cmsConfig = "not-found";
    notes.push("no cms.config.ts found. Run `typren init` first.");
  } else if (fs.readFileSync(foundCmsConfig, "utf8").includes(TYPREN_BOOTSTRAP_MARKER)) {
    cmsConfig = "already-wired";
  } else {
    cmsConfig = "needs-manual-update";
    notes.push(
      `${path.relative(cwd, foundCmsConfig)} doesn't read locales/defaultLocale from typren.config.json yet. Add:\n\n` +
        '    import { createFsSettingsAdapter } from "@typren/core";\n' +
        '    const bootstrap = createFsSettingsAdapter({ file: path.join(process.cwd(), "typren.config.json") }).readBootstrap();\n' +
        "    // then pass bootstrap.locales / bootstrap.defaultLocale into createMarkdownAdapter(...)\n"
    );
  }

  notes.push("Restart your dev server (or redeploy in production) for the change to take effect.");
  return { ok: true, bootstrap, cmsConfig, notes };
}

// ---------------------------------------------------------------------------
// `typren review`: deterministic content-review brief (see spec-A). Same
// pure-function-per-command shape as scaffold()/applySettings() above: no
// console/process.exit here, just data in -> data out, so it's directly
// testable and main() stays a thin argv -> function -> formatter wire-up.
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckResult = { id: string; status: CheckStatus; message?: string };

export type ReviewBrief = {
  slug: string;
  file: string;
  baseRef: string;
  diff: {
    raw: string;
    frontmatter: Record<string, { before: unknown; after: unknown }>;
    slices: {
      added: { index: number; slice: string }[];
      removed: { index: number; slice: string }[];
      changed: { index: number; slice: string; fields: string[] }[];
    };
  };
  frontmatter: Record<string, unknown> & { slices: string[] };
  checks: CheckResult[];
  summary: Record<CheckStatus, number>;
};

export type ReviewResult = { ok: true; briefs: ReviewBrief[] } | { ok: false; error: string };

/** Mirrors markdown-adapter.ts's `parse()` (same default `frontmatterKey:
 *  "slices"` convention) but works on a raw string rather than a file on
 *  disk, needed here because "before" content comes from `git show`, not
 *  a path. Not worth instantiating a whole ContentAdapter for a blob string. */
function parsePage(raw: string): { meta: Record<string, unknown>; slices: Slice[]; hasFrontmatter: boolean } {
  const { data } = parseMatter(raw);
  const { slices, ...meta } = data as Record<string, unknown> & { slices?: unknown };
  return { meta, slices: Array.isArray(slices) ? (slices as Slice[]) : [], hasFrontmatter: Object.keys(data).length > 0 };
}

function readTextSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Every path `review`'s checks read from, all repo-relative (what both `fs`
 *  and `git` want here). */
export type ReviewPaths = {
  contentDir: string;
  resourcesDir: string;
  seoFile: string;
  seoRegistryFile: string;
};

/** Auto-detected defaults for a project with no `review` overrides: the same
 *  src/-vs-root convention `scaffold()` uses to pick its base dir (prefer
 *  `src/content` when a `src/` directory exists, else `content`), so a
 *  zero-config `review` lines up with what `init` just scaffolded. */
function detectReviewPaths(cwd: string): ReviewPaths {
  const baseDir = fs.existsSync(path.join(cwd, "src")) ? "src" : ".";
  const under = (rel: string) => (baseDir === "." ? rel : `${baseDir}/${rel}`);
  return {
    contentDir: under("content"),
    resourcesDir: under("content/resources"),
    seoFile: under("app/seo.tsx"),
    seoRegistryFile: under("slices/seo-registry.ts"),
  };
}

/**
 * Resolves the paths `review` reads from: the auto-detected defaults above,
 * with any `review` key in typren.config.json overriding individual fields.
 * None of these files are required to exist, on purpose. A predecessor
 * project's layout, or a scaffold that no longer emits seo.tsx at all, both
 * degrade the same way: the checks that depend on a missing file report
 * "skip" (see runChecks/checkEntityDescription/checkCanonical/
 * checkFaqRegistration), never a hard failure and never a silent pass.
 */
export function resolveReviewPaths(cwd: string): ReviewPaths {
  const defaults = detectReviewPaths(cwd);
  const raw = readTextSafe(path.join(cwd, "typren.config.json"));
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as { review?: Partial<ReviewPaths> };
    return { ...defaults, ...parsed.review };
  } catch {
    return defaults; // malformed typren.config.json: fall back rather than crash `review`.
  }
}

/** Best-effort text probe for `export const NAME = "...";`. Reads the
 *  constant's value without importing the file. Several of the files this
 *  needs to read (src/app/seo.tsx) re-export JSX-bearing modules, and Node's
 *  native TS type-stripping doesn't transform JSX, so importing them would
 *  throw. A regex read of a plain string constant sidesteps that entirely
 *  and never executes host code. */
function extractStringConst(text: string, name: string): string | null {
  const m = text.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** Slice names with a `@typren/core/seo` seoRegistry entry. Scans line by
 *  line with plain string ops rather than a single `^\s*(\w+):\s*(?:async\s*)?\(`
 *  regex `matchAll` over the whole (repo-controlled) file: `indexOf`/`slice`
 *  are guaranteed linear in the file size regardless of content, so this
 *  can't regress into backtracking blowup if the pattern ever grows another
 *  quantifier. Returns null when the file can't be read (check that depends
 *  on it degrades to "skip", not a guess). */
export function getSeoRegistryKeys(cwd: string, paths: ReviewPaths): string[] | null {
  const text = readTextSafe(path.join(cwd, paths.seoRegistryFile));
  if (text === null) return null;
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon);
    if (!/^\w+$/.test(key)) continue;
    let rest = trimmed.slice(colon + 1).trimStart();
    if (rest.startsWith("async")) rest = rest.slice("async".length).trimStart();
    if (rest.startsWith("(")) keys.push(key);
  }
  return keys;
}

function getSiteUrl(cwd: string, paths: ReviewPaths): string | null {
  const text = readTextSafe(path.join(cwd, paths.seoFile));
  return text === null ? null : extractStringConst(text, "SITE_URL");
}

/** Slugs `createMarkdownAdapter`'s default-locale `listSlugs()` would return
 *  (flat `*.md` files carrying a `slices` array, directly under the resolved
 *  content dir), reimplemented against raw files instead of instantiating
 *  the adapter/store because the host's `cms.config.ts` imports
 *  "server-only", which throws unless imported from a React Server
 *  Component build (i.e. never from a plain Node CLI process). Same
 *  reasoning as parsePage() above. */
function listCmsPageSlugs(cwd: string, paths: ReviewPaths): string[] {
  const dir = path.join(cwd, paths.contentDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.replace(/\.md$/, ""))
    .filter((slug) => {
      const raw = readTextSafe(path.join(dir, `${slug}.md`));
      return raw !== null && Array.isArray(parseMatter(raw).data.slices);
    });
}

/** Locates a slug's content file: a routed CMS page (`<contentDir>/<slug>.md`)
 *  or a hosted resource post (`<resourcesDir>/<slug>.md`, no frontmatter, see
 *  src/lib/resources.ts). Returns a repo-relative path (what git wants), or
 *  null if neither exists. */
function findContentFile(cwd: string, slug: string, paths: ReviewPaths): string | null {
  const flat = `${paths.contentDir}/${slug}.md`;
  if (fs.existsSync(path.join(cwd, flat))) return flat;
  const nested = `${paths.resourcesDir}/${slug}.md`;
  if (fs.existsSync(path.join(cwd, nested))) return nested;
  return null;
}

/** `--base`/a brief's ref is attacker-reachable (a PR description, a CI env
 *  var) and gets handed straight to `git` as a positional argument. Without
 *  `--end-of-options`, a ref string starting with "-" (e.g.
 *  `--upload-pack=...`) would be parsed as an option instead of a revision;
 *  `review()` also rejects such refs outright before any git call is made,
 *  this is defense in depth at the actual call sites. */
function gitShow(cwd: string, ref: string, relFile: string): string | null {
  try {
    return execFileSync("git", ["show", "--end-of-options", `${ref}:${relFile}`], { cwd, encoding: "utf8", env: envWithoutGit() });
  } catch {
    return null; // file didn't exist at `ref` (e.g. a new page), treated as empty "before"
  }
}

function gitDiffRaw(cwd: string, base: string, relFile: string): string {
  try {
    return execFileSync("git", ["diff", "--end-of-options", base, "--", relFile], { cwd, encoding: "utf8", env: envWithoutGit() });
  } catch (e) {
    return `(unable to compute diff against "${base}": ${e instanceof Error ? e.message : String(e)})`;
  }
}

function gitChangedContentFiles(
  cwd: string,
  base: string,
  contentDir: string
): { ok: true; files: string[] } | { ok: false; error: string } {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--end-of-options", base, "--", contentDir], {
      cwd,
      encoding: "utf8",
      env: envWithoutGit(),
    });
    return { ok: true, files: out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md")) };
  } catch (e) {
    return {
      ok: false,
      error: `\`git diff --name-only ${base} -- ${contentDir}\` failed: ${
        e instanceof Error ? e.message : String(e)
      } (is "${base}" fetched locally?)`,
    };
  }
}

function diffFrontmatter(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { before: b, after: a };
  }
  return out;
}

function diffSlices(before: Slice[], after: Slice[]): ReviewBrief["diff"]["slices"] {
  const added: { index: number; slice: string }[] = [];
  const removed: { index: number; slice: string }[] = [];
  const changed: { index: number; slice: string; fields: string[] }[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i];
    const a = after[i];
    if (!b && a) added.push({ index: i, slice: a.slice });
    else if (b && !a) removed.push({ index: i, slice: b.slice });
    else if (b && a && b.slice !== a.slice) {
      removed.push({ index: i, slice: b.slice });
      added.push({ index: i, slice: a.slice });
    } else if (b && a) {
      const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
        (k) => k !== "slice" && JSON.stringify(b[k]) !== JSON.stringify(a[k])
      );
      if (fields.length) changed.push({ index: i, slice: a.slice, fields });
    }
  }
  return { added, removed, changed };
}

/** Recursively finds every `{src, alt}`-shaped media prop (the schema every
 *  media-typed field in src/slices/field-schema.ts actually uses, see
 *  hero/big-stat/testimonials/logo-wall/split-feature .tsx) whose `src` is
 *  set but `alt` is missing/empty. Structural, not slice-name-keyed, so a
 *  new slice that follows the same {src, alt} convention is covered for free. */
function findAltViolations(slices: Slice[]): string[] {
  const violations: string[] = [];
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.src === "string" && obj.src.trim() && (typeof obj.alt !== "string" || !obj.alt.trim())) {
        violations.push(at);
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${at}.${k}`);
    }
  };
  slices.forEach((s, i) => walk(s, `slices[${i}](${s.slice})`));
  return violations;
}

/** Best-effort per §3's own admission: slices don't carry a semantic h1/h2
 *  level today, so this can't be a real DOM-heading-order engine. It only
 *  catches a `heading`/`subheading` field that's declared but left empty,
 *  which is cheap, deterministic, and still a real signal. Always `warn`,
 *  never `fail` (matches spec). */
function findEmptyHeadings(slices: Slice[]): string[] {
  const empties: string[] = [];
  slices.forEach((s, i) => {
    for (const key of ["heading", "subheading"]) {
      const v = (s as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim() === "") empties.push(`slices[${i}].${key}`);
    }
  });
  return empties;
}

function checkTitleAndDescription(meta: Record<string, unknown>): CheckResult[] {
  const mk = (field: "title" | "description", min: number, max: number): CheckResult[] => {
    const v = meta[field];
    const present = typeof v === "string" && v.trim().length > 0;
    const presentCheck: CheckResult = present
      ? { id: `seo.${field}.present`, status: "pass" }
      : { id: `seo.${field}.present`, status: "fail", message: `frontmatter.${field} is missing` };
    const len = present ? (v as string).trim().length : 0;
    const lengthCheck: CheckResult = !present
      ? { id: `seo.${field}.length`, status: "skip", message: `skipped: ${field} missing` }
      : field === "title" && len > max
        ? { id: `seo.${field}.length`, status: "warn", message: `title is ${len} chars, recommended <= ${max}` }
        : field === "description" && (len < min || len > max)
          ? { id: `seo.${field}.length`, status: "warn", message: `description is ${len} chars, recommended ${min}-${max}` }
          : { id: `seo.${field}.length`, status: "pass" };
    return [presentCheck, lengthCheck];
  };
  // A host's titleTemplate (e.g. "%s | Acme Inc") adds its own chars on top
  // of a page's own <title>. 60 is the recommended ceiling BEFORE that
  // suffix, per SERP truncation guidance.
  return [...mk("title", 0, 60), ...mk("description", 50, 160)];
}

function checkCanonical(meta: Record<string, unknown>, siteUrl: string | null, seoFile: string): CheckResult {
  const canonical = meta.canonical;
  if (canonical === undefined || canonical === null || canonical === "") {
    return { id: "seo.canonical.consistency", status: "skip", message: "no canonical set" };
  }
  if (typeof canonical !== "string") return { id: "seo.canonical.consistency", status: "fail", message: "canonical is not a string" };
  if (canonical.startsWith("/") || (siteUrl && canonical.startsWith(siteUrl))) {
    return { id: "seo.canonical.consistency", status: "pass" };
  }
  return siteUrl
    ? { id: "seo.canonical.consistency", status: "fail", message: `canonical "${canonical}" is not under SITE_URL (${siteUrl}) or a same-site path` }
    : { id: "seo.canonical.consistency", status: "skip", message: `couldn't read SITE_URL from ${seoFile} to validate against` };
}

function checkNoindex(meta: Record<string, unknown>): CheckResult {
  return meta.noindex === true
    ? { id: "seo.noindex.flagged", status: "warn", message: "meta.noindex is true. Verify this page is intentionally excluded from nav/sitemap" }
    : { id: "seo.noindex.flagged", status: "pass" };
}

function checkSitemapPriority(meta: Record<string, unknown>): CheckResult {
  const sm = meta.sitemap as Record<string, unknown> | undefined;
  if (!sm || sm.priority === undefined) {
    return { id: "seo.sitemap.priority-range", status: "skip", message: "no custom sitemap priority set (uses the package default)" };
  }
  const p = sm.priority;
  return typeof p === "number" && p >= 0 && p <= 1
    ? { id: "seo.sitemap.priority-range", status: "pass" }
    : { id: "seo.sitemap.priority-range", status: "fail", message: `sitemap.priority (${JSON.stringify(p)}) must be a number between 0 and 1` };
}

function checkEntityDescription(cwd: string, paths: ReviewPaths): CheckResult {
  const text = readTextSafe(path.join(cwd, paths.seoFile));
  if (text === null) return { id: "aio.entity.description-present", status: "skip", message: `${paths.seoFile} not found` };
  const val = extractStringConst(text, "SITE_ENTITY_DESCRIPTION");
  return val && val.trim().length > 0
    ? { id: "aio.entity.description-present", status: "pass" }
    : { id: "aio.entity.description-present", status: "fail", message: `SITE_ENTITY_DESCRIPTION is missing or empty in ${paths.seoFile}` };
}

function checkFaqRegistration(slices: Slice[], registeredKeys: string[] | null, seoRegistryFile: string): CheckResult {
  if (registeredKeys === null) {
    return { id: "aio.jsonld.slice-registered", status: "skip", message: `couldn't read ${seoRegistryFile}` };
  }
  const isFaqShaped = (s: Slice) => {
    const items = (s as Record<string, unknown>).items;
    return Array.isArray(items) && items.length > 0 && items.every((it) => it && typeof it === "object" && "question" in it && "answer" in it);
  };
  const unregistered = slices.filter((s) => isFaqShaped(s) && !registeredKeys.includes(s.slice));
  return unregistered.length
    ? {
        id: "aio.jsonld.slice-registered",
        status: "warn",
        message: `slice(s) ${unregistered.map((s) => s.slice).join(", ")} look FAQ-shaped (question/answer items) but aren't registered in seoRegistry`,
      }
    : { id: "aio.jsonld.slice-registered", status: "pass" };
}

function checkAlt(slices: Slice[]): CheckResult {
  const violations = findAltViolations(slices);
  return violations.length
    ? { id: "a11y.alt.present", status: "fail", message: `missing/empty alt on: ${violations.join(", ")}` }
    : { id: "a11y.alt.present", status: "pass" };
}

function checkHeadingsOrder(slices: Slice[]): CheckResult {
  const empties = findEmptyHeadings(slices);
  return empties.length
    ? { id: "seo.headings.order", status: "warn", message: `empty heading field(s): ${empties.join(", ")}` }
    : { id: "seo.headings.order", status: "pass" };
}

function checkLlmsReachable(slug: string, cmsSlugs: string[]): CheckResult {
  return cmsSlugs.includes(slug)
    ? { id: "aio.llms.reachable", status: "pass", message: "in cmsStore, covered by generateLlmsFullTxt automatically" }
    : {
        id: "aio.llms.reachable",
        status: "warn",
        message: `"${slug}" isn't in cmsStore (e.g. a resources/*.md post), so it's not included in llms-full.txt or public/llms.txt`,
      };
}

function checkRobotsCrawlable(meta: Record<string, unknown>): CheckResult {
  // typren/seo's buildRobots doesn't special-case noindex pages: they stay
  // crawlable by default (only <meta name="robots"> keeps them out of the
  // index), which is the expected/normal state per spec-A §3, not a finding.
  return meta.noindex === true
    ? { id: "seo.robots.crawlable", status: "pass", message: "noindex page remains crawlable per robots.ts defaults, as expected" }
    : { id: "seo.robots.crawlable", status: "pass" };
}

function runChecks(
  cwd: string,
  slug: string,
  meta: Record<string, unknown>,
  slices: Slice[],
  hasFrontmatter: boolean,
  cmsSlugs: string[],
  paths: ReviewPaths
): CheckResult[] {
  // aio.entity.description-present and aio.llms.reachable are repo/registry-
  // wide invariants, not per-file, and are still meaningful even for a page with no
  // frontmatter of its own (e.g. a resources/*.md post body).
  if (!hasFrontmatter) {
    const skip = (id: string, message: string): CheckResult => ({ id, status: "skip", message });
    const reason = "no frontmatter block found, meaning this isn't a CMS page (e.g. a resources/*.md post body)";
    return [
      skip("seo.description.present", reason),
      skip("seo.description.length", reason),
      skip("seo.title.present", reason),
      skip("seo.title.length", reason),
      skip("seo.canonical.consistency", reason),
      skip("seo.noindex.flagged", reason),
      skip("seo.sitemap.priority-range", reason),
      checkEntityDescription(cwd, paths),
      skip("aio.jsonld.slice-registered", reason),
      skip("a11y.alt.present", reason),
      skip("seo.headings.order", reason),
      checkLlmsReachable(slug, cmsSlugs),
      skip("seo.robots.crawlable", reason),
    ];
  }

  const siteUrl = getSiteUrl(cwd, paths);
  const registeredKeys = getSeoRegistryKeys(cwd, paths);
  return [
    ...checkTitleAndDescription(meta),
    checkCanonical(meta, siteUrl, paths.seoFile),
    checkNoindex(meta),
    checkSitemapPriority(meta),
    checkEntityDescription(cwd, paths),
    checkFaqRegistration(slices, registeredKeys, paths.seoRegistryFile),
    checkAlt(slices),
    checkHeadingsOrder(slices),
    checkLlmsReachable(slug, cmsSlugs),
    checkRobotsCrawlable(meta),
  ];
}

function buildBrief(cwd: string, relFile: string, base: string, paths: ReviewPaths): ReviewBrief {
  const slug = path.basename(relFile, ".md");
  const rawAfter = readTextSafe(path.join(cwd, relFile)) ?? "";
  const rawBefore = gitShow(cwd, base, relFile) ?? "";
  const after = parsePage(rawAfter);
  const before = parsePage(rawBefore);

  const cmsSlugs = listCmsPageSlugs(cwd, paths);
  const checks = runChecks(cwd, slug, after.meta, after.slices, after.hasFrontmatter, cmsSlugs, paths);
  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;

  return {
    slug,
    file: relFile,
    baseRef: base,
    diff: {
      raw: gitDiffRaw(cwd, base, relFile),
      frontmatter: diffFrontmatter(before.meta, after.meta),
      slices: diffSlices(before.slices, after.slices),
    },
    frontmatter: { ...after.meta, slices: after.slices.map((s) => s.slice) },
    checks,
    summary,
  };
}

/**
 * Core of `typren review [slug] [--base <ref>]`. No slug: one brief per
 * content file changed against `base` (default `origin/main`, working-tree
 * included: a plain `git diff <base> -- <path>`, not a merge-base
 * triple-dot, so uncommitted local edits show up too). A slug: one brief for
 * that page's current file vs. its `base` version, found whether it's a
 * routed CMS page or a hosted resources/*.md post.
 *
 * Paths (content dir, resources dir, SEO files) come from
 * resolveReviewPaths: auto-detected, or overridden by typren.config.json's
 * "review" key. Resolved once per call so every brief in a multi-file run
 * uses the same paths.
 */
export function review(cwd: string, opts: { slug?: string; base?: string } = {}): ReviewResult {
  const base = opts.base ?? "origin/main";
  // `base` is a positional argument to every `git` call below (gitShow,
  // gitDiffRaw, gitChangedContentFiles, and later the branch checkout in
  // openOrUpdateContentPr). A ref starting with "-" would otherwise be
  // parseable as a git option rather than a revision; reject it here, the
  // one place every caller (CLI and library) funnels through, rather than
  // relying solely on each call site's `--end-of-options`.
  if (base.startsWith("-")) {
    return { ok: false, error: `"${base}" is not a valid --base ref (refs starting with "-" are rejected)` };
  }
  const paths = resolveReviewPaths(cwd);
  if (opts.slug) {
    const relFile = findContentFile(cwd, opts.slug, paths);
    if (!relFile) {
      return {
        ok: false,
        error: `no content file found for slug "${opts.slug}" (looked in ${paths.contentDir}/${opts.slug}.md and ${paths.resourcesDir}/${opts.slug}.md)`,
      };
    }
    return { ok: true, briefs: [buildBrief(cwd, relFile, base, paths)] };
  }
  const changed = gitChangedContentFiles(cwd, base, paths.contentDir);
  if (!changed.ok) return { ok: false, error: changed.error };
  return { ok: true, briefs: changed.files.map((f) => buildBrief(cwd, f, base, paths)) };
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type PrResult =
  | { ok: true; action: "created" | "updated" | "skipped-no-gh"; number?: number; url?: string; notes: string[] }
  | { ok: false; error: string };

/** A fence has to be longer than the longest backtick run already inside the
 *  content it wraps, or that run closes the fence early. `brief.diff.raw` is
 *  literal file content (a writer's markdown can itself contain a ```
 *  code block), so the JSON embedding it can carry arbitrarily long backtick
 *  runs; a fixed "```json" fence would let that content escape into the rest
 *  of the PR body. */
function codeFence(content: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function briefToMarkdown(brief: ReviewBrief): string {
  const json = JSON.stringify(brief, null, 2);
  const fence = codeFence(json);
  return [
    `Content: \`${brief.slug}\`, an auto-generated review brief vs \`${brief.baseRef}\``,
    "",
    `**Checks**: ${brief.summary.pass} pass, ${brief.summary.warn} warn, ${brief.summary.fail} fail, ${brief.summary.skip} skip`,
    "",
    "<details><summary>Review brief (JSON)</summary>",
    "",
    `${fence}json`,
    json,
    fence,
    "</details>",
  ].join("\n");
}

function ensureContentReviewLabel(cwd: string): void {
  try {
    const labels = JSON.parse(execFileSync("gh", ["label", "list", "--json", "name"], { cwd, encoding: "utf8" })) as { name: string }[];
    if (!labels.some((l) => l.name === "content-review")) {
      execFileSync("gh", ["label", "create", "content-review", "--color", "0E8A16", "--description", "Auto-opened content review PR"], {
        cwd,
        stdio: "ignore",
      });
    }
  } catch {
    // best-effort: a missing label isn't fatal to opening/updating the PR
  }
}

/**
 * Opens or updates the `content/<slug>` PR with the review brief in its
 * body. It's idempotent (`gh pr list --head` first). Guarded: if `gh` isn't
 * installed this returns `skipped-no-gh` rather than throwing, so callers
 * that only want the brief (`review()` above) are unaffected.
 *
 * Deliberately a SEPARATE, opt-in step from `review()` (main() only calls
 * this behind `--pr`) rather than automatic on every invocation. This one
 * commits and pushes a branch; `review()` itself never touches git state
 * beyond reading it.
 */
export function openOrUpdateContentPr(cwd: string, brief: ReviewBrief): PrResult {
  if (!ghAvailable()) {
    return { ok: true, action: "skipped-no-gh", notes: ["gh CLI not found, so the brief was printed and no PR was opened or updated."] };
  }

  const branch = `content/${brief.slug}`;
  // A predictable name directly under the shared os.tmpdir() (the prior
  // `typren-review-<slug>-<timestamp>.md`) is guessable and poolable:
  // another local process could pre-create a symlink at that exact path
  // before writeFileSync runs. mkdtempSync's random suffix gives this a
  // private directory nothing else could have predicted.
  const bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-review-"));
  const bodyFile = path.join(bodyDir, "body.md");
  try {
    const existing = JSON.parse(
      execFileSync("gh", ["pr", "list", "--head", branch, "--json", "number,url"], { cwd, encoding: "utf8" })
    ) as { number: number; url: string }[];

    fs.writeFileSync(bodyFile, briefToMarkdown(brief));

    if (existing.length) {
      execFileSync("gh", ["pr", "edit", String(existing[0].number), "--body-file", bodyFile], { cwd });
      return { ok: true, action: "updated", number: existing[0].number, url: existing[0].url, notes: [] };
    }

    const branchExists = (() => {
      try {
        execFileSync("git", ["rev-parse", "--verify", branch], { cwd, stdio: "ignore", env: envWithoutGit() });
        return true;
      } catch {
        return false;
      }
    })();
    // brief.baseRef is review()'s already-validated `base` (rejects a
    // leading "-"); --end-of-options is belt-and-braces at the call site.
    execFileSync("git", branchExists ? ["checkout", branch] : ["checkout", "-b", branch, "--end-of-options", brief.baseRef], {
      cwd,
      env: envWithoutGit(),
    });

    execFileSync("git", ["add", brief.file], { cwd, env: envWithoutGit() });
    const notes: string[] = [];
    if (execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8", env: envWithoutGit() }).trim()) {
      execFileSync("git", ["commit", "-m", `content: update ${brief.slug}`], { cwd, env: envWithoutGit() });
    } else {
      notes.push("no staged changes to commit, so the existing branch state is pushed.");
    }
    execFileSync("git", ["push", "-u", "origin", branch], { cwd, env: envWithoutGit() });

    ensureContentReviewLabel(cwd);
    const url = execFileSync(
      "gh",
      ["pr", "create", "--title", `Content: ${brief.slug}`, "--body-file", bodyFile, "--label", "content-review", "--head", branch],
      { cwd, encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .pop();
    return { ok: true, action: "created", url, notes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    fs.rmSync(bodyDir, { recursive: true, force: true });
  }
}

/**
 * `typren review --update-pr <n> --body-file <path>`: the seam for the
 * agent's own judgment pass (voice/brand/SEO prose, see spec-A §3's "not
 * deterministic" list) to post its output onto the PR the deterministic
 * layer above already opened, without every agent reimplementing `gh` calls.
 */
export function updatePrBody(cwd: string, prNumber: number, bodyFile: string): PrResult {
  if (!ghAvailable()) return { ok: true, action: "skipped-no-gh", notes: ["gh CLI not found, so nothing was posted."] };
  const resolved = path.resolve(cwd, bodyFile);
  if (!fs.existsSync(resolved)) return { ok: false, error: `--body-file "${bodyFile}" not found` };
  try {
    execFileSync("gh", ["pr", "edit", String(prNumber), "--body-file", resolved], { cwd });
    return { ok: true, action: "updated", number: prNumber, notes: [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function printReviewReport(result: ReviewResult, opts: { json?: boolean } = {}): void {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    console.error(`typren review: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  if (!result.briefs.length) {
    console.log("typren review: no changed content files found against the base ref.");
    return;
  }
  for (const b of result.briefs) {
    console.log(`\n${b.slug} (${b.file}) vs ${b.baseRef}`);
    console.log(`  ${b.summary.pass} pass, ${b.summary.warn} warn, ${b.summary.fail} fail, ${b.summary.skip} skip`);
    for (const c of b.checks) console.log(`  [${c.status.padEnd(4)}] ${c.id}${c.message ? ": " + c.message : ""}`);
  }
}

/** Split from `printNextSteps` so the text is assertable without capturing
 *  stdout, matching how the rest of this file keeps its logic pure. */
export function nextSteps(baseDir: string): string {
  const appDir = baseDir === "." ? "app" : `${baseDir}/app`;
  return `
Next steps:

1. Make sure your tsconfig.json has a "@/*" path alias:

     "@/*": ["./${baseDir === "." ? "" : baseDir + "/"}*"]

2. Render your content: import \`getPage\` from "@/cms.config" and
   \`SliceZone\` from "@/slices/slice-zone" into a page under ${appDir}/, e.g.:

     const page = await getPage("home");
     return <SliceZone slices={page.slices} />;

3. Edit in the studio. It starts its own preview copy of your dev server
   (TYPREN_PREVIEW=1, on the studio port + 1), so your \`npm run dev\` stays
   as it is. To run both at once, give the preview its own build dir in
   next.config: distDir: process.env.TYPREN_PREVIEW === "1" ? ".next-preview" : ".next"

     npx typren studio

4. After upgrading any @typren package, run \`npx typren migrate\` and follow
   it until it exits 0.
`;
}

function printNextSteps(baseDir: string): void {
  console.log(nextSteps(baseDir));
}

function printHelp(): void {
  console.log(`typren: scaffolder CLI

Usage:
  npx typren init [--force]
  npx typren apply-settings
  npx typren review [slug] [--base <ref>] [--json] [--pr]
  npx typren review --update-pr <number> --body-file <path>
  npx typren telemetry [on|off]
  npx typren migrate [--from <ver>] [--to <ver>] [--json] [--remote] [--cwd <dir>]
  npx typren studio [--local] [--cloud-url <url>] [--port <n>] [--preview-port <n>] [--site-url <url>]
  npx typren page|template|section|media|settings|style|nav ...   (content commands, below)
  npx typren save [slug...] | publish | status
  npx typren --version

  init             Scaffold typren's site side into the current project
                   (default command): content, cms.config, slices and the
                   dev-only studio preview hooks. Edit with \`typren studio\`.
                   Never overwrites an existing file unless --force is given.

  apply-settings   Validate typren.config.json and check that cms.config
                   reads its locales/defaultLocale. Writes nothing.

  review           Deterministic content-review brief for the project's
                   content directory (auto-detected: src/content when src/
                   exists, else content; override via typren.config.json's
                   "review" key). No slug: one brief per file changed vs
                   --base (default origin/main). A slug: that page's
                   current file vs base.
                     --base <ref>        Compare against this ref (default origin/main).
                     --json               Print the raw review-brief JSON instead of a table.
                     --pr                 Also open/update the content/<slug> PR (needs gh).
                     --update-pr <n>      Post an existing PR body from --body-file (no brief run).
                     --body-file <path>   Markdown file to post with --update-pr.

  telemetry [on|off]   Enable/disable anonymous CLI usage telemetry, or print
                   the current state with no argument.

  migrate          Check the project against the installed @typren/core's
                   bundled migration notes: finds code that needs updating
                   after an upgrade and prints the fix/verify steps. Exits
                   non-zero while matches remain.
                     --from <ver>   Starting version (default: the
                                    @typren/core range in the last commit's
                                    package.json; required if that can't be
                                    determined, e.g. no git history).
                     --to <ver>     Ending version (default: installed
                                    @typren/core version).
                     --json         Print machine-readable JSON instead of text.
                     --remote       Also check typren.com for notes newer than
                                    this install. These are UNVERIFIED (not
                                    pinned by your lockfile); see the CLI README.
                     --cwd <dir>    Run against a project at this path
                                    (default: current directory).

  studio           Edit the site in the current directory. Starts the
                   site's own dev command in preview mode (TYPREN_PREVIEW=1)
                   on a side port; your normal dev server is left alone.
                   Override the command with typren.config.json's
                   "studio": { "previewCommand": "... {port} ..." }.
                   By default the studio UI opens in the cloud: only the
                   content API runs here, on 127.0.0.1, answering just that
                   origin with a one-session token carried in the link's
                   #fragment. Content never goes through the cloud.
                     --local             Run the studio UI on this machine
                                         instead (needs @typren/studio-local).
                     --cloud-url <url>   Cloud studio origin (default
                                         https://app.typren.com, or
                                         TYPREN_CLOUD_URL).
                     --port <n>          Studio (or API) port (default 4400).
                     --preview-port <n>  Preview dev server port (default --port + 1).
                     --site-url <url>    Frame this running site instead of
                                         starting one.

  Content commands: every studio action, from the terminal. Each takes
  --cwd <dir>, --locale <l> and --json ({"ok":true,...} or
  {"ok":false,"code","error"}); none prompts. Exit 0 done, 1 error, 2 version
  conflict. Page content comes from --file <path.json|.md>, or - for stdin.
  --base-version <v> (--base-saved-at for templates and sections) opts a
  write into strict conflict checking.
    page list | get <slug>
    page create <title> [--slug a/b] [--template <id>] [--sections <file>] [--folder] [--draft]
    page save <slug> --file <f> [--base-version <v>]
    page discard|publish|delete|duplicate <slug>
    page rename <slug> <new-slug>
    page set <slug> [--title t] [--nav|--no-nav] [--noindex|--no-noindex] [--description d]
    page add-section <slug> --file slice.json [--at <n>]
    page translate <slug> --to <locale> | page untranslate <slug> --locale <l>
    template list | save <name> --file slices.json | update <id> --file <f> [--base-saved-at <t>] [--name n] | delete <id>
    section list | save <name> --file slice.json | update <id> --file <f> [--base-saved-at <t>] | delete <id>
    media list | usage | upload <file> [--folder f] | move <id> <folder> [--name n] | delete <id>
    media folder create|delete <folder> | rename <folder> <to>
    settings get | set <dot.key> <value> | publish | bootstrap set <key> <value>
    style get | set <token> <value> | unset <token> | publish
    nav get | set --file nav.json | publish
    save [slug...]   Publish pending page drafts (a commit each in a git checkout).
    publish          Push the commits (git), else publish every draft.
    status           Branch, outgoing commits and pending drafts.
    changes list | push <page|path...> | discard <path...> | log <page>
                     Page drafts and saved files not pushed yet: push only
                     some (one commit per page), undo files in a new commit,
                     or read a page's version history (git).

  --force          Overwrite files that already exist (init only).
  --help           Show this help.
  --version, -v    Print the installed typren version.
`);
}

function printApplySettingsReport(result: ApplySettingsResult): void {
  if (!result.ok) {
    console.error(`typren apply-settings: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `typren apply-settings: bootstrap OK (` +
      `locales=[${result.bootstrap.locales.join(", ")}], defaultLocale="${result.bootstrap.defaultLocale}").\n` +
      `  cms.config:  ${result.cmsConfig}`
  );
  if (result.notes.length) {
    console.log("\n" + result.notes.join("\n"));
  }
}

/** Same hand-rolled style as the rest of this file's argv handling: no
 *  parsing dependency. Walks argv once, pulling out `review`'s flags/values
 *  and the first bare token after the "review" command word (the slug, if
 *  any) regardless of where the flags fall around it. */
function parseReviewArgs(args: string[]) {
  let slug: string | undefined;
  let base: string | undefined;
  let updatePr: string | undefined;
  let bodyFile: string | undefined;
  let json = false;
  let pr = false;
  let sawCommand = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base") base = args[++i];
    else if (a === "--update-pr") updatePr = args[++i];
    else if (a === "--body-file") bodyFile = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--pr") pr = true;
    else if (!a.startsWith("-")) {
      if (!sawCommand) sawCommand = true; // consumes "review" itself
      else if (slug === undefined) slug = a;
    }
  }
  return { slug, base, json, pr, updatePr, bodyFile };
}

/** Returns whether the command actually succeeded, so `main()` knows
 *  whether to record a telemetry event for it (never for a run that errored). */
function runReviewCommand(args: string[]): boolean {
  const opts = parseReviewArgs(args);

  if (opts.updatePr !== undefined) {
    const prNumber = Number(opts.updatePr);
    if (!Number.isInteger(prNumber) || !opts.bodyFile) {
      console.error("typren review: --update-pr <number> requires a numeric PR number and --body-file <path>");
      process.exitCode = 1;
      return false;
    }
    const result = updatePrBody(process.cwd(), prNumber, opts.bodyFile);
    if (!result.ok) {
      console.error(`typren review: ${result.error}`);
      process.exitCode = 1;
      return false;
    }
    console.log(`typren review: PR #${prNumber} ${result.action}.`);
    return true;
  }

  const result = review(process.cwd(), { slug: opts.slug, base: opts.base });
  printReviewReport(result, { json: opts.json });
  if (!result.ok) {
    process.exitCode = 1;
    return false;
  }
  let ok = true;
  if (opts.pr) {
    for (const brief of result.briefs) {
      const prResult = openOrUpdateContentPr(process.cwd(), brief);
      if (!prResult.ok) {
        console.error(`typren review: PR step failed for "${brief.slug}": ${prResult.error}`);
        process.exitCode = 1;
        ok = false;
      } else {
        console.log(`typren review: PR ${prResult.action} for "${brief.slug}"${prResult.url ? ` (${prResult.url})` : ""}.`);
        prResult.notes.forEach((n) => console.log(`  ${n}`));
      }
    }
  }
  return ok;
}

/** Same hand-rolled style as parseReviewArgs: the first bare token after
 *  "telemetry" itself (skipping any flags, though this command takes none). */
function parseTelemetrySubcommand(args: string[]): string | undefined {
  let sawCommand = false;
  for (const a of args) {
    if (a.startsWith("-")) continue;
    if (!sawCommand) {
      sawCommand = true; // consumes "telemetry" itself
      continue;
    }
    return a;
  }
  return undefined;
}

function runTelemetryCommand(args: string[]): void {
  const sub = parseTelemetrySubcommand(args);
  if (sub === undefined) {
    console.log(`typren telemetry: ${isEnabled() ? "on" : "off"}`);
    return;
  }
  if (sub === "on" || sub === "off") {
    setEnabled(sub === "on");
    console.log(`typren telemetry: ${sub}.`);
    return;
  }
  console.error(`typren telemetry: unknown argument "${sub}" (expected "on" or "off")`);
  process.exitCode = 1;
}

// Every command word `main()` actually dispatches to. `--help`/`--version`
// short-circuit above this and an unrecognized word errors out below it,
// neither ever reaching the telemetry notice/record calls: those aren't
// usage signals, and --version's own error path shouldn't announce telemetry
// on its way out.
const KNOWN_COMMANDS = new Set(["init", "apply-settings", "review", "telemetry", "migrate", "studio", ...CONTENT_COMMANDS]);

/** Resolves everything up front so a misconfigured site fails with a message
 *  instead of a Next stack trace, then runs the session (see `runStudio`). */
async function runStudioCommand(args: string[]): Promise<boolean> {
  const fail = (msg: string) => {
    console.error(`typren studio: ${msg}`);
    process.exitCode = 1;
    return false;
  };
  const opts = parseStudioArgs(args);
  if ("error" in opts) return fail(opts.error);
  const cwd = process.cwd();
  const studioUrl = `http://127.0.0.1:${opts.port}`;
  const siteUrl = opts.siteUrl ?? `http://127.0.0.1:${opts.previewPort}`;
  const manifest = await buildStudioManifest(cwd, siteUrl);
  if ("error" in manifest) return fail(manifest.error);
  const deps = {
    spawn,
    fetch: globalThis.fetch,
    log: console.log,
    error: (msg: string) => console.error(`typren studio: ${msg}`),
    signals: process,
  };

  if (opts.cloudUrl) {
    // Cloud mode: the UI is the cloud's, so no studio app runs here, only
    // the content API, and only for that origin with this session's token.
    const cloud = { origin: opts.cloudUrl, token: randomBytes(32).toString("base64url") };
    const start = async (): Promise<Foreground> => {
      const server = await serveOnLoopback(studioApi(manifest, cloud), opts.port);
      const exited = new Promise<number | null>((resolve) => server.on("close", () => resolve(0)));
      return {
        stop: () => {
          server.close();
          server.closeAllConnections();
        },
        exited,
      };
    };
    process.exitCode = await runStudio(
      {
        studio: start,
        studioUrl,
        siteUrl,
        // The preview's bridge and canvas answer only their parent's origin, which is now the cloud's.
        preview: opts.siteUrl ? undefined : previewCommand(cwd, opts.previewPort, cloud.origin),
        openUrl: connectUrl(cloud.origin, opts.port, cloud.token),
      },
      {
        ...deps,
        open: (url) => {
          const { command, args: argv, options } = browserCommand(url);
          spawn(command, argv, options).on("error", () => {}).unref();
        },
      }
    );
    return true;
  }

  const studioDir = resolveStudioDir(cwd);
  if (!studioDir) return fail("@typren/studio-local is not installed. Add it as a dev dependency of this site, or drop --local.");
  process.exitCode = await runStudio(
    {
      studio: studioCommand(studioDir, manifest, opts.port),
      studioUrl,
      siteUrl,
      preview: opts.siteUrl ? undefined : previewCommand(cwd, opts.previewPort, studioUrl),
    },
    deps
  );
  return true;
}

async function runMigrateCommand(args: string[]): Promise<boolean> {
  const opts = parseMigrateArgs(args);
  try {
    const result = await migrate({ cwd: opts.cwd, from: opts.from, to: opts.to, remote: opts.remote });
    printMigrateReport(result, { json: opts.json });
    const anyMatches = result.notes.some((n) => n.matches.length > 0);
    if (anyMatches || result.droppedNotesWarning) process.exitCode = 1;
    return true;
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return false;
  }
}

/** `argv` defaults to the real process argv so direct runs (isDirectRun()
 *  below) need no change, but takes an explicit array so tests can drive
 *  every dispatch branch without touching the real process.argv or
 *  capturing stdout beyond spying on console.*, matching how `nextSteps()`
 *  was already split out of `printNextSteps()` for the same reason.
 *  Declared `async` only for `migrate`, the one command with real I/O
 *  (`--remote` fetches); every other branch returns before its first await,
 *  so it runs fully synchronously the way existing callers expect. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = argv;
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(readCliVersion());
    return;
  }

  const force = args.includes("--force");
  const command = args.find((a) => !a.startsWith("-")) ?? "init";
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(
      `typren: unknown command "${command}" (run "typren --help" for the commands)`
    );
    process.exitCode = 1;
    return;
  }

  // Printed before the command's own output (per firstRunNotice()'s own
  // contract) so a long `review` report can't push it off screen. Only
  // reached for a recognized command, matching record() below: --help,
  // --version, and an unknown command never see this either.
  // A content command under --json owns stdout: the notice would corrupt it.
  const notice = CONTENT_COMMANDS.includes(command) && args.includes("--json") ? null : firstRunNotice();
  if (notice) console.log(notice);

  if (CONTENT_COMMANDS.includes(command)) {
    const code = await runContent(args.slice(args.indexOf(command)), {
      cwd: process.cwd(),
      stdin: readStdin,
      log: console.log,
      error: console.error,
    });
    if (code) process.exitCode = code;
    else record(command);
    return;
  }

  if (command === "telemetry") {
    runTelemetryCommand(args);
    return;
  }

  if (command === "apply-settings") {
    const result = applySettings(process.cwd());
    printApplySettingsReport(result);
    if (result.ok) record("apply-settings");
    return;
  }

  if (command === "review") {
    if (runReviewCommand(args)) record("review");
    return;
  }

  if (command === "migrate") {
    if (await runMigrateCommand(args)) record("migrate");
    return;
  }

  if (command === "studio") {
    if (await runStudioCommand(args)) record("studio");
    return;
  }

  // command === "init"
  const result = scaffold(process.cwd(), { force });
  if (!result.ok) {
    console.error(`typren init: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  record("init");

  const { created, skipped, baseDir, devScript } = result;
  console.log(`typren init: ${created.length} file(s) created, ${skipped.length} skipped (already exist).`);
  if (created.length) {
    console.log("\nCreated:");
    created.forEach((f) => console.log(`  ${f}`));
  }
  if (skipped.length) {
    console.log("\nSkipped (already exist; rerun with --force to overwrite):");
    skipped.forEach((f) => console.log(`  ${f}`));
  }
  if (devScript === "bound") console.log('\nUpdated package.json: "dev" now runs `next dev -H 127.0.0.1`.');
  if (devScript === "custom" || devScript === "no-package-json") {
    console.warn(
      "\nWarning: couldn't bind your dev script to loopback automatically. Add `-H 127.0.0.1` to your\n" +
        "dev command: it renders drafts while the studio previews it."
    );
  }
  printNextSteps(baseDir);
}

// Only run when executed directly (`node dist/cli.js`), not when imported
// (e.g. by cli.test.ts importing `scaffold`). Importing this module must
// never have the side effect of scaffolding into the real cwd. Resolve
// argv[1] through realpath first: npm/npx invoke the CLI via the
// node_modules/.bin symlink, but Node's ESM loader resolves import.meta.url
// to the symlink's *target*, so comparing the raw argv[1] against that would
// never match and main() would silently never run.
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
