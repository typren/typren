import { defaultEnv, requireEnvRef } from "./env";
import type { FormSink, GoogleSheetsSinkConfig, SinkRuntime } from "./types";

/**
 * One row per submission via Sheets API v4 values.append, raw REST with no
 * Google SDK. Column order is the schema's field order with a leading
 * timestamp, so the sheet's header row can be written once from the schema
 * and stays meaningful as long as fields are only appended.
 */
export function createGoogleSheetsSink(config: GoogleSheetsSinkConfig, runtime: SinkRuntime = {}): FormSink {
  return {
    type: "google-sheets",
    async deliver(submission, schema) {
      const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
      const env = runtime.env ?? defaultEnv();
      const range = config.range ?? "A1";
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}` +
        `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;

      const row: Array<string | boolean> = [
        submission.meta.submittedAt,
        ...schema.fields.map((field) => submission.fields[field.name] ?? ""),
      ];

      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${requireEnvRef(config.token, env, "google-sheets token")}`,
        },
        body: JSON.stringify({ values: [row] }),
      });
      return response.ok ? { ok: true } : { ok: false, detail: `sheets responded ${response.status}` };
    },
  };
}
