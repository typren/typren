import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { styleMapError, type LocalSite, type Section, type SliceSchema, type StyleMap } from "@typren/core";

export type StudioArgs = {
  port: number;
  /** Port of the preview-mode site dev server the studio spawns. */
  previewPort: number;
  /** Set by `--site-url`: frame this origin and spawn nothing. */
  siteUrl?: string;
};

function parsePort(flag: string, value: string): number | { error: string } {
  const n = Number(value);
  return /^\d+$/.test(value) && n >= 1 && n <= 65535 ? n : { error: `${flag} must be a port number, got "${value}"` };
}

/** Same hand-rolled argv style as the rest of the CLI. `--site-url` is
 *  reduced to its origin: the editor appends "/<slug>" to it. */
export function parseStudioArgs(args: string[]): StudioArgs | { error: string } {
  let port = "4400";
  let previewPort: string | undefined;
  let siteUrl: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") port = args[++i] ?? "";
    else if (args[i] === "--preview-port") previewPort = args[++i] ?? "";
    else if (args[i] === "--site-url") siteUrl = args[++i] ?? "";
  }
  const studio = parsePort("--port", port);
  if (typeof studio !== "number") return studio;
  const preview = parsePort("--preview-port", previewPort ?? String(studio + 1));
  if (typeof preview !== "number") return preview;
  if (siteUrl === undefined) return { port: studio, previewPort: preview };
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return { error: `--site-url must be an absolute URL, got "${siteUrl}"` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: `--site-url must be http(s), got "${siteUrl}"` };
  return { port: studio, previewPort: preview, siteUrl: url.origin };
}

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

/** The `studio` block of typren.config.json: every key optional. */
type StudioBlock = {
  previewCommand?: string;
  style?: StyleMap;
  contentDir?: string;
  slicesDir?: string;
  sections?: Section[];
  media?: { dir: string; publicPath: string };
  previewPath?: string;
  homeSlug?: string;
  sectionRoute?: string | false;
  nestedLayouts?: string[];
};

const SECTION_KINDS = new Set(["pages", "media", "settings", "library", "collection", "custom"]);

/** A relative path that stays inside the site root. */
const insideRoot = (dir: string) => !path.isAbsolute(dir) && !path.normalize(dir).split(/[\\/]/).includes("..");

/** The first problem in the raw block, as a message naming its key. */
function validateStudioBlock(b: Record<string, unknown>): string | undefined {
  for (const key of ["contentDir", "slicesDir", "homeSlug"]) {
    if (b[key] !== undefined && (typeof b[key] !== "string" || !b[key])) return `studio.${key} must be a non-empty string`;
  }
  // The studio edits contentDir and imports slicesDir's modules, so neither may leave the site.
  for (const key of ["contentDir", "slicesDir"]) {
    if (typeof b[key] === "string" && !insideRoot(b[key])) return `studio.${key} must be a directory inside the site root: relative, without ..`;
  }
  if (b.previewPath !== undefined && (typeof b.previewPath !== "string" || !b.previewPath.startsWith("/"))) {
    return "studio.previewPath must be a path starting with /";
  }
  const route = b.sectionRoute;
  if (route !== undefined && route !== false && (typeof route !== "string" || !route.startsWith("/"))) {
    return "studio.sectionRoute must be a path starting with /, or false";
  }
  const nested = b.nestedLayouts;
  if (nested !== undefined && !(Array.isArray(nested) && nested.every((p) => typeof p === "string" && p.startsWith("/")))) {
    return "studio.nestedLayouts must be a list of paths starting with /";
  }
  if (b.sections !== undefined) {
    if (!Array.isArray(b.sections)) return "studio.sections must be an array";
    for (const [i, s] of b.sections.entries()) {
      const at = `studio.sections[${i}]`;
      if (!s || typeof s !== "object") return `${at} must be an object`;
      const { kind, label, id, element, host } = s as Record<string, unknown>;
      if (typeof kind !== "string" || !SECTION_KINDS.has(kind)) return `${at}.kind must be one of ${[...SECTION_KINDS].join(", ")}`;
      if (typeof label !== "string" || !label) return `${at}.label must be a non-empty string`;
      if (id !== undefined && typeof id !== "string") return `${at}.id must be a string`;
      if (kind === "custom" && !(typeof element === "string" && element) === (host !== true)) {
        return `${at} is a custom section: set exactly one of element (a string) or host: true`;
      }
    }
  }
  if (b.media !== undefined) {
    const { dir, publicPath } = (b.media ?? {}) as Record<string, unknown>;
    if (typeof dir !== "string" || !dir || !insideRoot(dir)) {
      return "studio.media.dir must be a directory inside the site root: relative, without ..";
    }
    if (typeof publicPath !== "string" || !publicPath.startsWith("/")) return "studio.media.publicPath must be a URL path starting with /";
  }
  return undefined;
}

