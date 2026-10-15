import DOMPurify, { type WindowLike } from "dompurify";
import { JSDOM } from "jsdom";
import type { Purifier } from "../no-html";

let purifier: Purifier | undefined;

/**
 * DOMPurify bound to a jsdom window, for running `assertNoHtml` (or the OTA client's gate) in Node,
 * where there is no `window`. Lives under `build` so jsdom never reaches a browser bundle; built once
 * and reused because constructing a JSDOM has real startup cost.
 */
export function createNodePurifier(): Purifier {
  purifier ??= DOMPurify(new JSDOM("").window as unknown as WindowLike);
  return purifier;
}
