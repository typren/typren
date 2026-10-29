// ---- dist/cli.d.ts ----
import { type SiteSettingsBootstrap } from "@typren/core";
export type ScaffoldResult = {
    ok: true;
    baseDir: string;
    created: string[];
    skipped: string[];
    devScript: DevScriptStatus;
} | {
    ok: false;
    error: string;
};
/**
 * Core of `typren init`: detect the App Router base dir, write every
 * template that doesn't already exist (or all of them, with `force`), and
 * report what happened. No process.exit/console, kept pure so it's directly
 * testable (see cli.test.ts) and reusable if another entry point ever wants it.
 */
export declare function scaffold(cwd: string, opts?: {
    force?: boolean;
}): ScaffoldResult;
/** What `scaffold` did to package.json's `dev` script. "custom" means a
 *  script it couldn't safely rewrite (not plain `next dev`, or an explicit
 *  non-loopback `-H`), so the user has to bind it themselves. */
export type DevScriptStatus = "bound" | "already-bound" | "custom" | "no-package-json";
type CmsConfigStatus = "already-wired" | "needs-manual-update" | "not-found";
export type ApplySettingsResult = {
    ok: true;
    bootstrap: SiteSettingsBootstrap;
    cmsConfig: CmsConfigStatus;
    notes: string[];
} | {
    ok: false;
    error: string;
};
/**
 * Core of `typren apply-settings`: validates typren.config.json's bootstrap
 * tier and checks the host's cms.config reads it. Never writes: an existing
 * cms.config is only grepped for the marker comment the template embeds, and
 * a missing wire-up prints exact instructions instead of guessing at an edit.
 */
export declare function applySettings(cwd: string): ApplySettingsResult;
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckResult = {
    id: string;
    status: CheckStatus;
    message?: string;
};
export type ReviewBrief = {
    slug: string;
    file: string;
    baseRef: string;
    diff: {
        raw: string;
        frontmatter: Record<string, {
            before: unknown;
            after: unknown;
        }>;
        slices: {
            added: {
                index: number;
                slice: string;
            }[];
            removed: {
                index: number;
                slice: string;
            }[];
            changed: {
                index: number;
                slice: string;
                fields: string[];
            }[];
        };
    };
    frontmatter: Record<string, unknown> & {
        slices: string[];
    };
    checks: CheckResult[];
    summary: Record<CheckStatus, number>;
};
export type ReviewResult = {
    ok: true;
    briefs: ReviewBrief[];
} | {
    ok: false;
    error: string;
};
/** Every path `review`'s checks read from, all repo-relative (what both `fs`
 *  and `git` want here). */
export type ReviewPaths = {
    contentDir: string;
    resourcesDir: string;
    seoFile: string;
    seoRegistryFile: string;
};
/**
 * Resolves the paths `review` reads from: the auto-detected defaults above,
 * with any `review` key in typren.config.json overriding individual fields.
 * None of these files are required to exist, on purpose. A predecessor
 * project's layout, or a scaffold that no longer emits seo.tsx at all, both
 * degrade the same way: the checks that depend on a missing file report
 * "skip" (see runChecks/checkEntityDescription/checkCanonical/
 * checkFaqRegistration), never a hard failure and never a silent pass.
 */
export declare function resolveReviewPaths(cwd: string): ReviewPaths;
/** Slice names with a `@typren/core/seo` seoRegistry entry. Scans line by
 *  line with plain string ops rather than a single `^\s*(\w+):\s*(?:async\s*)?\(`
 *  regex `matchAll` over the whole (repo-controlled) file: `indexOf`/`slice`
 *  are guaranteed linear in the file size regardless of content, so this
 *  can't regress into backtracking blowup if the pattern ever grows another
 *  quantifier. Returns null when the file can't be read (check that depends
 *  on it degrades to "skip", not a guess). */
export declare function getSeoRegistryKeys(cwd: string, paths: ReviewPaths): string[] | null;
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
export declare function review(cwd: string, opts?: {
    slug?: string;
    base?: string;
}): ReviewResult;
export type PrResult = {
    ok: true;
    action: "created" | "updated" | "skipped-no-gh";
    number?: number;
    url?: string;
    notes: string[];
} | {
    ok: false;
    error: string;
};
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
export declare function openOrUpdateContentPr(cwd: string, brief: ReviewBrief): PrResult;
/**
 * `typren review --update-pr <n> --body-file <path>`: the seam for the
 * agent's own judgment pass (voice/brand/SEO prose, see spec-A §3's "not
 * deterministic" list) to post its output onto the PR the deterministic
 * layer above already opened, without every agent reimplementing `gh` calls.
 */
export declare function updatePrBody(cwd: string, prNumber: number, bodyFile: string): PrResult;
/** Split from `printNextSteps` so the text is assertable without capturing
 *  stdout, matching how the rest of this file keeps its logic pure. */
