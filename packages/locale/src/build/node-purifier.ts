import DOMPurify, { type WindowLike } from "dompurify";
import { createRequire } from "node:module";
import type { JSDOM as JSDOMType } from "jsdom";
import type { Purifier } from "../no-html";

let purifier: Purifier | undefined;

/**
 * DOMPurify bound to a jsdom window, for running `assertNoHtml` (or the OTA client's gate) in Node,
 * where there is no `window`. Lives under `build` so jsdom never reaches a browser bundle; built once
 * and reused because constructing a JSDOM has real startup cost.
 */
export function createNodePurifier(): Purifier {
  if (!purifier) {
    // ponytail: jsdom is required lazily because loading it replaces Node 22's env-proxy fetch dispatcher, so it must
    // load after the CLI's network fetches; a source that fetches after the first purify would bypass the proxy.
    const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: typeof JSDOMType };
    purifier = DOMPurify(new JSDOM("").window as unknown as WindowLike);
  }
  return purifier;
}
