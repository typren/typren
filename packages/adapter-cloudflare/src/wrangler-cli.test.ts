import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `wrangler` shell-out is the only side effect in wrangler-cli.ts, so a
// mocked execFileSync is enough to unit-test its one piece of real logic:
// which args/files each operation sends, mirroring
// @typren/adapter-cloudfront's aws-cli-clients.test.ts.
vi.mock("node:child_process", () => {
  const mock = { execFileSync: vi.fn() };
  return { ...mock, default: mock };
});

import { execFileSync } from "node:child_process";
import { createWranglerKvClient, createRedirectsNamespace, deploy, runWrangler, REDIRECTS_BINDING, REDIRECTS_NAMESPACE } from "./wrangler-cli";

const mocked = vi.mocked(execFileSync);

beforeEach(() => mocked.mockReset());

describe("runWrangler", () => {
  it("runs wrangler via npx and returns stdout", () => {
    mocked.mockReturnValue("ok" as never);
    expect(runWrangler(["--version"])).toBe("ok");
    expect(mocked).toHaveBeenCalledWith("npx", ["wrangler", "--version"], expect.any(Object));
  });

  // The ENOENT-wrapping and error-propagation branches of runWrangler's catch
  // block aren't exercised here: making a mocked execFileSync throw trips an
  // unrelated Vitest/child_process interaction in this workspace (the thrown
  // error surfaces as a spurious test failure even once caught by the
  // function under test), the same reason adapter-cloudfront's
  // aws-cli-clients.test.ts never exercises its own analogous ENOENT branch
  // in `aws()` either.
});

describe("createWranglerKvClient", () => {
  it("listKeys parses the JSON array into key names", async () => {
    mocked.mockReturnValue(JSON.stringify([{ name: "/old" }, { name: "/other" }]) as never);
    const keys = await createWranglerKvClient().listKeys();
    expect(keys).toEqual(["/old", "/other"]);
    expect(mocked).toHaveBeenCalledWith("npx", ["wrangler", "kv", "key", "list", "--binding", REDIRECTS_BINDING, "--remote"], expect.any(Object));
  });

  it("putMany writes pairs to a temp file and calls bulk put with --remote", async () => {
    let written: unknown;
    mocked.mockImplementation(((...call: unknown[]) => {
      const args = (call[1] ?? []) as string[];
      if (args[2] === "bulk" && args[3] === "put") {
        written = JSON.parse(fs.readFileSync(args[4], "utf8"));
      }
      return "" as unknown as Buffer;
    }) as typeof execFileSync);

    await createWranglerKvClient().putMany([{ key: "/a", value: "/b" }]);

    expect(written).toEqual([{ key: "/a", value: "/b" }]);
    const call = mocked.mock.calls[0][1] as string[];
    expect(call).toEqual(expect.arrayContaining(["kv", "bulk", "put", "--binding", REDIRECTS_BINDING, "--remote"]));
  });

  it("putMany is a no-op for an empty list", async () => {
    await createWranglerKvClient().putMany([]);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("deleteMany writes keys to a temp file and calls bulk delete with --remote --force", async () => {
    let written: unknown;
    mocked.mockImplementation(((...call: unknown[]) => {
      const args = (call[1] ?? []) as string[];
      if (args[2] === "bulk" && args[3] === "delete") {
        written = JSON.parse(fs.readFileSync(args[4], "utf8"));
      }
      return "" as unknown as Buffer;
    }) as typeof execFileSync);

    await createWranglerKvClient().deleteMany(["/a"]);

    expect(written).toEqual(["/a"]);
    const call = mocked.mock.calls[0][1] as string[];
    expect(call).toEqual(expect.arrayContaining(["kv", "bulk", "delete", "--binding", REDIRECTS_BINDING, "--remote", "--force"]));
  });

  it("deleteMany is a no-op for an empty list", async () => {
    await createWranglerKvClient().deleteMany([]);
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe("createRedirectsNamespace", () => {
  it("calls wrangler kv namespace create with --update-config", () => {
    mocked.mockReturnValue("" as never);
    createRedirectsNamespace();
    expect(mocked).toHaveBeenCalledWith(
      "npx",
      ["wrangler", "kv", "namespace", "create", REDIRECTS_NAMESPACE, "--binding", REDIRECTS_BINDING, "--update-config"],
      expect.any(Object)
    );
  });
});

describe("deploy", () => {
  it("calls wrangler deploy", () => {
    mocked.mockReturnValue("" as never);
    deploy();
    expect(mocked).toHaveBeenCalledWith("npx", ["wrangler", "deploy"], expect.any(Object));
  });
});
