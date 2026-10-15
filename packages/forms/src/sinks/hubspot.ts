import { DEFAULT_SINK_TIMEOUT_MS, defaultEnv, requireEnvRef } from "./env";
import type { FormSink, HubspotSinkConfig, SinkRuntime } from "./types";

const HUTK_COOKIE = "hubspotutk";

/** Reads one cookie by name off a request's Cookie header, or undefined if absent.
 *  hubspotutk is an opaque token HubSpot's own script sets verbatim, never
 *  percent-encoded, so no decodeURIComponent is needed here. */
function readCookie(request: Request | undefined, name: string): string | undefined {
  const header = request?.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/**
 * HubSpot Forms submit API v3. The anonymous endpoint needs no credential;
 * an accessToken (a "${VAR}" reference to a private-app token) switches to
 * the authenticated /secure/ variant of the same API.
 */
export function createHubspotSink(config: HubspotSinkConfig, runtime: SinkRuntime = {}): FormSink {
  return {
    type: "hubspot",
    async deliver(submission, _schema, request) {
      const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
      const env = runtime.env ?? defaultEnv();
      const segment = config.accessToken ? "integration/secure/submit" : "integration/submit";
      const url = `https://api.hsforms.com/submissions/v3/${segment}/${encodeURIComponent(config.portalId)}/${encodeURIComponent(config.formGuid)}`;

      // The hutk identifies a visitor to HubSpot: it must be the hubspotutk
      // cookie the browser already holds, read here off the request, never a
      // value the submitter put in the form body, or anyone could submit
      // under an arbitrary tracking identity. `hutkField` only still gates
      // whether to attach it and is excluded from the mapped fields below, a
      // legacy hidden field that no longer carries the value itself.
      const fields = Object.entries(submission.fields)
        .filter(([name]) => name !== config.hutkField)
        .map(([name, value]) => ({ name, value: typeof value === "boolean" ? String(value) : value }));

      const hutk = config.hutkField ? readCookie(request, HUTK_COOKIE) : undefined;
      const context = {
        ...(hutk ? { hutk } : {}),
        ...(submission.meta.page ? { pageUri: submission.meta.page } : {}),
      };

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.accessToken) {
        headers.authorization = `Bearer ${requireEnvRef(config.accessToken, env, "hubspot accessToken")}`;
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fields,
          ...(Object.keys(context).length > 0 ? { context } : {}),
        }),
        signal: AbortSignal.timeout(runtime.timeoutMs ?? DEFAULT_SINK_TIMEOUT_MS),
      });
      return response.ok ? { ok: true } : { ok: false, detail: `hubspot responded ${response.status}` };
    },
  };
}
