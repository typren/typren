// ---- dist/cli.d.ts ----
#!/usr/bin/env node
import { type SiteSettingsBootstrap } from "@typren/core";
export type ScaffoldResult = {
    ok: true;
    baseDir: string;
    created: string[];
    skipped: string[];
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
/** "created" only when no next.config.* existed yet (nothing to corrupt, so
 *  it's safe to write ours). An existing file is only ever READ. */
type NextConfigStatus = "created" | "already-wired" | "needs-manual-update";
type CmsConfigStatus = "already-wired" | "needs-manual-update" | "not-found";
export type ApplySettingsResult = {
    ok: true;
    bootstrap: SiteSettingsBootstrap;
    nextConfig: NextConfigStatus;
    cmsConfig: CmsConfigStatus;
    notes: string[];
} | {
    ok: false;
    error: string;
};
/**
 * Core of `typren apply-settings`: reconciles the host's next.config /
 * cms.config with typren.config.json's bootstrap tier (spec §5's "Admin-route
 * mechanism"). Validates first, so it never writes anything on a bad config.
 *
 * Ladder-preferred mechanism: next.config.ts is plain code that runs at
 * config-eval time, so the generated template just `import`s
 * typren.config.json and reads `bootstrap.adminRoute` directly: no codegen,
 * no regex-patching of the user's rewrite array. When a next.config.* already
 * exists, this function only ever READS it (grepping for the marker comment
 * the template embeds). Auto-patching an arbitrary existing rewrites() body
 * is the unsafe case the spec calls out, so that path prints exact
 * instructions instead of guessing at an edit. Idempotent: a file that's
 * already wired (or a config that's still invalid) makes no writes on rerun.
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
 *  stdout, matching how the rest of this file keeps its logic pure.
 *
 *  No Tailwind/theme step here: @typren/core/theme.css's tokens are read
 *  ONLY by @typren/editor's own UI (see that file's own doc comment), and
 *  this scaffold no longer emits an editor route at all, so importing it
 *  would wire up styling for a component that isn't there. Nothing below
 *  tells the user to open /editor either, for the same reason: that route
 *  doesn't exist in this scaffold's output. */
export declare function nextSteps(baseDir: string): string;
/** `argv` defaults to the real process argv so direct runs (isDirectRun()
 *  below) need no change, but takes an explicit array so tests can drive
 *  every dispatch branch without touching the real process.argv or
 *  capturing stdout beyond spying on console.*, matching how `nextSteps()`
 *  was already split out of `printNextSteps()` for the same reason. */
export declare function main(argv?: string[]): void;
export {};

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
/**
 * Fire-and-forget usage beacon. Never awaited by callers, never throws, and
 * never delays the command it's called from: with no `TYPREN_TELEMETRY_URL`
 * set there is no collector to send to, so this does nothing at all, not
 * even a DNS lookup. That is deliberate: the module ships inert and starts
 * reporting only once a real endpoint exists, never a hardcoded placeholder.
 */
export declare function record(command: string): void;