export declare function nextSteps(baseDir: string): string;
/** `argv` defaults to the real process argv so direct runs (isDirectRun()
 *  below) need no change, but takes an explicit array so tests can drive
 *  every dispatch branch without touching the real process.argv or
 *  capturing stdout beyond spying on console.*, matching how `nextSteps()`
 *  was already split out of `printNextSteps()` for the same reason.
 *  Declared `async` only for `migrate`, the one command with real I/O
 *  (`--remote` fetches); every other branch returns before its first await,
 *  so it runs fully synchronously the way existing callers expect. */
export declare function main(argv?: string[]): Promise<void>;
export {};

// ---- dist/content.d.ts ----
import { type AuthAdapter } from "@typren/core";
/**
 * Allows everything. Whoever runs the CLI already owns the site's files, so
 * the operating system's permissions are the boundary; there is no session to
 * check. Lives here and is never exported from core: a server must never be
 * handed an adapter that says yes. Slug, locale, media-id, nav-href and style
 * validation still runs in the adapters and stores, not in auth.
 */
export declare const cliOwnerAuth: AuthAdapter;
export type ContentIO = {
    cwd: string;
    stdin: () => Promise<string>;
    log: (text: string) => void;
    error: (text: string) => void;
};
type Flags = Record<string, string | true>;
/** `--flag value`, `--flag=value` and the `booleans` (no value); everything
 *  else is positional, `-` (stdin) included. Unknown flags are refused, so a
 *  typo can't silently drop `--base-version`. */
export declare function parseFlags(args: string[], allowed: {
    booleans?: string[];
    values?: string[];
}): {
    pos: string[];
    flags: Flags;
};
/** The command words `main` hands to `runContent`. */
export declare const CONTENT_COMMANDS: string[];
/**
 * Runs one content command (`argv[0]` is its noun) and returns its exit code:
 * 0 done, 1 error, 2 version conflict. Prints `{ ok: true, ... }` or
 * `{ ok: false, code, error }` with `--json`, readable text otherwise.
 * Never prompts.
 */
export declare function runContent(argv: string[], io: ContentIO): Promise<number>;
export declare function readStdin(): Promise<string>;
export {};

// ---- dist/migrate.d.ts ----
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
/** process.env minus GIT_* variables. Git exports GIT_DIR and friends to its
 *  hooks, and an inherited GIT_DIR makes a git child process ignore `cwd` and
 *  act on the hook's repository instead (a pre-push test run once rewrote the
 *  real .git/config this way). */
export declare function envWithoutGit(): NodeJS.ProcessEnv;
/** Resolves the `@typren/core` range at HEAD, the version the project was
 *  last committed against, not whatever `node_modules` happens to hold right
 *  now. Returns null when there's no git history, no package.json there, or
 *  no `@typren/core` dependency, each a reason to require `--from` instead. */
export declare function fromVersionFromGit(cwd: string): string | null;
export declare function migrate(opts?: MigrateOptions): Promise<MigrateResult>;
/** Same hand-rolled style as the rest of this CLI's argv handling. */
export declare function parseMigrateArgs(args: string[]): {
    from: string | undefined;
    to: string | undefined;
    cwd: string | undefined;
    json: boolean;
    remote: boolean;
};
export declare function printMigrateReport(result: MigrateResult, opts?: {
    json?: boolean;
}): void;

// ---- dist/safe-matter.d.ts ----
import matter from "gray-matter";
export declare const parseMatter: (raw: string) => matter.GrayMatterFile<string>;

// ---- dist/studio.d.ts ----
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { type LocalSite, type Section, type SliceSchema } from "@typren/core";
export type StudioArgs = {
    port: number;
    /** Port of the preview-mode site dev server the studio spawns. */
    previewPort: number;
    /** Set by `--site-url`: frame this origin and spawn nothing. */
    siteUrl?: string;
};
/** Same hand-rolled argv style as the rest of the CLI. `--site-url` is
 *  reduced to its origin: the editor appends "/<slug>" to it. */
export declare function parseStudioArgs(args: string[]): StudioArgs | {
    error: string;
};
/** Mirrors apps/studio's `StudioManifest`: the site's facts plus the data
 *  parts of its cms.config, handed to the studio process as JSON. */
export type StudioManifest = LocalSite & {
    siteUrl: string;
    defaults: Record<string, Record<string, unknown>>;
    fieldSchema?: Record<string, SliceSchema>;
    /** The `studio` block's site facts (see `readStudioBlock`), each optional. */
    sections?: Section[];
    /** Route prefix under the site that page previews live at, e.g. "/draft". */
    previewPath?: string;
    /** The one-slice route's path, or `false` for a site with none. */
    sectionRoute?: string | false;
    /** Page path prefixes under a nested layout, which the studio previews on
     *  their real route instead of the page canvas. */
    nestedLayouts?: string[];
};
/**
 * The site at `cwd` as core's `LocalSite`: its `typren.config.json` `studio`
 * block (validated), content dir, media, home slug and style map. What a
 * command needs to edit the site through `createLocalSiteConfig`, without
 * the slice data the studio's editor also needs.
 */