/** Reads the block. No file or malformed JSON means no overrides; a present
 *  but invalid key is an error. */
function readStudioBlock(cwd: string): StudioBlock | { error: string } {
  let block: unknown;
  try {
    block = (JSON.parse(fs.readFileSync(path.join(cwd, "typren.config.json"), "utf8")) as { studio?: unknown }).studio;
  } catch {
    return {};
  }
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  const raw = block as Record<string, unknown>;
  // Style names land in a stylesheet, so they are checked here, at the read.
  const styleProblem = raw.style === undefined ? null : styleMapError(raw.style);
  const problem = styleProblem ? `studio.style: ${styleProblem}` : validateStudioBlock(raw);
  return problem ? { error: `typren.config.json: ${problem}` } : (block as StudioBlock);
}

/** The content directory the studio edits: `studio.contentDir`, else
 *  whichever of `src/content` or `content` exists, else the scaffold's
 *  choice (`src/content` when a `src/` exists). */
function resolveContentDir(cwd: string, key: string | undefined): string {
  if (key) return path.resolve(cwd, key);
  const found = ["src/content", "content"].find((d) => fs.existsSync(path.join(cwd, d)));
  return path.resolve(cwd, found ?? (fs.existsSync(path.join(cwd, "src")) ? "src/content" : "content"));
}

/**
 * The site at `cwd` as core's `LocalSite`: its `typren.config.json` `studio`
 * block (validated), content dir, media, home slug and style map. What a
 * command needs to edit the site through `createLocalSiteConfig`, without
 * the slice data the studio's editor also needs.
 */
export function resolveSite(cwd: string): LocalSite | { error: string } {
  const block = readStudioBlock(cwd);
  if ("error" in block) return block;
  return {
    siteDir: path.resolve(cwd),
    contentDir: resolveContentDir(cwd, block.contentDir),
    media: block.media,
    homeSlug: block.homeSlug,
    styleMap: block.style,
    writeBootstrap: fs.existsSync(path.join(cwd, "typren.config.json")),
  };
}

