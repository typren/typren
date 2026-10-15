import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createBareUrlStaticHostRoutingContractSuite, type StaticHostOutcome } from "@typren/contract-tests";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "redirects-bare-url.function.js"), "utf8");

type EdgeResult =
  | { uri: string }
  | { statusCode: number; statusDescription: string; headers: { location: { value: string } } };

/** Runs the committed bare-URL CloudFront function the way the edge would;
 *  see redirects.function.test.ts's own `run` for the stand-in rationale. */
type EdgeQueryString = Record<string, { value: string; multiValue?: { value: string }[] }>;

function run(
  uri: string,
  redirects: Record<string, string> = {},
  kvsGet?: (key: string) => Promise<string>,
  querystring: EdgeQueryString = {}
): Promise<EdgeResult> {
  const get =
    kvsGet ??
    (async (key: string) => {
      const value = redirects[key];
      if (value === undefined) throw new Error(`KeyNotFound: ${key}`);
      return value;
    });
  const body = source.replace(/^import .*\n/m, "");
  const handler = new Function("cf", `${body}\nreturn handler;`)({ kvs: () => ({ get }) }) as (e: {
    request: { uri: string; querystring: EdgeQueryString };
  }) => Promise<EdgeResult>;
  return handler({ request: { uri, querystring } });
}

/** `"k=v"` / bare `"k"` -> `{value}`; a repeated key folds into `multiValue`,
 *  matching the shape CloudFront's runtime parses a querystring into. */
function toQuerystring(query: string): EdgeQueryString {
  const qs: EdgeQueryString = {};
  if (!query) return qs;
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const name = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? "" : part.slice(eq + 1);
    const existing = qs[name];
    if (existing === undefined) {
      qs[name] = { value };
    } else {
      existing.multiValue = [...(existing.multiValue ?? [{ value: existing.value }]), { value }];
    }
  }
  return qs;
}

// Holds this hand-written function to the same semantics as
// @typren/core's resolveStaticHostRequest({ trailingSlash: false }); see
// static-host-routing.ts for the case list. The function cannot import that
// implementation itself (cloudfront-js has no bundler), so this is what
// catches a divergence.
createBareUrlStaticHostRoutingContractSuite(
  "cloudfront function (bare URL)",
  async ({ path, query = "", redirects = {}, storeDown }): Promise<StaticHostOutcome> => {
    const kvsGet = storeDown ? () => Promise.reject<string>(new Error("store unavailable")) : undefined;
    const result = await run(path, redirects, kvsGet, toQuerystring(query));
    return "uri" in result
      ? { serve: result.uri }
      : { status: result.statusCode as 301 | 302 | 307 | 308, location: result.headers.location.value };
  }
);
