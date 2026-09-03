import { describe, expect, it, vi } from "vitest";
import { bootstrapDistribution, DEFAULT_FUNCTION_NAME } from "./bootstrap";
import type { CloudFrontClient, KvsClient } from "./types";

function fakeKvsClient(existingStores: Record<string, string> = {}): KvsClient {
  return {
    describeStore: vi.fn(async (name: string) => {
      const arn = existingStores[name];
      if (!arn) throw new Error(`NotFound: ${name}`);
      return { arn, status: "READY" };
    }),
    listKeys: vi.fn(),
    updateKeys: vi.fn(),
  };
}

function fakeCfClient(attached: string[] = []): CloudFrontClient & {
  setViewerRequestFunction: ReturnType<typeof vi.fn>;
  upsertFunction: ReturnType<typeof vi.fn>;
  createKeyValueStore: ReturnType<typeof vi.fn>;
} {
  return {
    getAttachedFunctionNames: vi.fn(async () => attached),
    createKeyValueStore: vi.fn(async (name: string) => ({ arn: `arn:store/${name}`, status: "READY" })),
    upsertFunction: vi.fn(async (name: string) => ({ arn: `arn:function/${name}` })),
    setViewerRequestFunction: vi.fn(async () => {}),
  };
}

describe("bootstrapDistribution", () => {
  it("creates the store, upserts the function, and attaches it when nothing is attached yet", async () => {
    const kvs = fakeKvsClient();
    const cf = fakeCfClient([]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects" });

    expect(result).toEqual({ ok: true, createdKvs: true, functionArn: `arn:function/${DEFAULT_FUNCTION_NAME}` });
    expect(cf.createKeyValueStore).toHaveBeenCalledWith("typren-redirects", expect.any(String));
    expect(cf.upsertFunction).toHaveBeenCalledWith(DEFAULT_FUNCTION_NAME, expect.stringContaining("cloudfront"), "arn:store/typren-redirects", expect.any(String));
    expect(cf.setViewerRequestFunction).toHaveBeenCalledWith("E123", `arn:function/${DEFAULT_FUNCTION_NAME}`);
  });

  it("reuses an existing store instead of creating one", async () => {
    const kvs = fakeKvsClient({ "typren-redirects": "arn:store/existing" });
    const cf = fakeCfClient([]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects" });

    expect(result).toMatchObject({ ok: true, createdKvs: false });
    expect(cf.createKeyValueStore).not.toHaveBeenCalled();
    expect(cf.upsertFunction).toHaveBeenCalledWith(expect.any(String), expect.any(String), "arn:store/existing", expect.any(String));
  });

  it("is a safe no-op-ish re-run when the function already attached is typren's own", async () => {
    const kvs = fakeKvsClient({ "typren-redirects": "arn:store/existing" });
    const cf = fakeCfClient([DEFAULT_FUNCTION_NAME]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects" });
    expect(result.ok).toBe(true);
  });

  it("refuses to replace a different attached function without force", async () => {
    const kvs = fakeKvsClient();
    const cf = fakeCfClient(["legacy-rewrite-fn"]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects" });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/legacy-rewrite-fn/);
    expect(cf.setViewerRequestFunction).not.toHaveBeenCalled();
    expect(cf.upsertFunction).not.toHaveBeenCalled();
  });

  it("proceeds and replaces the other function when force is set", async () => {
    const kvs = fakeKvsClient();
    const cf = fakeCfClient(["legacy-rewrite-fn"]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects", force: true });

    expect(result.ok).toBe(true);
    expect(cf.setViewerRequestFunction).toHaveBeenCalled();
  });

  it("supports a custom function name", async () => {
    const kvs = fakeKvsClient();
    const cf = fakeCfClient([]);
    const result = await bootstrapDistribution(kvs, cf, { distributionId: "E123", storeName: "typren-redirects", functionName: "my-fn" });
    expect(result).toMatchObject({ ok: true, functionArn: "arn:function/my-fn" });
  });
});
