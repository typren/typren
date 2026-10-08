import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createStaticHostRoutingContractSuite, type StaticHostOutcome, type StaticHostRunner } from "@typren/contract-tests";
import worker from "./worker";
import type { Env } from "./types";

const workerSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "worker.ts"), "utf8");

/** A fake `env`: `ASSETS.fetch` just records what it was asked to serve
 *  (200, no body, so a test reads the outcome off `requested` instead of the
 *  response), and `REDIRECTS.get` mirrors the real binding's contract
 *  (rejects when the store is down, returns the map's value or null). */
function fakeEnv(redirects: Record<string, string> = {}, storeDown = false): { env: Env; requested: Request[] } {
  const requested: Request[] = [];
  const env: Env = {
    ASSETS: {
      async fetch(request) {
        requested.push(request);
        return new Response(null, { status: 200 });
      },
    },
    REDIRECTS: {
      async get(key) {
        if (storeDown) throw new Error("store unavailable");
        return redirects[key] ?? null;
      },
    },
  };
  return { env, requested };
}

const run: StaticHostRunner = async ({ path, query = "", redirects = {}, storeDown }): Promise<StaticHostOutcome> => {
  const { env, requested } = fakeEnv(redirects, storeDown);
  const request = new Request(`https://example.com${path}${query ? `?${query}` : ""}`);
  const response = await worker.fetch(request, env);
  if (response.status === 301) {
    return { status: 301, location: response.headers.get("Location")! };
  }
  const served = requested.at(-1);
  if (!served) throw new Error("ASSETS.fetch was never called");
  return { serve: new URL(served.url).pathname };
};

// Holds the Worker to the same semantics as @typren/core's
// resolveStaticHostRequest and @typren/adapter-cloudfront's hand-written
// redirects.function.js; see createStaticHostRoutingContractSuite for cases.
createStaticHostRoutingContractSuite("cloudflare worker", run);

describe("worker.ts (extra cases the contract suite doesn't cover)", () => {
  it("serves when the REDIRECTS binding is absent entirely (deployed before bootstrap)", async () => {
    const requested: Request[] = [];
    const env: Env = {
      ASSETS: {
        async fetch(request) {
          requested.push(request);
          return new Response(null, { status: 200 });
        },
      },
    };
    const response = await worker.fetch(new Request("https://example.com/about/"), env);
    expect(response.status).toBe(200);
    expect(new URL(requested[0].url).pathname).toBe("/about/index.html");
  });

  it("preserves method and headers on a rewrite", async () => {
    const { env, requested } = fakeEnv();
    const request = new Request("https://example.com/about/", { method: "GET", headers: { "X-Test": "1" } });
    await worker.fetch(request, env);
    expect(requested[0].method).toBe("GET");
    expect(requested[0].headers.get("X-Test")).toBe("1");
  });

  it("does not special-case /_next in its own CODE: that exclusion is wrangler config's run_worker_first (mentioned only in a comment here)", () => {
    const code = workerSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/_next/);
  });

  it("imports nothing but @typren/core/static-host (a Workers bundle can't carry core's node/jsdom/sharp dependencies)", () => {
    const imports = [...workerSource.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
    const nonLocal = imports.filter((i) => !i.startsWith("."));
    expect(nonLocal).toEqual(["@typren/core/static-host"]);
  });
});
