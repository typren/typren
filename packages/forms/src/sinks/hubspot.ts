import { defaultEnv, requireEnvRef } from "./env";
import type { FormSink, HubspotSinkConfig, SinkRuntime } from "./types";

/**
 * HubSpot Forms submit API v3. The anonymous endpoint needs no credential;
 * an accessToken (a "${VAR}" reference to a private-app token) switches to
 * the authenticated /secure/ variant of the same API.
 */
export function createHubspotSink(config: HubspotSinkConfig, runtime: SinkRuntime = {}): FormSink {
  return {
    type: "hubspot",
    async deliver(submission) {
      const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
      const env = runtime.env ?? defaultEnv();
      const segment = config.accessToken ? "integration/secure/submit" : "integration/submit";
      const url = `https://api.hsforms.com/submissions/v3/${segment}/${encodeURIComponent(config.portalId)}/${encodeURIComponent(config.formGuid)}`;

      const fields = Object.entries(submission.fields)
        .filter(([name]) => name !== config.hutkField)
        .map(([name, value]) => ({ name, value: typeof value === "boolean" ? String(value) : value }));

      const hutk = config.hutkField ? submission.fields[config.hutkField] : undefined;
      const context = {
        ...(typeof hutk === "string" && hutk !== "" ? { hutk } : {}),
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
      });
      return response.ok ? { ok: true } : { ok: false, detail: `hubspot responded ${response.status}` };
    },
  };
}
