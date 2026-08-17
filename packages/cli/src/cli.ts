#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { buildTemplates, TYPREN_BOOTSTRAP_MARKER, TYPREN_REWRITE_MARKER } from "@typren/core/templates/init";
import { createFsSettingsAdapter, resolveI18n, type SiteSettingsBootstrap, type Slice } from "@typren/core";

export type ScaffoldResult =
  | { ok: true; baseDir: string; created: string[]; skipped: string[] }
  | { ok: false; error: string };

/**
 * Core of `typren init`: detect the App Router base dir, write every
 * template that doesn't already exist (or all of them, with `force`), and
 * report what happened. No process.exit/console — kept pure so it's directly
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
    // A "/"-prefixed key (next.config.ts, typren.config.json) always lands at
    // the project root, never under baseDir — see buildTemplates' doc comment.
    const abs = relPath.startsWith("/") ? path.join(cwd, relPath.slice(1)) : path.join(cwd, baseDir, relPath);
    const rel = path.relative(cwd, abs);
    if (fs.existsSync(abs) && !opts.force) {
      skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  }

  return { ok: true, baseDir, created, skipped };
}

// Same SAFE_SLUG-shaped route rule markdown-adapter.ts uses for slugs, plus
// the reserved-word check — kept as its own copy (not imported) rather than a
// shared export: this is a Node-side CLI concern, an admin-route settings UI
// would own its own equivalent, and duplicating one regex + one Set is
// cheaper than coupling the two layers.
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]*$/i;
const RESERVED_ROUTES = new Set(["api", "_next"]);

/** Validates a bootstrap config against the same rules the Settings "Advanced"
 *  panel and the onboarding wizard's admin-route step enforce, so a config
 *  that passes one passes all three. Returns an error string, or null when
 *  valid. Reuses `resolveI18n`'s own defaultLocale-in-locales check rather
 *  than re-deriving it. */
