import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The AWS CLI shell-out is the only side effect in aws-cli-clients.ts, so a
// mocked execFileSync is enough to unit-test the one piece of real logic in
// it: the FunctionAssociations merge in setViewerRequestFunction.
vi.mock("node:child_process", () => {
  const mock = { execFileSync: vi.fn() };
  return { ...mock, default: mock };
});

import { execFileSync } from "node:child_process";
import { createAwsCliCloudFrontClient } from "./aws-cli-clients";

type Association = { EventType: string; FunctionARN: string };
type Written = { DefaultCacheBehavior: { FunctionAssociations: { Quantity: number; Items: Association[] } } };

const mocked = vi.mocked(execFileSync);

/** get-distribution-config answers with `existing`; update-distribution hands
 *  the on-disk config payload to `onUpdate` before the temp file is removed. */
function mockAws(existing: Association[] | undefined, onUpdate: (config: Written) => void): void {
  mocked.mockImplementation(((...call: unknown[]) => {
    // Tolerate stray invocations with no argument list (the test runner's own
    // machinery can touch a module-level mock); only real `aws` calls match below.
    const args = (call[1] ?? []) as string[];
    if (args[1] === "get-distribution-config") {
      return JSON.stringify({
        ETag: "E1",
        DistributionConfig: {
          DefaultCacheBehavior: existing
            ? { FunctionAssociations: { Quantity: existing.length, Items: existing } }
            : {},
        },
      });
    }
    if (args[1] === "update-distribution") {
      const configArg = args.find((a) => a.startsWith("file://"))!;
      onUpdate(JSON.parse(fs.readFileSync(configArg.slice("file://".length), "utf8")) as Written);
      return "{}";
    }
    return "{}";
  }) as typeof execFileSync);
}

beforeEach(() => mocked.mockReset());

describe("createAwsCliCloudFrontClient", () => {
  it("setViewerRequestFunction keeps other event types' associations while replacing viewer-request", async () => {
    let written: Written | undefined;
    mockAws(
      [
        { EventType: "viewer-response", FunctionARN: "arn:security-headers" },
        { EventType: "viewer-request", FunctionARN: "arn:old-redirects" },
      ],
      (config) => (written = config)
    );

    await createAwsCliCloudFrontClient().setViewerRequestFunction("DIST123", "arn:typren-redirects");

    expect(written?.DefaultCacheBehavior.FunctionAssociations).toEqual({
      Quantity: 2,
      Items: [
        { EventType: "viewer-response", FunctionARN: "arn:security-headers" },
        { EventType: "viewer-request", FunctionARN: "arn:typren-redirects" },
      ],
    });
  });

  it("setViewerRequestFunction handles a distribution with no associations yet", async () => {
    let written: Written | undefined;
    mockAws(undefined, (config) => (written = config));

    await createAwsCliCloudFrontClient().setViewerRequestFunction("DIST123", "arn:typren-redirects");

    expect(written?.DefaultCacheBehavior.FunctionAssociations).toEqual({
      Quantity: 1,
      Items: [{ EventType: "viewer-request", FunctionARN: "arn:typren-redirects" }],
    });
  });

  it("getAttachedFunctionNames reports only viewer-request associations", async () => {
    mockAws(
      [
        { EventType: "viewer-response", FunctionARN: "arn:aws:cloudfront::1:function/security-headers" },
        { EventType: "viewer-request", FunctionARN: "arn:aws:cloudfront::1:function/old-redirects" },
      ],
      () => {}
    );
    expect(await createAwsCliCloudFrontClient().getAttachedFunctionNames("DIST123")).toEqual(["old-redirects"]);
  });
});
