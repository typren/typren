import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createBareUrlStaticHostRoutingContractSuite, createStaticHostRoutingContractSuite, type StaticHostRunner } from "@typren/contract-tests";
import { describe, expect, it } from "vitest";
import { resolveStaticHostRequest } from "./static-host";

/** Adapts the suite's { path, query, redirects, storeDown } request shape to
 *  resolveStaticHostRequest's decision, and the decision back to the suite's
 *  { status, location } / { serve } outcome. */
function runner(trailingSlash: boolean): StaticHostRunner {
  return async ({ path, query = "", redirects = {}, storeDown }) => {
    const lookup = (key: string) => {
      if (storeDown) throw new Error("store unavailable");
      return redirects[key];
    };
    const decision = await resolveStaticHostRequest(path, query, lookup, { trailingSlash });
    if (decision.kind === "redirect") return { status: decision.status, location: decision.location };
    if (decision.kind === "rewrite") return { serve: decision.path };
    return { serve: path };
  };
}

createStaticHostRoutingContractSuite("core resolveStaticHostRequest", runner(true));
createBareUrlStaticHostRoutingContractSuite("core resolveStaticHostRequest", runner(false));

describe("resolveStaticHostRequest (unsupported by the generic suite)", () => {
  it("treats a lookup returning undefined as no redirect", async () => {
    await expect(resolveStaticHostRequest("/x/", "", () => undefined)).resolves.toEqual({
      kind: "rewrite",
      path: "/x/index.html",
    });
  });

  it("treats a lookup returning an empty string as no redirect", async () => {
    await expect(resolveStaticHostRequest("/about", "", () => "")).resolves.toEqual({
      kind: "redirect",
      status: 301,
      location: "/about/",
    });
  });

  it("accepts a synchronous lookup function", async () => {
    await expect(resolveStaticHostRequest("/old", "", (key) => (key === "/old" ? "/new" : null))).resolves.toEqual({
      kind: "redirect",
      status: 301,
      location: "/new",
    });
  });
});

describe("@typren/core/static-host is import-free", () => {
  it("has no import statements, so a bundler-free consumer (CloudFront functions, a Worker bundle) can inline it", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "static-host.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import /m);
  });
});
