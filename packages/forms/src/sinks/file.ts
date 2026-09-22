import type { FileSinkConfig, FormSink } from "./types";

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
      const { appendFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.path), { recursive: true });
      await appendFile(config.path, `${JSON.stringify(submission)}\n`, "utf8");
      return { ok: true };
    },
  };
}
