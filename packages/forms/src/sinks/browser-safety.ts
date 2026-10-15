import type { SinkConfig } from "./types";

// Sinks that can never be browser-safe regardless of config: google-sheets
// always carries a bearer token, and file writes via node:fs, which a
// browser has no access to at all.
const SERVER_ONLY_TYPES: ReadonlySet<SinkConfig["type"]> = new Set(["google-sheets", "file"]);

// A "${...}" shape is refused outright, resolvable or not: a value that
// looks like an env reference has no business reaching a browser bundle,
// since this check runs on the literal config, not a resolved value. No
// SinkConfig field is ever an array (the one nested shape is `headers`, a
// flat Record<string, string>), so only strings and plain objects recurse.
function hasEnvRefShape(value: unknown): boolean {
  if (typeof value === "string") return value.includes("${");
  if (value && typeof value === "object") return Object.values(value).some(hasEnvRefShape);
  return false;
}

/**
 * Throws unless `config` is safe to deliver straight from the browser. A
 * credential baked into a client bundle is as public as text on the page, so
 * this fails closed: server-only sink types are refused outright, and any
 * other sink is refused the moment any config value contains a "${...}"
 * reference (the webhook sink's `headers`, the hubspot sink's `accessToken`).
 * Delivery-time secrets never reach the call that would decide this, so the
 * check has to run on the literal config shape instead.
 */
export function assertBrowserSafeSinkConfig(config: SinkConfig): void {
  if (SERVER_ONLY_TYPES.has(config.type)) {
    throw new Error(`forms: sink type "${config.type}" is server-only and cannot be delivered from the browser`);
  }
  if (hasEnvRefShape(config)) {
    throw new Error(`forms: sink config for "${config.type}" contains a "\${...}" reference and is server-only`);
  }
}