async function importExport<T>(file: string, name: string): Promise<T | undefined> {
  if (!fs.existsSync(file)) return undefined;
  return ((await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, T>)[name];
}

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
export async function buildStudioManifest(cwd: string, siteUrl: string): Promise<StudioManifest | { error: string }> {
  const site = resolveSite(cwd);
  if ("error" in site) return site;
  // resolveSite validated the block, so this read can't fail.
  const block = readStudioBlock(cwd) as StudioBlock;
  const slicesDir = block.slicesDir ? path.resolve(cwd, block.slicesDir) : path.join(path.dirname(site.contentDir), "slices");
  const rel = (p: string) => path.relative(cwd, p) || ".";
  let defaults: StudioManifest["defaults"] | undefined;
  let fieldSchema: StudioManifest["fieldSchema"];
  try {
    defaults = await importExport(path.join(slicesDir, "defaults.ts"), "defaults");
    fieldSchema = await importExport(path.join(slicesDir, "field-schema.ts"), "fieldSchema");
  } catch (e) {
    return { error: `couldn't load slice data from ${rel(slicesDir)}: ${(e as Error).message}` };
  }
  if (!defaults) {
    return {
      error:
        `no \`defaults\` export in ${rel(path.join(slicesDir, "defaults.ts"))}. Set \`studio.slicesDir\` in typren.config.json to the folder ` +
        "holding defaults.ts (a module that exports `defaults`, with no props or JSX), or run `typren init`.",
    };
  }
  const { sections, previewPath, sectionRoute, nestedLayouts } = block;
  return { ...site, siteUrl, defaults, fieldSchema, sections, previewPath, sectionRoute, nestedLayouts };
}

/** The installed `@typren/studio-local` app: the site's own dependency first, then
 *  the one beside this CLI (the monorepo workspace link). */
export function resolveStudioDir(cwd: string, from: string = fileURLToPath(import.meta.url)): string | null {
  for (const base of [path.join(cwd, "package.json"), from]) {
    try {
      return path.dirname(createRequire(base).resolve("@typren/studio-local/package.json"));
    } catch {
      // not installed from here; try the next base
    }
  }
  return null;
}

/** `next dev` bound to 127.0.0.1: the bind localAuth requires, and the
 *  development NODE_ENV it requires too.
 *  ponytail: dev mode compiles on first request. A prebuilt `next start`
 *  would need localAuth's `allowInProduction`, which it should not get. */
export function studioCommand(studioDir: string, manifest: StudioManifest, port: number): Command {
  const next = createRequire(path.join(studioDir, "package.json")).resolve("next/dist/bin/next");
  return {
    command: process.execPath,
    args: [next, "dev", "-H", "127.0.0.1", "-p", String(port)],
    options: { cwd: studioDir, env: { ...process.env, TYPREN_STUDIO: JSON.stringify(manifest) } },
  };
}

export type Command = { command: string; args: string[]; options: SpawnOptions & { env: NodeJS.ProcessEnv } };

/** How each package manager runs the `dev` script with extra arguments
 *  appended (npm alone needs the `--`), keyed by the lockfile it writes. */
const DEV_SCRIPT: [lockfile: string, run: string][] = [
  ["pnpm-lock.yaml", "pnpm run dev"],
  ["yarn.lock", "yarn run dev"],
  ["bun.lock", "bun run dev"],
  ["bun.lockb", "bun run dev"],
  ["package-lock.json", "npm run dev --"],
];

/** Next.js's flags; `{port}` is replaced with the preview port. */
const NEXT_PORT_ARGS = "-p {port} -H 127.0.0.1";

/**
 * The site's own dev command in preview mode. `typren.config.json`'s
 * `studio.previewCommand` overrides the default, which is the site's `dev`
 * script through its package manager plus Next.js's port flags, e.g.
 * `"studio": { "previewCommand": "npm run dev -- --port {port} --host 127.0.0.1" }`
 * for Astro or Vite.
 * ponytail: the template is split on whitespace, no shell quoting. Upgrade
 * to an argv array in the config if a command ever needs a quoted argument.
 */
export function previewCommand(cwd: string, port: number, studioOrigin: string): Command {
  const block = readStudioBlock(cwd);
  const template = "error" in block ? undefined : block.previewCommand;
  const run = DEV_SCRIPT.find(([lockfile]) => fs.existsSync(path.join(cwd, lockfile)))?.[1] ?? "npm run dev --";
  const [command, ...args] = (template ?? `${run} ${NEXT_PORT_ARGS}`).replaceAll("{port}", String(port)).split(/\s+/).filter(Boolean);
  return {
    command,
    args,
    options: {
      cwd,
      env: { ...process.env, TYPREN_PREVIEW: "1", TYPREN_STUDIO_ORIGIN: studioOrigin, PORT: String(port) },
      // Its own process group, so teardown reaches the dev server under the
      // package manager's shell, and the terminal's Ctrl-C reaches only us.
      detached: process.platform !== "win32",
    },
  };
}

/** Resolves true once `url` answers at all (any status), false when
 *  `stopped()` turns true or the timeout passes first. */
export async function waitForUrl(
  url: string,
  stopped: () => boolean,
  opts: { fetch: typeof fetch; timeoutMs: number; intervalMs: number }
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline && !stopped()) {
    try {
      await opts.fetch(url, { redirect: "manual" });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
    }
  }
  return false;
}

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

