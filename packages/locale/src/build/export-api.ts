import { unzipSync, strFromU8 } from "fflate";
import type { Catalog } from "../types";
import { UNSAFE_KEYS } from "../delta";
import { resolveConfigEnv } from "./config";
import { normalizeLocaleKey } from "./provider";
import type { LocaleSourceProvider } from "./provider";
import { exportApiPresets } from "./presets";

/**
 * Config for the generic TMS bundle-export source: create an export job,
 * optionally poll it to completion, then fetch and parse the resulting
 * bundle. `preset` (see presets.ts) fills every field below with one TMS's
 * known shape; anything also set explicitly here overrides that preset's
 * value for that field. This is the FIXED CONTRACT other tooling (the CLI)
 * codes against: changing a field here is a breaking change for it.
 */
export interface ExportApiSourceConfig {
  type: "export-api";
  /** Name of a registered preset (see presets.ts) supplying defaults for every field below. */
  preset?: string;
  baseUrl?: string;
  projectId: string;
  /** A `"${ENV_VAR}"` reference, resolved against `process.env` at load time (see config.ts). Never a literal secret. */
  token: string;
  /** Default `{ header: "Authorization", scheme: "Bearer" }`. */
  auth?: { header?: string; scheme?: string };
  create?: { method?: "GET" | "POST"; path?: string; body?: Record<string, unknown> };
  /** Omit entirely for a synchronous API: the create response IS the bundle or carries its URL. */
  poll?: {
    /** Dot-path to the job id in the create response. Required when `poll` is set. */
    idPath?: string;
    /** Poll endpoint path; any `{...}` placeholder is filled with the job id. */
    path?: string;
    statusPath?: string;
    doneValues?: string[];
    failValues?: string[];
    /** Dot-path to the bundle URL in the FINAL poll response. Falls back to `response.urlPath` when unset. */
    urlPath?: string;
    intervalMs?: number;
    timeoutMs?: number;
  };
  /** Where the bundle URL lives (create response, or final poll response when no `poll.urlPath`), dot-path. */
  response?: { urlPath?: string };
  /** "zip": fflate in-memory unzip of per-locale `<locale>.json` files. "json": one document keyed by locale. Default "json". */
  bundle?: "zip" | "json";
  /**
   * Where a zip entry's locale lives: "filename" (default) reads it from the
   * entry name (`en-US.json`); "dir" reads the first path segment
   * (`en/strings.json` -> `en`), for TMS exports shaped as one folder per
   * locale. In "dir" mode multiple files under one locale folder are merged
   * top-level-shallow in sorted entry order (a later file wins a colliding
   * namespace key).
   */
  zipLocaleFrom?: "filename" | "dir";
  langMap?: Record<string, string>;
  /**
   * Where the bundle URL may point, besides the create endpoint's own origin (always allowed). The
   * URL comes from the TMS response, so without this list a hostile or spoofed response could aim the
   * fetch anywhere. https only. Each entry is an exact origin (`"https://exports.tms.example"`), an
   * origin plus a path prefix ending in "/" (`"https://s3.example/bucket/"`, for shared storage hosts),
   * or a host suffix (`"https://*.downloads.tms.example"`, any subdomain).
   */
  bundleOrigins?: string[];
}

export interface ExportApiProviderOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Resolved config: every field preset-or-overridden into its final value, `type`/`preset` dropped. */
interface ResolvedConfig {
  baseUrl?: string;
  projectId: string;
  token: string;
  auth?: { header?: string; scheme?: string };
  create?: { method?: "GET" | "POST"; path?: string; body?: Record<string, unknown> };
  poll?: ExportApiSourceConfig["poll"];
  response?: { urlPath?: string };
  bundle: "zip" | "json";
  zipLocaleFrom: "filename" | "dir";
  langMap?: Record<string, string>;
  bundleOrigins: string[];
}

function mergeShallow<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

