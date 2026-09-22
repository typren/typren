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
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(submission),
      });
      return response.ok ? { ok: true } : { ok: false, detail: `webhook responded ${response.status}` };
    },
  };
}