const OUTPUT_TAIL = 16_000;

/** Kills the child's whole process group when it has one (see
 *  `previewCommand`'s `detached`), so the dev server under `npm run` dies too. */
function stop(child: ChildProcess): void {
  try {
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/**
 * One studio session, the way `storybook dev` runs: start the site's dev
 * server in preview mode (unless `preview` is omitted, for `--site-url`),
 * wait until it answers at `siteUrl`, then run the studio in the foreground. Either one
 * exiting ends the session and stops the other; a preview crash prints its
 * captured output. Resolves with the exit code for the CLI.
 */
export async function runStudio(
  plan: { studio: Command; studioUrl: string; siteUrl: string; preview?: Command },
  deps: StudioDeps
): Promise<number> {
  const timing = { fetch: deps.fetch, timeoutMs: deps.timeoutMs ?? 120_000, intervalMs: deps.intervalMs ?? 250 };
  let preview: ChildProcess | undefined;
  let previewDone = false;
  let previewOutput = "";
  const crashReport = (code: number | null) =>
    `the preview dev server (${[plan.preview!.command, ...plan.preview!.args].join(" ")}) exited with code ${code}:\n${previewOutput}`;

  if (plan.preview) {
    preview = deps.spawn(plan.preview.command, plan.preview.args, { ...plan.preview.options, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk: Buffer | string) => {
      previewOutput = (previewOutput + chunk.toString()).slice(-OUTPUT_TAIL);
    };
    preview.stdout?.on("data", collect);
    preview.stderr?.on("data", collect);
    let earlyExit: number | null = null;
    preview.on("exit", (code) => {
      previewDone = true;
      earlyExit = code;
    });
    deps.log(`typren studio: starting the site in preview mode at ${plan.siteUrl}...`);
    if (!(await waitForUrl(plan.siteUrl, () => previewDone, timing))) {
      if (previewDone) deps.error(crashReport(earlyExit));
      else {
        stop(preview);
        deps.error(`the preview dev server didn't answer at ${plan.siteUrl} within ${timing.timeoutMs / 1000}s:\n${previewOutput}`);
      }
      return 1;
    }
  }

  const studio = deps.spawn(plan.studio.command, plan.studio.args, { ...plan.studio.options, stdio: "inherit" });
  return new Promise<number>((resolve) => {
    let previewCrashed = false;
    let signalled = false;
    const stopPreview = () => {
      if (preview && !previewDone) stop(preview);
    };
    const onSignal = (signal: NodeJS.Signals) => {
      signalled = true;
      stopPreview();
      studio.kill(signal);
    };
    deps.signals.on("SIGINT", onSignal);
    deps.signals.on("SIGTERM", onSignal);
    preview?.on("exit", (code) => {
      if (signalled || previewCrashed) return;
      previewCrashed = true;
      deps.error(crashReport(code));
      studio.kill("SIGTERM");
    });
    studio.on("exit", (code) => {
      deps.signals.off("SIGINT", onSignal);
      deps.signals.off("SIGTERM", onSignal);
      stopPreview();
      resolve(previewCrashed ? 1 : (code ?? (signalled ? 0 : 1)));
    });
    void waitForUrl(plan.studioUrl, () => false, timing).then((up) => {
      if (up) deps.log(`\ntypren studio: ${plan.studioUrl}\n  previewing ${plan.siteUrl}`);
    });
  });
}
