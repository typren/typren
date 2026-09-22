import { createFileSink } from "./file";
import { createGoogleSheetsSink } from "./google-sheets";
import { createHubspotSink } from "./hubspot";
import type { FormSink, SinkConfig, SinkRuntime } from "./types";
import { createWebhookSink } from "./webhook";

export type {
  FormSink,
  SinkResult,
  SinkConfig,
  SinkRuntime,
  WebhookSinkConfig,
  HubspotSinkConfig,
  GoogleSheetsSinkConfig,
  FileSinkConfig,
} from "./types";
export type { EnvRecord } from "./env";
export { resolveEnvRef, requireEnvRef } from "./env";
export { createWebhookSink } from "./webhook";
export { createHubspotSink } from "./hubspot";
export { createGoogleSheetsSink } from "./google-sheets";
export { createFileSink } from "./file";

function isSink(value: SinkConfig | FormSink): value is FormSink {
  return typeof (value as FormSink).deliver === "function";
}

/**
 * Resolves a FormSink from a config or an already-built sink (passed straight
 * through: the escape hatch for tests and for consumers wiring their own
 * vendor). The switch is the whole registry: a new vendor gets one config
 * shape in types.ts and one more case here.
 */
export function resolveSink(sink: SinkConfig | FormSink, runtime: SinkRuntime = {}): FormSink {
  if (isSink(sink)) return sink;
  switch (sink.type) {
    case "webhook":
      return createWebhookSink(sink, runtime);
    case "hubspot":
      return createHubspotSink(sink, runtime);
    case "google-sheets":
      return createGoogleSheetsSink(sink, runtime);
    case "file":
      return createFileSink(sink);
    default: {
      const unknownType: string = (sink as { type: string }).type;
      throw new Error(`resolveSink: unknown sink type "${unknownType}"`);
    }
  }
}