function validateBootstrap(bs: SiteSettingsBootstrap): string | null {
  if (!SAFE_ROUTE.test(bs.adminRoute))
    return `adminRoute "${bs.adminRoute}" must start with a letter/digit and contain only letters, digits, or hyphens`;
  if (RESERVED_ROUTES.has(bs.adminRoute.toLowerCase()))
    return `adminRoute "${bs.adminRoute}" is a reserved path and can't be used as the admin route`;
  try {
    resolveI18n({ locales: bs.locales, defaultLocale: bs.defaultLocale, routing: bs.routing });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

const NEXT_CONFIG_CANDIDATES = ["next.config.ts", "next.config.mjs", "next.config.js"];
const CMS_CONFIG_CANDIDATES = ["cms.config.ts", "src/cms.config.ts", "cms.config.js", "src/cms.config.js"];

/** "created" only when no next.config.* existed yet (nothing to corrupt, so
 *  it's safe to write ours). An existing file is only ever READ. */
type NextConfigStatus = "created" | "already-wired" | "needs-manual-update";
type CmsConfigStatus = "already-wired" | "needs-manual-update" | "not-found";

export type ApplySettingsResult =
  | { ok: true; bootstrap: SiteSettingsBootstrap; nextConfig: NextConfigStatus; cmsConfig: CmsConfigStatus; notes: string[] }
  | { ok: false; error: string };

/**
 * Core of `typren apply-settings`: reconciles the host's next.config /
 * cms.config with typren.config.json's bootstrap tier (spec §5's "Admin-route
 * mechanism"). Validates first — never writes anything on a bad config.
 *
 * Ladder-preferred mechanism: next.config.ts is plain code that runs at
 * config-eval time, so the generated template just `import`s
 * typren.config.json and reads `bootstrap.adminRoute` directly — no codegen,
 * no regex-patching of the user's rewrite array. When a next.config.* already
 * exists, this function only ever READS it (grepping for the marker comment
 * the template embeds) — auto-patching an arbitrary existing rewrites() body
 * is the unsafe case the spec calls out, so that path prints exact
 * instructions instead of guessing at an edit. Idempotent: a file that's
 * already wired (or a config that's still invalid) makes no writes on rerun.
 */
export function applySettings(cwd: string): ApplySettingsResult {
  const bootstrapFile = path.join(cwd, "typren.config.json");
  const bootstrap = createFsSettingsAdapter({ file: bootstrapFile }).readBootstrap();

  const error = validateBootstrap(bootstrap);
  if (error) return { ok: false, error: `invalid typren.config.json: ${error}` };

  const notes: string[] = [];

  let nextConfig: NextConfigStatus;
  const foundNextConfig = NEXT_CONFIG_CANDIDATES.map((f) => path.join(cwd, f)).find(fs.existsSync);
  if (!foundNextConfig) {
    fs.writeFileSync(path.join(cwd, "next.config.ts"), buildTemplates("content")["/next.config.ts"]);
    nextConfig = "created";
  } else if (fs.readFileSync(foundNextConfig, "utf8").includes(TYPREN_REWRITE_MARKER)) {
    nextConfig = "already-wired";
  } else {
    nextConfig = "needs-manual-update";
    notes.push(
      `${path.relative(cwd, foundNextConfig)} doesn't read typren.config.json yet. Add:\n\n` +
        `    import bootstrap from "./typren.config.json";\n` +
        "    // inside rewrites():\n" +
        '    { source: `/${bootstrap.adminRoute}/:path*`, destination: "/editor/:path*" }\n'
    );
  }

  let cmsConfig: CmsConfigStatus;
  const foundCmsConfig = CMS_CONFIG_CANDIDATES.map((f) => path.join(cwd, f)).find(fs.existsSync);
  if (!foundCmsConfig) {
    cmsConfig = "not-found";
    notes.push("no cms.config.ts found — run `typren init` first.");
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
  return { ok: true, bootstrap, nextConfig, cmsConfig, notes };
}

// ---------------------------------------------------------------------------
// `typren review` — deterministic content-review brief (see spec-A). Same
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
 *  disk — needed here because "before" content comes from `git show`, not
 *  a path. Not worth instantiating a whole ContentAdapter for a blob string. */
function parsePage(raw: string): { meta: Record<string, unknown>; slices: Slice[]; hasFrontmatter: boolean } {
  const { data } = matter(raw);
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

/** Best-effort text probe for `export const NAME = "...";` — reads the
 *  constant's value without importing the file. Several of the files this
 *  needs to read (src/app/seo.tsx) re-export JSX-bearing modules, and Node's
 *  native TS type-stripping doesn't transform JSX — importing them would
 *  throw. A regex read of a plain string constant sidesteps that entirely
 *  and never executes host code. */
function extractStringConst(text: string, name: string): string | null {
  const m = text.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** Slice names with a `@typren/core/seo` seoRegistry entry, scraped the same
 *  regex-probe way as extractStringConst — see its comment for why this
 *  doesn't just `import()` the file. Returns null when the file can't be
 *  read (check that depends on it degrades to "skip", not a guess). */
function getSeoRegistryKeys(cwd: string): string[] | null {
  const text = readTextSafe(path.join(cwd, "src/slices/seo-registry.ts"));
  if (text === null) return null;
  return [...text.matchAll(/^\s*(\w+):\s*(?:async\s*)?\(/gm)].map((m) => m[1]);
}

function getSiteUrl(cwd: string): string | null {
  const text = readTextSafe(path.join(cwd, "src/app/seo.tsx"));
  return text === null ? null : extractStringConst(text, "SITE_URL");
}

/** Slugs `createMarkdownAdapter`'s default-locale `listSlugs()` would return
 *  (flat `src/content/*.md` files carrying a `slices` array) — reimplemented
 *  against raw files instead of instantiating the adapter/store because the
 *  host's `src/cms.config.ts` imports "server-only", which throws unless
 *  imported from a React Server Component build (i.e. never from a plain
 *  Node CLI process). Same reasoning as parsePage() above. */
function listCmsPageSlugs(cwd: string): string[] {
  const dir = path.join(cwd, "src/content");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.replace(/\.md$/, ""))
    .filter((slug) => {
      const raw = readTextSafe(path.join(dir, `${slug}.md`));
      return raw !== null && Array.isArray(matter(raw).data.slices);
    });
}

/** Locates a slug's content file: a routed CMS page (`src/content/<slug>.md`)
 *  or a hosted resource post (`src/content/resources/<slug>.md`, no
 *  frontmatter — see src/lib/resources.ts). Returns a repo-relative path
 *  (what git wants), or null if neither exists. */
function findContentFile(cwd: string, slug: string): string | null {
  const flat = `src/content/${slug}.md`;
  if (fs.existsSync(path.join(cwd, flat))) return flat;
  const nested = `src/content/resources/${slug}.md`;
  if (fs.existsSync(path.join(cwd, nested))) return nested;
  return null;
}

function gitShow(cwd: string, ref: string, relFile: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relFile}`], { cwd, encoding: "utf8" });
  } catch {
    return null; // file didn't exist at `ref` (e.g. a new page) — treated as empty "before"
  }
}

function gitDiffRaw(cwd: string, base: string, relFile: string): string {
  try {
    return execFileSync("git", ["diff", base, "--", relFile], { cwd, encoding: "utf8" });
  } catch (e) {
    return `(unable to compute diff against "${base}": ${e instanceof Error ? e.message : String(e)})`;
  }
}

function gitChangedContentFiles(cwd: string, base: string): { ok: true; files: string[] } | { ok: false; error: string } {
  try {
    const out = execFileSync("git", ["diff", "--name-only", base, "--", "src/content"], { cwd, encoding: "utf8" });
    return { ok: true, files: out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md")) };
  } catch (e) {
    return {
      ok: false,
      error: `\`git diff --name-only ${base} -- src/content\` failed: ${
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
 *  media-typed field in src/slices/field-schema.ts actually uses — see
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
 *  level today, so this can't be a real DOM-heading-order engine — it only
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
  // of a page's own <title> — 60 is the recommended ceiling BEFORE that
  // suffix, per SERP truncation guidance.
  return [...mk("title", 0, 60), ...mk("description", 50, 160)];
}

function checkCanonical(meta: Record<string, unknown>, siteUrl: string | null): CheckResult {
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
    : { id: "seo.canonical.consistency", status: "skip", message: "couldn't read SITE_URL from src/app/seo.tsx to validate against" };
}

function checkNoindex(meta: Record<string, unknown>): CheckResult {
  return meta.noindex === true
    ? { id: "seo.noindex.flagged", status: "warn", message: "meta.noindex is true — verify this page is intentionally excluded from nav/sitemap" }
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

function checkEntityDescription(cwd: string): CheckResult {
  const text = readTextSafe(path.join(cwd, "src/app/seo.tsx"));
  if (text === null) return { id: "aio.entity.description-present", status: "skip", message: "src/app/seo.tsx not found" };
  const val = extractStringConst(text, "SITE_ENTITY_DESCRIPTION");
  return val && val.trim().length > 0
    ? { id: "aio.entity.description-present", status: "pass" }
    : { id: "aio.entity.description-present", status: "fail", message: "SITE_ENTITY_DESCRIPTION is missing or empty in src/app/seo.tsx" };
}

function checkFaqRegistration(slices: Slice[], registeredKeys: string[] | null): CheckResult {
  if (registeredKeys === null) {
    return { id: "aio.jsonld.slice-registered", status: "skip", message: "couldn't read src/slices/seo-registry.ts" };
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
    ? { id: "aio.llms.reachable", status: "pass", message: "in cmsStore — covered by generateLlmsFullTxt automatically" }
    : {
        id: "aio.llms.reachable",
        status: "warn",
        message: `"${slug}" isn't in cmsStore (e.g. a resources/*.md post) — not included in llms-full.txt or public/llms.txt`,
      };
}

function checkRobotsCrawlable(meta: Record<string, unknown>): CheckResult {
  // typren/seo's buildRobots doesn't special-case noindex pages — they stay
  // crawlable by default (only <meta name="robots"> keeps them out of the
  // index), which is the expected/normal state per spec-A §3, not a finding.
  return meta.noindex === true
    ? { id: "seo.robots.crawlable", status: "pass", message: "noindex page remains crawlable per robots.ts defaults — expected" }
    : { id: "seo.robots.crawlable", status: "pass" };
}

function runChecks(
  cwd: string,
  slug: string,
  meta: Record<string, unknown>,
  slices: Slice[],
  hasFrontmatter: boolean,
  cmsSlugs: string[]
): CheckResult[] {
  // aio.entity.description-present and aio.llms.reachable are repo/registry-
  // wide invariants, not per-file — still meaningful even for a page with no
  // frontmatter of its own (e.g. a resources/*.md post body).
  if (!hasFrontmatter) {
    const skip = (id: string, message: string): CheckResult => ({ id, status: "skip", message });
    const reason = "no frontmatter block found — not a CMS page (e.g. a resources/*.md post body)";
    return [
      skip("seo.description.present", reason),
      skip("seo.description.length", reason),
      skip("seo.title.present", reason),
      skip("seo.title.length", reason),
      skip("seo.canonical.consistency", reason),
      skip("seo.noindex.flagged", reason),
      skip("seo.sitemap.priority-range", reason),
      checkEntityDescription(cwd),
      skip("aio.jsonld.slice-registered", reason),
      skip("a11y.alt.present", reason),
      skip("seo.headings.order", reason),
      checkLlmsReachable(slug, cmsSlugs),
      skip("seo.robots.crawlable", reason),
    ];
  }

  const siteUrl = getSiteUrl(cwd);
  const registeredKeys = getSeoRegistryKeys(cwd);
  return [
    ...checkTitleAndDescription(meta),
    checkCanonical(meta, siteUrl),
    checkNoindex(meta),
    checkSitemapPriority(meta),
    checkEntityDescription(cwd),
    checkFaqRegistration(slices, registeredKeys),
    checkAlt(slices),
    checkHeadingsOrder(slices),
    checkLlmsReachable(slug, cmsSlugs),
    checkRobotsCrawlable(meta),
  ];
}

function buildBrief(cwd: string, relFile: string, base: string): ReviewBrief {
  const slug = path.basename(relFile, ".md");
  const rawAfter = readTextSafe(path.join(cwd, relFile)) ?? "";
  const rawBefore = gitShow(cwd, base, relFile) ?? "";
  const after = parsePage(rawAfter);
  const before = parsePage(rawBefore);

  const cmsSlugs = listCmsPageSlugs(cwd);
  const checks = runChecks(cwd, slug, after.meta, after.slices, after.hasFrontmatter, cmsSlugs);
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
 * `src/content/**` file changed against `base` (default `origin/main`,
 * working-tree included — a plain `git diff <base> -- <path>`, not a
 * merge-base triple-dot, so uncommitted local edits show up too). A slug:
 * one brief for that page's current file vs. its `base` version, found
 * whether it's a routed CMS page or a hosted resources/*.md post.
 */
export function review(cwd: string, opts: { slug?: string; base?: string } = {}): ReviewResult {
  const base = opts.base ?? "origin/main";
  if (opts.slug) {
    const relFile = findContentFile(cwd, opts.slug);
    if (!relFile) {
      return {
        ok: false,
        error: `no content file found for slug "${opts.slug}" (looked in src/content/${opts.slug}.md and src/content/resources/${opts.slug}.md)`,
      };
    }
    return { ok: true, briefs: [buildBrief(cwd, relFile, base)] };
  }
  const changed = gitChangedContentFiles(cwd, base);
  if (!changed.ok) return { ok: false, error: changed.error };
  return { ok: true, briefs: changed.files.map((f) => buildBrief(cwd, f, base)) };
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

function briefToMarkdown(brief: ReviewBrief): string {
  return [
    `Content: \`${brief.slug}\` — auto-generated review brief vs \`${brief.baseRef}\``,
    "",
    `**Checks**: ${brief.summary.pass} pass, ${brief.summary.warn} warn, ${brief.summary.fail} fail, ${brief.summary.skip} skip`,
    "",
    "<details><summary>Review brief (JSON)</summary>",
    "",
    "```json",
    JSON.stringify(brief, null, 2),
    "```",
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
    // best-effort — a missing label isn't fatal to opening/updating the PR
  }
}

/**
 * Opens or updates the `content/<slug>` PR with the review brief in its
 * body — idempotent (`gh pr list --head` first). Guarded: if `gh` isn't
 * installed this returns `skipped-no-gh` rather than throwing, so callers
 * that only want the brief (`review()` above) are unaffected.
 *
 * Deliberately a SEPARATE, opt-in step from `review()` (main() only calls
 * this behind `--pr`) rather than automatic on every invocation — this one
 * commits and pushes a branch, `review()` itself never touches git state
 * beyond reading it.
 */
export function openOrUpdateContentPr(cwd: string, brief: ReviewBrief): PrResult {
  if (!ghAvailable()) {
    return { ok: true, action: "skipped-no-gh", notes: ["gh CLI not found — brief was printed, no PR opened/updated."] };
  }

  const branch = `content/${brief.slug}`;
  const bodyFile = path.join(os.tmpdir(), `typren-review-${brief.slug}-${Date.now()}.md`);
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
        execFileSync("git", ["rev-parse", "--verify", branch], { cwd, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();
    execFileSync("git", branchExists ? ["checkout", branch] : ["checkout", "-b", branch, brief.baseRef], { cwd });

    execFileSync("git", ["add", brief.file], { cwd });
    const notes: string[] = [];
    if (execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" }).trim()) {
      execFileSync("git", ["commit", "-m", `content: update ${brief.slug}`], { cwd });
    } else {
      notes.push("no staged changes to commit — pushing existing branch state.");
    }
    execFileSync("git", ["push", "-u", "origin", branch], { cwd });

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
    if (fs.existsSync(bodyFile)) fs.rmSync(bodyFile);
  }
}

/**
 * `typren review --update-pr <n> --body-file <path>` — the seam for the
 * agent's own judgment pass (voice/brand/SEO prose — see spec-A §3's "not
 * deterministic" list) to post its output onto the PR the deterministic
 * layer above already opened, without every agent reimplementing `gh` calls.
 */
export function updatePrBody(cwd: string, prNumber: number, bodyFile: string): PrResult {
  if (!ghAvailable()) return { ok: true, action: "skipped-no-gh", notes: ["gh CLI not found — nothing posted."] };
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
    console.log("typren review: no changed files under src/content against the base ref.");
    return;
  }
  for (const b of result.briefs) {
    console.log(`\n${b.slug} (${b.file}) vs ${b.baseRef}`);
    console.log(`  ${b.summary.pass} pass, ${b.summary.warn} warn, ${b.summary.fail} fail, ${b.summary.skip} skip`);
    for (const c of b.checks) console.log(`  [${c.status.padEnd(4)}] ${c.id}${c.message ? " — " + c.message : ""}`);
  }
}

const TYPREN_THEME_MAPPING = `:root {
  --typren-bg: var(--background, #ffffff);
  --typren-fg: var(--foreground, #18181b);
  --typren-muted: var(--muted, #f4f4f5);
  --typren-muted-fg: var(--muted-foreground, #71717a);
  --typren-border: var(--border, #e4e4e7);
  --typren-primary: var(--primary, #2563eb);
  --typren-primary-fg: var(--primary-foreground, #ffffff);
  --typren-ring: var(--ring, #3b82f6);
  --typren-destructive: var(--destructive, #dc2626);
}
.dark {
  color-scheme: dark;
  --typren-bg: #09090b;
  --typren-fg: #fafafa;
  --typren-muted: #27272a;
  --typren-muted-fg: #a1a1aa;
  --typren-border: #27272a;
  --typren-primary: var(--primary, #3b82f6);
  --typren-primary-fg: var(--primary-foreground, #ffffff);
  --typren-ring: var(--ring, #3b82f6);
  --typren-destructive: #ef4444;
}`;

function printNextSteps(baseDir: string): void {
  const appDir = baseDir === "." ? "app" : `${baseDir}/app`;
  console.log(`
Next steps:

1. Add typren's editor styles near your Tailwind entry (usually ${appDir}/globals.css):

     @import "@typren/core/theme.css";
     @source "../node_modules/@typren/editor/dist"; /* Tailwind v4: adjust the relative path to your CSS file's location */

   Then map the --typren-* tokens it defines onto your own design tokens (adjust
   the fallbacks/dark values to match your theme):

${TYPREN_THEME_MAPPING
  .split("\n")
  .map((l) => "     " + l)
  .join("\n")}

2. Make sure your tsconfig.json has a "@/*" path alias:

     "@/*": ["./${baseDir === "." ? "" : baseDir + "/"}*"]

3. Start your dev server and open /editor.
`);
}

function printHelp(): void {
  console.log(`typren — scaffolder CLI

Usage:
  npx typren init [--force]
  npx typren apply-settings
  npx typren review [slug] [--base <ref>] [--json] [--pr]
  npx typren review --update-pr <number> --body-file <path>

  init             Scaffold typren's editor wiring into the current project
                   (default command). Never overwrites an existing file
                   unless --force is given.

  apply-settings   Reconcile the host's next.config/cms.config with
                   typren.config.json's adminRoute/locales/defaultLocale
                   (spec §5). Safe to run repeatedly.

  review           Deterministic content-review brief for src/content/**.
                   No slug: one brief per file changed vs --base (default
                   origin/main). A slug: that page's current file vs base.
                     --base <ref>        Compare against this ref (default origin/main).
                     --json               Print the raw review-brief JSON instead of a table.
                     --pr                 Also open/update the content/<slug> PR (needs gh).
                     --update-pr <n>      Post an existing PR body from --body-file (no brief run).
                     --body-file <path>   Markdown file to post with --update-pr.

  --force          Overwrite files that already exist (init only).
  --help           Show this help.
`);
}

function printApplySettingsReport(result: ApplySettingsResult): void {
  if (!result.ok) {
    console.error(`typren apply-settings: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `typren apply-settings: bootstrap OK (adminRoute="${result.bootstrap.adminRoute}", ` +
      `locales=[${result.bootstrap.locales.join(", ")}], defaultLocale="${result.bootstrap.defaultLocale}").\n` +
      `  next.config: ${result.nextConfig}\n` +
      `  cms.config:  ${result.cmsConfig}`
  );
  if (result.notes.length) {
    console.log("\n" + result.notes.join("\n"));
  }
}

/** Same hand-rolled style as the rest of this file's argv handling — no
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

function runReviewCommand(args: string[]): void {
  const opts = parseReviewArgs(args);

  if (opts.updatePr !== undefined) {
    const prNumber = Number(opts.updatePr);
    if (!Number.isInteger(prNumber) || !opts.bodyFile) {
      console.error("typren review: --update-pr <number> requires a numeric PR number and --body-file <path>");
      process.exitCode = 1;
      return;
    }
    const result = updatePrBody(process.cwd(), prNumber, opts.bodyFile);
    if (!result.ok) {
      console.error(`typren review: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`typren review: PR #${prNumber} ${result.action}.`);
    return;
  }

  const result = review(process.cwd(), { slug: opts.slug, base: opts.base });
  printReviewReport(result, { json: opts.json });
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  if (opts.pr) {
    for (const brief of result.briefs) {
      const prResult = openOrUpdateContentPr(process.cwd(), brief);
      if (!prResult.ok) {
        console.error(`typren review: PR step failed for "${brief.slug}": ${prResult.error}`);
        process.exitCode = 1;
      } else {
        console.log(`typren review: PR ${prResult.action} for "${brief.slug}"${prResult.url ? ` (${prResult.url})` : ""}.`);
        prResult.notes.forEach((n) => console.log(`  ${n}`));
      }
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const force = args.includes("--force");
  const command = args.find((a) => !a.startsWith("-")) ?? "init";
  if (command === "apply-settings") {
    printApplySettingsReport(applySettings(process.cwd()));
    return;
  }
  if (command === "review") {
    runReviewCommand(args);
    return;
  }
  if (command !== "init") {
    console.error(`typren: unknown command "${command}" (only "init", "apply-settings", and "review" are supported)`);
    process.exitCode = 1;
    return;
  }

  const result = scaffold(process.cwd(), { force });
  if (!result.ok) {
    console.error(`typren init: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const { created, skipped, baseDir } = result;
  console.log(`typren init: ${created.length} file(s) created, ${skipped.length} skipped (already exist).`);
  if (created.length) {
    console.log("\nCreated:");
    created.forEach((f) => console.log(`  ${f}`));
  }
  if (skipped.length) {
    console.log("\nSkipped (already exist — rerun with --force to overwrite):");
    skipped.forEach((f) => console.log(`  ${f}`));
  }
  printNextSteps(baseDir);
}

// Only run when executed directly (`node dist/cli.js`), not when imported
// (e.g. by cli.test.ts importing `scaffold`) — importing this module must
// never have the side effect of scaffolding into the real cwd. Resolve
// argv[1] through realpath first: npm/npx invoke the CLI via the
// node_modules/.bin symlink, but Node's ESM loader resolves import.meta.url
// to the symlink's *target* — comparing the raw argv[1] against that would
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
