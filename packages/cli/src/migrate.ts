import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseMatter } from "./safe-matter";

export interface MigrationDetectPattern {
  pattern: string;
  glob: string;
  hint: string;
}

export interface MigrationNote {
  package: string;
  version: string;
  title: string;
  detect: MigrationDetectPattern[];
  body: string;
  source: "bundled" | "remote";
}

export interface MigrationMatch {
  file: string;
  line: number;
  hint: string;
}

export interface MigrationNoteResult {
  package: string;
  version: string;
  title: string;
  matches: MigrationMatch[];
  body: string;
  source: "bundled" | "remote";
  /** Set when `--remote` returned a note for the same package+version as a
   *  bundled one and the two bodies disagree: the remote copy is unpinned by
   *  the lockfile and may not match what's actually installed. */
  divergesFromBundled?: boolean;
}

export interface MigrateResult {
  from: string;
  to: string;
  notes: MigrationNoteResult[];
  /** Set when the installed @typren/core only packs notes from
   *  `.min-version` onward (postbuild keeps the newest 5) and `from`
   *  predates it: some notes this project might have needed were dropped
   *  from the release, not just "none applied between from and to". */
  droppedNotesWarning?: string;
}

export interface MigrateOptions {
  cwd?: string;
  from?: string;
  to?: string;
  remote?: boolean;
  /** Test seam: a stand-in for the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "out",
  ".git",
  "coverage",
  "build",
  ".turbo",
  ".vercel",
  ".svelte-kit",
  ".output",
]);

// A detect pattern only needs to see source-sized files; a file above this is
// either generated/vendored or not something a hand-written migration fix
// would touch, so it's skipped rather than read in full.
const MAX_SCAN_FILE_BYTES = 1_000_000;

// Origin is HARDCODED, never read from config/env: `--remote` must always
// mean "this one site", not whatever an attacker-controlled env var points
// at. Every remote URL (index and each note) is also checked against this
// same prefix before it's fetched, so a compromised or malicious index entry
// can't redirect a fetch at another host.
const REMOTE_ORIGIN = "https://typren.com";
const REMOTE_URL_PREFIX = `${REMOTE_ORIGIN}/migrations/`;
const REMOTE_INDEX_URL = `${REMOTE_URL_PREFIX}index.json`;
const REMOTE_TIMEOUT_MS = 10_000;
const REMOTE_MAX_BYTES = 1_000_000;

function parseSemver(version: string): [number, number, number] {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`typren migrate: invalid semver "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function stripRange(range: string): string {
  return range.replace(/^[\^~]/, "");
}

/** process.env minus GIT_* variables. Git exports GIT_DIR and friends to its
 *  hooks, and an inherited GIT_DIR makes a git child process ignore `cwd` and
 *  act on the hook's repository instead (a pre-push test run once rewrote the
 *  real .git/config this way). */
export function envWithoutGit(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}

/** Resolves the `@typren/core` range at HEAD, the version the project was
 *  last committed against, not whatever `node_modules` happens to hold right
 *  now. Returns null when there's no git history, no package.json there, or
 *  no `@typren/core` dependency, each a reason to require `--from` instead. */
export function fromVersionFromGit(cwd: string): string | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["show", "HEAD:package.json"], { cwd, encoding: "utf8", env: envWithoutGit() });
  } catch {
    return null;
  }
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const range = pkg.dependencies?.["@typren/core"] ?? pkg.devDependencies?.["@typren/core"];
    return range ? stripRange(range) : null;
  } catch {
    return null;
  }
}

/** Resolves the installed `@typren/core` from the TARGET project (`cwd`),
 *  never from this CLI's own install, and returns its package.json path.
 *  Walks `node_modules` by hand instead of `require.resolve`/`exports`
 *  resolution: an installed core whose `exports` map doesn't list
 *  `./package.json` (true of every published core before this fix) makes
 *  Node's resolver throw ERR_PACKAGE_PATH_NOT_EXPORTED even though the file
 *  is right there on disk, which crashed `migrate` on every project. */