function resolveConfig(config: ExportApiSourceConfig): ResolvedConfig {
  const preset = config.preset ? exportApiPresets[config.preset] : undefined;
  if (config.preset && !preset) {
    const known = Object.keys(exportApiPresets).join(", ") || "none registered";
    throw new Error(`export-api: unknown preset "${config.preset}" (known presets: ${known})`);
  }
  return {
    baseUrl: config.baseUrl ?? preset?.baseUrl,
    projectId: config.projectId,
    token: config.token,
    auth: mergeShallow(preset?.auth, config.auth),
    create: mergeShallow(preset?.create, config.create),
    poll: mergeShallow(preset?.poll, config.poll),
    response: mergeShallow(preset?.response, config.response),
    bundle: config.bundle ?? preset?.bundle ?? "json",
    zipLocaleFrom: config.zipLocaleFrom ?? preset?.zipLocaleFrom ?? "filename",
    langMap: config.langMap,
    bundleOrigins: config.bundleOrigins ?? preset?.bundleOrigins ?? [],
  };
}

const WILDCARD_HOST = "https://*.";

/** Whether `url` matches one `bundleOrigins` entry; a malformed entry throws, since it is config, not input. */
function matchesBundleOrigin(url: URL, entry: string): boolean {
  if (entry.startsWith(WILDCARD_HOST)) {
    // Dot-anchored: ".downloads.crowdin.com" never matches "evildownloads.crowdin.com".
    const suffix = `.${entry.slice(WILDCARD_HOST.length).toLowerCase()}`;
    if (!/^(\.[a-z0-9-]+){2,}$/.test(suffix)) throw new Error(`export-api: bundleOrigins entry "${entry}" is not a valid host suffix`);
    return url.protocol === "https:" && url.port === "" && url.hostname.endsWith(suffix);
  }
  const allowed = new URL(entry);
  if (allowed.protocol !== "https:") throw new Error(`export-api: bundleOrigins entry "${entry}" must be https`);
  // A shared host (path-style S3) is only safe narrowed to one bucket, so a path must end in "/" to
  // stop "/lokalise-assets" from also admitting "/lokalise-assets-evil".
  if (!allowed.pathname.endsWith("/")) throw new Error(`export-api: bundleOrigins path prefix in "${entry}" must end in "/"`);
  return url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname);
}

function assertBundleOrigin(bundleUrl: string, createUrl: string, bundleOrigins: string[]): void {
  let url: URL;
  try {
    url = new URL(bundleUrl, createUrl);
  } catch {
    throw new Error(`export-api: bundle URL "${bundleUrl}" is not a valid URL`);
  }
  if (url.origin === new URL(createUrl).origin || bundleOrigins.some((entry) => matchesBundleOrigin(url, entry))) return;
  throw new Error(
    `export-api: bundle URL "${url.origin}${url.pathname}" is not allowed (create origin or bundleOrigins: ${bundleOrigins.join(", ") || "none"}); add its origin to "bundleOrigins" if this TMS serves exports from it`,
  );
}

// A zip bomb inflates a few KB into gigabytes in memory, and a real TMS export is nowhere near either cap.
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

function unzipCapped(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  const entries = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (++count > MAX_ZIP_ENTRIES) throw new Error(`export-api: zip bundle has more than ${MAX_ZIP_ENTRIES} entries`);
      if (total > MAX_ZIP_BYTES) throw new Error(`export-api: zip bundle inflates past ${MAX_ZIP_BYTES} bytes`);
      return true;
    },
  });
  // The declared sizes come from the archive itself; recheck what was actually inflated.
  const actual = Object.values(entries).reduce((sum, data) => sum + data.length, 0);
  if (actual > MAX_ZIP_BYTES) throw new Error(`export-api: zip bundle inflates past ${MAX_ZIP_BYTES} bytes`);
  return entries;
}

const ENV_REF_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;

/** Resolves `token` via config.ts's `${ENV_VAR}` mechanism. Rejects a literal-looking token so a secret never lands in a committed config file. */
function resolveToken(token: string): string {
  if (!ENV_REF_PATTERN.test(token)) {
    throw new Error('export-api: "token" must be a "${ENV_VAR}" reference, not a literal value (set it via an environment variable)');
  }
  return resolveConfigEnv({ token }, process.env).token;
}

/** Dot-path reader, prototype-pollution-safe: any `__proto__`/`constructor`/`prototype` segment aborts the walk and returns `undefined` rather than following it. */
function readDotPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const part of path.split(".")) {
    if (UNSAFE_KEYS.has(part)) return undefined;
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  let base = baseUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base + (path.startsWith("/") ? path : `/${path}`);
}

function fillProjectId(path: string, projectId: string): string {
  return path.replace(/\{projectId\}/g, projectId);
}

