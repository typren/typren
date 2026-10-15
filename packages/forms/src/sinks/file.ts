import type { FileSinkConfig, FormSink } from "./types";

// Matches the handler's default body cap: a line this size can only come
// from a schema with raised maxLength fields, not from an ordinary bot flood,
// so rejecting rather than truncating keeps the JSONL file parseable.
const MAX_LINE_BYTES = 64 * 1024;

/**
 * JSONL append: one Submission per line. The reference sink for local
 * development and tests. node:fs is imported inside deliver so merely
 * loading the sinks entry stays possible on edge runtimes that have no
 * node builtins; only actually delivering to a file needs them.
 */
export function createFileSink(config: FileSinkConfig): FormSink {
  return {
    type: "file",
    async deliver(submission) {
      const line = `${JSON.stringify(submission)}\n`;
      // TextEncoder, not Buffer: this check runs before the node:fs import
      // below, and the file sink is still loaded (just never delivered to) on
      // edge runtimes that have no Buffer global.
      if (new TextEncoder().encode(line).byteLength > MAX_LINE_BYTES) {
        return { ok: false, detail: "submission too large for file sink" };
      }
      const { appendFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.path), { recursive: true });
      await appendFile(config.path, line, "utf8");
      return { ok: true };
    },
  };
}