function resolveInstalledCore(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@typren", "core", "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `typren migrate: cannot find @typren/core installed above ${cwd} (no node_modules/@typren/core/package.json). ` +
      "Install your project's dependencies first."
  );
}

const PACKAGE_NAME_RE = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/i;

/** Anchored at both ends: a remote note's `version` is untrusted and gets
 *  printed straight to the terminal (and, with --json, round-tripped as a
 *  string), so a prefix match that accepted "1.2.3<escape sequence>" would
 *  let that trailing junk through disguised as a valid version. */
function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}

/** Strips ASCII control bytes other than \n and \t. A remote note's title
 *  and body are untrusted and get written straight to a terminal (and, with
 *  --json, round-tripped through a string); nothing it carries should be
 *  able to inject a cursor-control or other escape sequence into that output. */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Bundled notes come from this repo's own docs/migrations (trusted).
 *  Remote notes (`--remote`) are untrusted input: a malformed package/version
 *  is rejected outright (null, caller warns and drops it) rather than risking
 *  a garbage entry in the selected set, and title/body are sanitized. */
function parseNote(raw: string, source: MigrationNote["source"]): MigrationNote | null {
  const { data, content } = parseMatter(raw);
  const pkg = String(data.package ?? "");
  const version = String(data.version ?? "");
  if (source === "remote" && (!PACKAGE_NAME_RE.test(pkg) || !isValidSemver(version))) return null;
  const title = String(data.title ?? "");
  const body = content.trim();
  return {
    package: pkg,
    version,
    title: source === "remote" ? stripControlChars(title) : title,
    detect: Array.isArray(data.detect) ? (data.detect as MigrationDetectPattern[]) : [],
    body: source === "remote" ? stripControlChars(body) : body,
    source,
  };
}

function readMinVersion(migrationsDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(migrationsDir, ".min-version"), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

function loadBundledNotes(migrationsDir: string): MigrationNote[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseNote(fs.readFileSync(path.join(migrationsDir, f), "utf8"), "bundled"))
    .filter((n): n is MigrationNote => n !== null);
}

function selectNotes(notes: MigrationNote[], from: string, to: string): MigrationNote[] {
  return notes.filter((n) => compareSemver(n.version, from) > 0 && compareSemver(n.version, to) <= 0);
}

/** Minimal glob matcher: only needs to understand the shapes migration notes
 *  actually write (`**\/*.ts`, `**\/*.{ts,tsx}`). No new dependency for two
 *  wildcard forms and one brace list; reach for a real glob lib if a note
 *  ever needs character classes or nested braces. */
function globToRegExp(glob: string): RegExp {
  const expandBraces = (g: string): string[] => {
    const m = g.match(/\{([^{}]+)\}/);
    if (!m) return [g];
    const [whole, options] = m;
    return options.split(",").flatMap((opt) => expandBraces(g.slice(0, m.index) + opt + g.slice((m.index ?? 0) + whole.length)));
  };
  const alternatives = expandBraces(glob).map((g) => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*" && g[i + 1] === "*") {
        if (g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else if (c === "*") {
        re += "[^/]*";
      } else if (c === "?") {
        re += "[^/]";
      } else if (".+^$()|[]\\".includes(c)) {
        re += `\\${c}`;
      } else {
        re += c;
      }
    }
    return `(?:${re})`;
  });
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

/** `entry.isFile()` only, never a symlink (even one pointing at a real
 *  file): `withFileTypes` doesn't follow symlinks, so a symlink's
 *  `isFile()`/`isDirectory()` are both false here, and it's silently
 *  skipped rather than walked into or read. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}

interface CompiledPattern {
  noteIndex: number;
  fileRe: RegExp;
  lineRe: RegExp;
  hint: string;
}

function compileDetectPatterns(notes: MigrationNote[]): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  notes.forEach((note, noteIndex) => {
    for (const d of note.detect) {
      try {
        compiled.push({ noteIndex, fileRe: globToRegExp(d.glob), lineRe: new RegExp(d.pattern), hint: d.hint });
      } catch (err) {
        console.warn(`typren migrate: skipping unusable detect pattern in "${note.title}": ${(err as Error).message}`);
      }
    }
  });
  return compiled;
}

/** Runs every note's `detect` patterns over the project in a single pass:
 *  one `readFileSync` per file (not once per pattern, and not once per note
 *  that happens to match the same file), each file's lines then checked
 *  against every pattern whose glob applies to it. Patterns are data (regex
 *  sources, matched against file content), never executed as code: a bad
 *  pattern fails its own `new RegExp` and is skipped with a warning, it
 *  never takes the process down or runs anything on the note's behalf.
 *  Returns one match array per note, same order/length as `notes`. */
