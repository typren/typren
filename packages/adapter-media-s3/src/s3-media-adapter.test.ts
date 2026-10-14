import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createS3MediaAdapter } from "./s3-media-adapter";
import type { PreparedFile } from "@typren/core";

const BASE_OPTS = {
  endpoint: "https://abc123.r2.cloudflarestorage.com",
  bucket: "my-bucket",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "super-secret-value",
  publicBaseUrl: "https://media.example.com",
};

const preparedFile = (overrides: Partial<PreparedFile> = {}): PreparedFile => ({
  name: "photo.webp",
  mime: "image/webp",
  buffer: Buffer.from("fake-image-bytes"),
  width: 10,
  height: 20,
  ...overrides,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("createS3MediaAdapter: option validation", () => {
  it("rejects a non-URL endpoint", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, endpoint: "not-a-url" })).toThrow(/absolute URL/);
  });

  it("rejects a plain http endpoint that isn't localhost", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, endpoint: "http://example.com" })).toThrow(/https:\/\//);
  });

  it("accepts http://localhost for MinIO dev", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, endpoint: "http://localhost:9000" })).not.toThrow();
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, endpoint: "http://127.0.0.1:9000" })).not.toThrow();
  });

  it("rejects an invalid bucket name", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, bucket: "Not_Valid!" })).toThrow(/bucket name/);
  });

  it("rejects a prefix containing a traversal segment", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, prefix: "../escape/" })).toThrow(/prefix is invalid/);
  });

  it("rejects a prefix without a trailing slash", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, prefix: "siteA" })).toThrow(/must be non-empty and end in/);
  });

  it("rejects an empty-string prefix", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, prefix: "" })).toThrow(/must be non-empty and end in/);
  });

  it("accepts a prefix ending in a trailing slash", () => {
    expect(() => createS3MediaAdapter({ ...BASE_OPTS, prefix: "siteA/" })).not.toThrow();
  });
});

describe("createS3MediaAdapter: upload", () => {
  it("PUTs a signed request with content-type and width/height metadata, keyed with a random suffix", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = createS3MediaAdapter({ ...BASE_OPTS, prefix: "media/" });

    const asset = await adapter.upload(preparedFile());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [req] = fetchMock.mock.calls[0] as [Request];
    expect(req.method).toBe("PUT");
    expect(req.url).toMatch(/^https:\/\/abc123\.r2\.cloudflarestorage\.com\/my-bucket\/media\/photo-[0-9a-f]{8}\.webp$/);
    expect(req.headers.get("content-type")).toBe("image/webp");
    expect(req.headers.get("x-amz-meta-width")).toBe("10");
    expect(req.headers.get("x-amz-meta-height")).toBe("20");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/); // confirms SigV4 signing ran

    expect(asset.id).toMatch(/^media\/photo-[0-9a-f]{8}\.webp$/);
    expect(asset.url).toBe(`https://media.example.com/${asset.id}`);
    expect(asset.name).toBe("photo.webp");
    expect(asset.width).toBe(10);
    expect(asset.height).toBe(20);
  });

  it("two uploads of the same name never collide", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    const a = await adapter.upload(preparedFile());
    const b = await adapter.upload(preparedFile());
    expect(a.id).not.toBe(b.id);
  });

  it("handles a name with no extension", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    const asset = await adapter.upload(preparedFile({ name: "noext", width: undefined, height: undefined }));
    expect(asset.id).toMatch(/^noext-[0-9a-f]{8}$/);
  });

  it("throws on a non-2xx response without leaking the secret key", async () => {
    fetchMock.mockResolvedValue(new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.upload(preparedFile())).rejects.toThrow(/typren: S3 PutObject .* failed \(403\)/);
    try {
      await adapter.upload(preparedFile());
    } catch (err) {
      expect(String(err)).not.toContain(BASE_OPTS.secretAccessKey);
    }
  });
});

describe("createS3MediaAdapter: list", () => {
  const page1 = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>a-1.webp</Key><Size>100</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
  <Contents><Key>b-2&amp;c.png</Key><Size>200</Size><LastModified>2026-02-01T00:00:00.000Z</LastModified></Contents>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>token-123</NextContinuationToken>
</ListBucketResult>`;

  const page2 = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>c-3.jpg</Key><Size>300</Size><LastModified>2026-03-01T00:00:00.000Z</LastModified></Contents>
  <IsTruncated>false</IsTruncated>
</ListBucketResult>`;

  it("follows ContinuationToken pagination, decodes XML entities, and sorts newest first", async () => {
    fetchMock.mockImplementation(async (req: Request) => {
      const url = new URL(req.url);
      const body = url.searchParams.get("continuation-token") === "token-123" ? page2 : page1;
      return new Response(body, { status: 200 });
    });

    const adapter = createS3MediaAdapter(BASE_OPTS);
    const assets = await adapter.list();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assets.map((a) => a.id)).toEqual(["c-3.jpg", "b-2&c.png", "a-1.webp"]); // newest first
    expect(assets.find((a) => a.id === "b-2&c.png")?.mime).toBe("image/png");
    expect(assets.find((a) => a.id === "c-3.jpg")?.mime).toBe("image/jpeg");
    expect(assets.every((a) => a.width === undefined)).toBe(true); // ListObjectsV2 has no per-object metadata
  });

  it("returns [] when the bucket has no matching objects", async () => {
    fetchMock.mockResolvedValue(
      new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>", { status: 200 })
    );
    const adapter = createS3MediaAdapter(BASE_OPTS);
    expect(await adapter.list()).toEqual([]);
  });

  it("throws on a non-2xx list response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.list()).rejects.toThrow(/typren: S3 ListObjectsV2/);
  });
});

describe("createS3MediaAdapter: delete", () => {
  it("DELETEs the signed, path-style object URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await adapter.delete("photo-a1b2c3d4.webp");
    const [req] = fetchMock.mock.calls[0] as [Request];
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe("https://abc123.r2.cloudflarestorage.com/my-bucket/photo-a1b2c3d4.webp");
  });

  it("is idempotent: a 404 does not throw", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.delete("already-gone.webp")).resolves.toBeUndefined();
  });

  it("rejects a path-traversal id instead of making a request", async () => {
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.delete("../../etc/passwd")).rejects.toThrow(/unsafe media id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an id outside its own prefix (shared bucket) without making a request", async () => {
    const adapter = createS3MediaAdapter({ ...BASE_OPTS, prefix: "site-a/" });
    await expect(adapter.delete("site-b/photo.webp")).rejects.toThrow(/outside this adapter's prefix/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a trailing-slash prefix cannot delete a sibling prefix that merely shares a string prefix", async () => {
    // Without the mandatory trailing slash, "siteA".startsWith would have let
    // "siteA" match "siteAB/x" too; "siteA/" cannot.
    const adapter = createS3MediaAdapter({ ...BASE_OPTS, prefix: "siteA/" });
    await expect(adapter.delete("siteAB/x")).rejects.toThrow(/outside this adapter's prefix/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an upload whose name would produce an unsafe key", async () => {
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.upload(preparedFile({ name: "../x.webp" }))).rejects.toThrow(/unsafe media id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx, non-404 delete response", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    const adapter = createS3MediaAdapter(BASE_OPTS);
    await expect(adapter.delete("photo.webp")).rejects.toThrow(/typren: S3 DeleteObject/);
  });
});
