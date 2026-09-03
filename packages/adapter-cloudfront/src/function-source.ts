import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The canonical viewer-request function's exact source
 *  (redirects.function.js), read fresh off disk so `bootstrap`/tests always
 *  see whatever this installed package version carries, never a stale copy
 *  baked in at some other build step. Resolved via `node:url`'s own
 *  fileURLToPath (not a bare `new URL(...)`, which a jsdom test environment's
 *  polyfilled global URL mishandles for the `file:` scheme readFileSync needs). */
export function readFunctionSource(): string {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "redirects.function.js"), "utf8");
}
