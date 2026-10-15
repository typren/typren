import { defaultEnv, resolveEnvRef } from "./env";
import type { FormSink, SinkRuntime, WebhookSinkConfig } from "./types";

export function createWebhookSink(config: WebhookSinkConfig, runtime: SinkRuntime = {}): FormSink {
  return {
    type: "webhook",
    async deliver(submission) {
      const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
      const env = runtime.env ?? defaultEnv();
      const headers: Record<string, string> = { "content-type": "application/json" };
      for (const [name, value] of Object.entries(config.headers ?? {})) {
        headers[name] = resolveEnvRef(value, env);
      }
      // A configured URL is arbitrary and often user-supplied; manual redirect
      // handling stops a 3xx response from silently resending the submission
      // (with its headers, including any resolved secret) to a different,
      // attacker-controlled host.
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(submission),
        redirect: "manual",
      });
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return { ok: false, detail: `webhook redirected (${response.status || "opaque"})` };
      }
      return response.ok ? { ok: true } : { ok: false, detail: `webhook responded ${response.status}` };
    },
  };
}