function detectAllMatches(notes: MigrationNote[], cwd: string, files: string[]): MigrationMatch[][] {
  const compiled = compileDetectPatterns(notes);
  const results: MigrationMatch[][] = notes.map(() => []);
  if (compiled.length === 0) return results;

  for (const relFile of files) {
    const applicable = compiled.filter((c) => c.fileRe.test(relFile));
    if (applicable.length === 0) continue;

    const abs = path.join(cwd, relFile);
    let size: number;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue; // gone between listing and reading
    }
    if (size > MAX_SCAN_FILE_BYTES) continue;

    let lines: string[];
    try {
      lines = fs.readFileSync(abs, "utf8").split("\n");
    } catch {
      continue;
    }
    for (const c of applicable) {
      lines.forEach((line, i) => {
        if (c.lineRe.test(line)) results[c.noteIndex].push({ file: relFile, line: i + 1, hint: c.hint });
      });
    }
  }
  return results;
}

async function fetchCapped(url: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    // redirect: "error" keeps the hardcoded-origin guarantee: a redirect off
    // typren.com would otherwise be followed silently.
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // Read the stream with a running byte count and abort past the cap,
    // rather than buffering the whole body and checking its length after:
    // a hostile or misbehaving server shouldn't get to make this CLI hold
    // more than REMOTE_MAX_BYTES in memory just to find out it's too big.
    if (!res.body) {
      const text = await res.text();
      if (Buffer.byteLength(text, "utf8") > REMOTE_MAX_BYTES) throw new Error("response exceeds 1 MB cap");
      return text;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REMOTE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("response exceeds 1 MB cap");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches the bundled-vs-remote note set from typren.com. Never throws:
 *  a network failure, bad signature, or untrusted URL just means "no remote
 *  notes this run", logged as a warning, falling back to the bundled set. */
async function fetchRemoteNotes(fetchImpl: typeof fetch): Promise<MigrationNote[]> {
  try {
    const indexRaw = await fetchCapped(REMOTE_INDEX_URL, fetchImpl);
    const index = JSON.parse(indexRaw) as unknown;
    if (!Array.isArray(index)) throw new Error("remote index is not an array");
    const notes: MigrationNote[] = [];
    for (const entry of index as { package?: string; version?: string; url?: string }[]) {
      if (typeof entry.url !== "string" || !entry.url.startsWith(REMOTE_URL_PREFIX)) {
        console.warn(`typren migrate: ignoring remote index entry with an untrusted url: ${stripControlChars(String(entry.url))}`);
        continue;
      }
      const raw = await fetchCapped(entry.url, fetchImpl);
      const note = parseNote(raw, "remote");
      if (!note) {
        console.warn(`typren migrate: ignoring a remote migration note with an invalid package/version: ${stripControlChars(entry.url)}`);
        continue;
      }
      notes.push(note);
    }
    return notes;
  } catch (err) {
    console.warn(
      `typren migrate: --remote fetch failed, falling back to bundled notes only (${stripControlChars((err as Error).message)})`
    );
    return [];
  }
}

export async function migrate(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const cwd = opts.cwd ?? process.cwd();
  const corePkgPath = resolveInstalledCore(cwd);
  const coreVersion = (JSON.parse(fs.readFileSync(corePkgPath, "utf8")) as { version: string }).version;
  const migrationsDir = path.join(path.dirname(corePkgPath), "migrations");

  const to = opts.to ?? coreVersion;
  const from = opts.from ?? fromVersionFromGit(cwd);
  if (!from) {
    throw new Error(
      "typren migrate: could not determine the starting version from git (no HEAD:package.json or no @typren/core " +
        "dependency there). Pass --from <version> explicitly."
    );
  }

  const bundled = selectNotes(loadBundledNotes(migrationsDir), from, to);
  const remote = opts.remote ? selectNotes(await fetchRemoteNotes(opts.fetchImpl ?? fetch), from, to) : [];

  const minVersion = readMinVersion(migrationsDir);
  const droppedNotesWarning =
    minVersion && compareSemver(from, minVersion) < 0
      ? `typren migrate: this install of @typren/core only packs migration notes from ${minVersion} onward ` +
        `(the newest few are kept; older ones are dropped at release time). Your project is upgrading from ${from}, ` +
        `which predates that cutoff, so notes it may have needed could be missing from this run. ` +
        `See https://typren.com/migrations/ or docs/migrations in the typren repo for the full history.`
      : undefined;

  const files = listFiles(cwd);
  const allMatches = detectAllMatches(bundled, cwd, files);
  const results: MigrationNoteResult[] = [];
  bundled.forEach((note, i) => {
    results.push({
      package: note.package,
      version: note.version,
      title: note.title,
      matches: allMatches[i],
      body: note.body,
      source: note.source,
    });
  });
  for (const note of remote) {
    const bundledSame = bundled.find((b) => b.package === note.package && b.version === note.version);
    results.push({
      package: note.package,
      version: note.version,
      title: note.title,
      // Remote notes are display-only: their detect regexes are untrusted
      // input (a hostile pattern could hang the CLI on catastrophic
      // backtracking), and only lockfile-pinned bundled notes gate the exit code.
      matches: [],
      body: note.body,
      source: note.source,
      divergesFromBundled: bundledSame ? bundledSame.body !== note.body : undefined,
    });
  }

  return { from, to, notes: results, droppedNotesWarning };
}

/** Same hand-rolled style as the rest of this CLI's argv handling. */
export function parseMigrateArgs(args: string[]) {
  let from: string | undefined;
  let to: string | undefined;
  let cwd: string | undefined;
  let json = false;
  let remote = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") from = args[++i];
    else if (a === "--to") to = args[++i];
    else if (a === "--cwd") cwd = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--remote") remote = true;
  }
  return { from, to, cwd, json, remote };
}

export function printMigrateReport(result: MigrateResult, opts: { json?: boolean } = {}): void {
  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }

  if (result.droppedNotesWarning) console.error(`\n${result.droppedNotesWarning}\n`);

  if (result.notes.length === 0) {
    console.log(`typren migrate: no notes apply between ${result.from} and ${result.to}.`);
    return;
  }

  const [bundledNotes, remoteNotes] = [
    result.notes.filter((n) => n.source === "bundled"),
    result.notes.filter((n) => n.source === "remote"),
  ];

  const printNote = (note: MigrationNoteResult) => {
    console.log(`\n${note.package} ${note.version}: ${note.title}`);
    if (note.divergesFromBundled) {
      console.log("  (differs from the bundled note for this version; this copy is unverified, follow it at your own risk)");
    }
    if (note.matches.length === 0) {
      console.log("  no matches found.");
    } else {
      for (const m of note.matches) console.log(`  ${m.file}:${m.line}  ${m.hint}`);
    }
    console.log(`\n${note.body}\n`);
  };

  for (const note of bundledNotes) printNote(note);
  if (remoteNotes.length) {
    console.log("\n=== REMOTE (unverified, not lockfile-pinned) ===");
    for (const note of remoteNotes) printNote(note);
  }

  const anyMatches = result.notes.some((n) => n.matches.length > 0);
  console.log(
    anyMatches
      ? "\ntypren migrate: matches remain. Fix them and rerun `typren migrate` until it exits 0, then run each note's Verify step."
      : "\ntypren migrate: no matches. Run each note's Verify step, then you're done."
  );
}