/** Poll paths carry a single dynamic segment (the job id) under whatever placeholder name the TMS uses (e.g. "{processId}"); filling every `{...}` token covers it without needing to know that name. */
function fillPollId(path: string, id: string): string {
  return path.replace(/\{[^}]+\}/g, id);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function authHeader(resolved: ResolvedConfig, token: string): [string, string] {
  const headerName = resolved.auth?.header ?? "Authorization";
  const scheme = resolved.auth ? resolved.auth.scheme : "Bearer";
  return [headerName, scheme ? `${scheme} ${token}` : token];
}

async function requestJson(fetchImpl: typeof fetch, url: string, init: RequestInit, phase: string): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`export-api: ${phase} request failed (${response.status} ${response.statusText}): ${url}`);
  }
  return response.json();
}

/**
 * Polls `poll.path` until its status reaches a done/fail value or `poll.timeoutMs`
 * elapses. Returns the final poll response, or `undefined` when no `poll` is
 * configured (synchronous API: the caller already has everything it needs from
 * the create response).
 */
async function pollUntilDone(
  fetchImpl: typeof fetch,
  resolved: ResolvedConfig,
  headers: Record<string, string>,
  createJson: unknown,
): Promise<unknown> {
  const poll = resolved.poll;
  if (!poll) return undefined;
  if (!poll.idPath) throw new Error('export-api: poll.idPath is required when "poll" is configured');
  if (!poll.path) throw new Error('export-api: poll.path is required when "poll" is configured');
  if (!poll.statusPath) throw new Error('export-api: poll.statusPath is required when "poll" is configured');
  if (!poll.doneValues?.length) throw new Error('export-api: poll.doneValues is required when "poll" is configured');

  const id = readDotPath(createJson, poll.idPath);
  if (typeof id !== "string" || !id) {
    throw new Error(`export-api: create response has no poll id at "${poll.idPath}"`);
  }

  const pollUrl = joinUrl(resolved.baseUrl, fillPollId(fillProjectId(poll.path, resolved.projectId), id));
  const intervalMs = poll.intervalMs ?? 1000;
  const timeoutMs = poll.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const pollJson = await requestJson(fetchImpl, pollUrl, { method: "GET", headers }, "poll");
    const status = readDotPath(pollJson, poll.statusPath);

    if (typeof status === "string" && poll.failValues?.includes(status)) {
      throw new Error(`export-api: poll failed, status "${status}" (job "${id}")`);
    }
    if (typeof status === "string" && poll.doneValues.includes(status)) {
      return pollJson;
    }
    // Some TMS download endpoints double as the poll endpoint: while the job
    // runs they answer with a status body, and on completion they answer with
    // the bundle URL and no status field at all. A resolvable URL is therefore
    // also a completion signal.
    if (status === undefined) {
      const urlPath = poll.urlPath ?? resolved.response?.urlPath;
      if (urlPath && typeof readDotPath(pollJson, urlPath) === "string") {
        return pollJson;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`export-api: poll timed out after ${timeoutMs}ms, last status "${String(status)}" (job "${id}")`);
    }
    await sleep(intervalMs);
  }
}

/**
 * A TMS can export a locale that is not BCP-47 at all (Lokalise's custom languages export as
 * `custom_1`): skip it with a warning rather than fail the whole pull. A name carrying a path
 * separator or dot still throws, so a traversal-shaped entry stays a loud failure.
 */
function bundleLocaleKey(name: string, langMap: Record<string, string> | undefined): string | undefined {
  try {
    return normalizeLocaleKey(name, langMap);
  } catch (e) {
    if (/[./\\]/.test(langMap?.[name] ?? name)) throw e;
    console.warn(`export-api: skipping bundle locale "${name}": not a BCP-47 tag (map it with langMap to keep it)`);
    return undefined;
  }
}