export declare function resolveSite(cwd: string): LocalSite | {
    error: string;
};
/**
 * Builds the studio manifest for the site at `cwd`. Slice data comes from
 * `slices/defaults.ts` (required; its keys are the slice names) and
 * `slices/field-schema.ts` (optional), siblings of the content dir as
 * `typren init` lays them out.
 * ponytail: imported under Node's native type stripping, not through the
 * site's bundler, so these two files must be erasable TypeScript with no
 * value imports (no path aliases, no JSX). A slice missing from defaults.ts
 * is missing from the editor's add menu. Upgrade path: a studio entry point
 * the site compiles itself.
 */
export declare function buildStudioManifest(cwd: string, siteUrl: string): Promise<StudioManifest | {
    error: string;
}>;
/** The installed `@typren/studio-local` app: the site's own dependency first, then
 *  the one beside this CLI (the monorepo workspace link). */
export declare function resolveStudioDir(cwd: string, from?: string): string | null;
/** `next dev` bound to 127.0.0.1: the bind localAuth requires, and the
 *  development NODE_ENV it requires too.
 *  ponytail: dev mode compiles on first request. A prebuilt `next start`
 *  would need localAuth's `allowInProduction`, which it should not get. */
export declare function studioCommand(studioDir: string, manifest: StudioManifest, port: number): Command;
export type Command = {
    command: string;
    args: string[];
    options: SpawnOptions & {
        env: NodeJS.ProcessEnv;
    };
};
/**
 * The site's own dev command in preview mode. `typren.config.json`'s
 * `studio.previewCommand` overrides the default, which is the site's `dev`
 * script through its package manager plus Next.js's port flags, e.g.
 * `"studio": { "previewCommand": "npm run dev -- --port {port} --host 127.0.0.1" }`
 * for Astro or Vite.
 * ponytail: the template is split on whitespace, no shell quoting. Upgrade
 * to an argv array in the config if a command ever needs a quoted argument.
 */
export declare function previewCommand(cwd: string, port: number, studioOrigin: string): Command;
/** Resolves true once `url` answers at all (any status), false when
 *  `stopped()` turns true or the timeout passes first. */
export declare function waitForUrl(url: string, stopped: () => boolean, opts: {
    fetch: typeof fetch;
    timeoutMs: number;
    intervalMs: number;
}): Promise<boolean>;
export type StudioDeps = {
    spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
    fetch: typeof fetch;
    log: (msg: string) => void;
    error: (msg: string) => void;
    /** Where SIGINT/SIGTERM arrive: `process` outside tests. */
    signals: Pick<NodeJS.Process, "on" | "off">;
    timeoutMs?: number;
    intervalMs?: number;
};
/**
 * One studio session, the way `storybook dev` runs: start the site's dev
 * server in preview mode (unless `preview` is omitted, for `--site-url`),
 * wait until it answers at `siteUrl`, then run the studio in the foreground. Either one
 * exiting ends the session and stops the other; a preview crash prints its
 * captured output. Resolves with the exit code for the CLI.
 */
export declare function runStudio(plan: {
    studio: Command;
    studioUrl: string;
    siteUrl: string;
    preview?: Command;
}, deps: StudioDeps): Promise<number>;

// ---- dist/telemetry.d.ts ----
/** Whether telemetry should fire at all right now, folding in every opt-out source. */
export declare function isEnabled(): boolean;
/**
 * Returns the first-run notice text the one time it should be shown, and
 * remembers that it was shown so it is never returned again. Returns null on
 * every other call, and whenever telemetry would not fire anyway (so an
 * opted-out user never sees a notice about something that never happens).
 * The CLI owns printing this; this function only owns the text and the
 * one-time state transition.
 *
 * The endpoint check matters as much as the opt-out check: with no collector
 * configured `record()` sends nothing, so announcing that we collect usage
 * data would be claiming something that is not happening. Staying silent
 * until a collector exists beats training people to ignore the notice.
 */
export declare function firstRunNotice(): string | null;
/** Persists an explicit opt-in/opt-out choice, e.g. from `typren telemetry on|off`. */
export declare function setEnabled(on: boolean): void;
/** This package's own version, read from its package.json rather than a
 *  hardcoded string that drifts on every release bump. Shared with cli.ts's
 *  `--version` (both ship as dist/ siblings, so "../package.json" resolves
 *  the same way from either). */
export declare function readCliVersion(): string;
/**
 * Fire-and-forget usage beacon. Never awaited by callers, never throws, and
 * never delays the command it's called from: with no `TYPREN_TELEMETRY_URL`
 * set there is no collector to send to, so this does nothing at all, not
 * even a DNS lookup. That is deliberate: the module ships inert and starts
 * reporting only once a real endpoint exists, never a hardcoded placeholder.
 */
export declare function record(command: string): void;
