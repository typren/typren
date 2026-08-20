import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Anonymous, opt-out CLI usage telemetry, modeled on the Next.js / Nuxt /
 * Astro precedent: it only ever fires from a command the user deliberately
 * ran, announces itself on first run, and is one command (or env var) away
 * from off. This module is intentionally standalone: importing it must do
 * nothing observable (no postinstall hook, no import-time network or fs
 * writes), and every exported function is safe to call from the CLI's
 * command path without awaiting or wrapping it.
 *
 * This file must never be imported from `@typren/core`: that package runs
 * inside consumers' production applications, and a dependency making its own
 * outbound network calls there would fail security review for regulated
 * consumers. Telemetry belongs to the CLI a human ran, not to library code.
 */

interface TelemetryState {
  installId: string;
  noticeShown: boolean;
  /** Explicit persisted choice from `setEnabled`. Absent = no preference set. */
  enabled?: boolean;
}

interface TelemetryPayload {
  installId: string;
  cliVersion: string;
  nodeVersion: string;
  platform: string;
  command: string;
}

const STATE_FILE_NAME = "telemetry.json";

const NOTICE =
  "Typren collects anonymous CLI usage telemetry: a random install id, the CLI and Node versions, " +
  "your OS platform, and the command name. No file paths, project or repo names, file content, or " +
  "other personal data is ever sent. Run `typren telemetry off`, or set DO_NOT_TRACK=1, to opt out.";

/** Beacons that can't connect or respond within this window are abandoned. */
const REQUEST_TIMEOUT_MS = 1000;

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "typren");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Preferences", "typren");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "typren");
  }
  return path.join(os.homedir(), ".config", "typren");
}

function stateFilePath(): string {
  return path.join(configDir(), STATE_FILE_NAME);
}

function writeState(state: TelemetryState): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(stateFilePath(), JSON.stringify(state), "utf8");
  } catch {
    // Read-only config dir, sandboxed environment, etc. Telemetry state just
    // doesn't persist for this run; see the ponytail note in readState().
  }
}

function readState(): TelemetryState {
  try {
    const raw = fs.readFileSync(stateFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TelemetryState> | null;
    if (parsed && typeof parsed.installId === "string") {
      const state: TelemetryState = { installId: parsed.installId, noticeShown: parsed.noticeShown === true };
      if (typeof parsed.enabled === "boolean") state.enabled = parsed.enabled;
      return state;
    }
  } catch {
    // Missing file, unreadable config dir, or corrupt JSON: fall through to
    // a fresh default below rather than letting any of this reach the CLI.
  }
  const fresh: TelemetryState = { installId: randomUUID(), noticeShown: false };
  // ponytail: best-effort persist. If the config dir stays unwritable, every
  // future call in a fresh process mints another id instead of reusing one;
  // fine for a coarse usage counter. Upgrade to an in-memory fallback keyed
  // by config path if that ever needs to be stable within one run too.
  writeState(fresh);
  return fresh;
}

const TRUTHY = ["1", "true"];
const FALSY = ["0", "false"];

function envMatches(value: string | undefined, matches: string[]): boolean {
  return value !== undefined && matches.includes(value.toLowerCase());
}

/** Whether telemetry should fire at all right now, folding in every opt-out source. */
export function isEnabled(): boolean {
  // CI runs aren't a human deliberately invoking the CLI, and they would
  // badly skew install/usage counts, so any non-empty CI env disables this,
  // no value check needed (most CI providers just set it to a truthy string).
  if (process.env.CI) return false;
  if (envMatches(process.env.DO_NOT_TRACK, TRUTHY)) return false;
  if (envMatches(process.env.TYPREN_TELEMETRY, FALSY)) return false;
  return readState().enabled !== false;
}

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
export function firstRunNotice(): string | null {
  if (!isEnabled() || !process.env.TYPREN_TELEMETRY_URL) return null;
  const state = readState();
  if (state.noticeShown) return null;
  writeState({ ...state, noticeShown: true });
  return NOTICE;
}

/** Persists an explicit opt-in/opt-out choice, e.g. from `typren telemetry on|off`. */
export function setEnabled(on: boolean): void {
  writeState({ ...readState(), enabled: on });
}

function readCliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Fire-and-forget usage beacon. Never awaited by callers, never throws, and
 * never delays the command it's called from: with no `TYPREN_TELEMETRY_URL`
 * set there is no collector to send to, so this does nothing at all, not
 * even a DNS lookup. That is deliberate: the module ships inert and starts
 * reporting only once a real endpoint exists, never a hardcoded placeholder.
 */
export function record(command: string): void {
  if (!isEnabled()) return;
  const endpoint = process.env.TYPREN_TELEMETRY_URL;
  if (!endpoint) return;

  try {
    const target = new URL(endpoint);
    const state = readState();
    const payload: TelemetryPayload = {
      installId: state.installId,
      cliVersion: readCliVersion(),
      nodeVersion: process.version,
      platform: process.platform,
      command,
    };
    const body = JSON.stringify(payload);
    const transport = target.protocol === "https:" ? https : http;

    // A plain `fetch()` here would still leave the process waiting on the
    // TCP connect (which can hang far longer than REQUEST_TIMEOUT_MS on a
    // dead host) before it exits naturally, since the CLI never calls
    // `process.exit()`. Using the low-level transport gets us a socket to
    // unref and a `timeout` option to bound that wait, so a slow or dead
    // collector can never hold the command's process open.
    //
    // The collector sees this request's source IP regardless of what's in
    // the payload below. That IP is personal data under GDPR even though the
    // payload itself is anonymous, so whoever builds the collector must not
    // log it.
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => res.resume(), // drain and discard; the response is never inspected.
    );
    req.on("error", () => {}); // dead collector, DNS failure, refused connection: never throw for this.
    req.on("timeout", () => req.destroy());
    req.on("socket", (socket) => socket.unref());
    req.end(body);
  } catch {
    // Malformed TYPREN_TELEMETRY_URL or anything else unexpected. Telemetry
    // is best-effort and must never be the reason a command fails.
  }
}