function parseZipBundle(
  bytes: Uint8Array,
  localeFrom: "filename" | "dir",
  langMap: Record<string, string> | undefined,
): Record<string, Catalog> {
  const entries = unzipCapped(bytes);
  const catalogs: Record<string, Catalog> = {};
  for (const [filename, contents] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    if (filename.endsWith("/")) continue; // directory marker
    if (!filename.endsWith(".json")) {
      throw new Error(`export-api: zip entry "${filename}" is not a .json file`);
    }
    const rawName = localeFrom === "dir" ? filename.split("/")[0]! : filename.slice(0, -".json".length);
    if (localeFrom === "dir" && !filename.includes("/")) {
      throw new Error(`export-api: zip entry "${filename}" has no locale folder (zipLocaleFrom is "dir")`);
    }
    const catalog = JSON.parse(strFromU8(contents)) as Catalog;
    const key = bundleLocaleKey(rawName, langMap);
    if (!key) continue;
    catalogs[key] = catalogs[key] ? { ...catalogs[key], ...catalog } : catalog;
  }
  return catalogs;
}

function parseJsonBundle(doc: unknown, langMap: Record<string, string> | undefined): Record<string, Catalog> {
  const catalogs: Record<string, Catalog> = {};
  for (const [name, catalog] of Object.entries(doc as Record<string, unknown>)) {
    const key = bundleLocaleKey(name, langMap);
    if (!key) continue;
    catalogs[key] = catalog as Catalog;
  }
  return catalogs;
}

/**
 * Generic TMS bundle-export `LocaleSourceProvider`: create an export job over
 * HTTP, optionally poll it to completion, then fetch and parse the resulting
 * bundle into catalogs keyed by canonical locale. `preset` fills the shape of
 * one known TMS (see presets.ts); every field can still be overridden.
 */
export function createExportApiSourceProvider(
  config: ExportApiSourceConfig,
  options: ExportApiProviderOptions = {},
): LocaleSourceProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    type: "export-api",

    async loadSource(): Promise<Record<string, Catalog>> {
      const resolved = resolveConfig(config);
      const token = resolveToken(resolved.token);
      const [headerName, headerValue] = authHeader(resolved, token);
      const headers: Record<string, string> = { [headerName]: headerValue };

      const createMethod = resolved.create?.method ?? "POST";
      const createUrl = joinUrl(resolved.baseUrl, fillProjectId(resolved.create?.path ?? "", resolved.projectId));
      const createInit: RequestInit = { method: createMethod, headers };
      if (createMethod !== "GET" && resolved.create?.body) {
        headers["Content-Type"] = "application/json";
        createInit.body = JSON.stringify(resolved.create.body);
      }
      const createJson = await requestJson(fetchImpl, createUrl, createInit, "create");

      const pollJson = await pollUntilDone(fetchImpl, resolved, headers, createJson);
      const urlSource = pollJson ?? createJson;
      const urlPath = resolved.poll?.urlPath ?? resolved.response?.urlPath;

      let bundleDoc: unknown;
      if (urlPath) {
        const bundleUrl = readDotPath(urlSource, urlPath);
        if (typeof bundleUrl !== "string" || !bundleUrl) {
          throw new Error(`export-api: could not read bundle URL at "${urlPath}"`);
        }
        assertBundleOrigin(bundleUrl, createUrl, resolved.bundleOrigins);
        // Manual redirect handling: bundleOrigins only vets the URL above, so
        // letting fetch follow a redirect would hand the bundle request (and
        // its auth header) to whatever a 3xx response names, unvetted.
        const bundleResponse = await fetchImpl(bundleUrl, { redirect: "manual" });
        if (bundleResponse.type === "opaqueredirect" || (bundleResponse.status >= 300 && bundleResponse.status < 400)) {
          throw new Error(`export-api: bundle URL "${bundleUrl}" redirected (${bundleResponse.status || "opaque"}); add the redirect target's origin to bundleOrigins and configure it directly`);
        }
        if (!bundleResponse.ok) {
          throw new Error(`export-api: bundle request failed (${bundleResponse.status} ${bundleResponse.statusText}): ${bundleUrl}`);
        }
        bundleDoc = resolved.bundle === "zip" ? new Uint8Array(await bundleResponse.arrayBuffer()) : await bundleResponse.json();
      } else {
        if (resolved.bundle === "zip") {
          throw new Error('export-api: "zip" bundles require response.urlPath (or poll.urlPath) to locate the bundle');
        }
        bundleDoc = urlSource; // synchronous API: the create/poll response body IS the bundle
      }

      return resolved.bundle === "zip"
        ? parseZipBundle(bundleDoc as Uint8Array, resolved.zipLocaleFrom, resolved.langMap)
        : parseJsonBundle(bundleDoc, resolved.langMap);
    },
  };
}
