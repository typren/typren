import { AwsClient } from "aws4fetch";
import type { MediaAdapter, MediaAsset, PreparedFile } from "@typren/core";
import { parseListObjectsV2 } from "./xml";

export type S3MediaAdapterOptions = {
  /** Path-style endpoint, e.g. "https://<account>.r2.cloudflarestorage.com"
   *  (R2), "https://<ref>.supabase.co/storage/v1/s3" (Supabase Storage), or
   *  "https://s3.<region>.amazonaws.com" (AWS). http:// only for a localhost
   *  MinIO dev instance. */
  endpoint: string;
  bucket: string;
  /** "auto" works for R2 and MinIO; AWS and Supabase want their real region. */
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public URL prefix assets are served under, e.g. a CDN domain fronting the bucket. */
  publicBaseUrl: string;
  /** Key prefix every object is stored/listed under, e.g. "media/". */
  prefix?: string;
};

// mime lookup for list(): ListObjectsV2 carries no Content-Type, only Key/Size/LastModified.
const MIME_FROM_EXT: Record<string, string> = {
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".tiff": "image/tiff",
};
const mimeFromExt = (ext: string) => MIME_FROM_EXT[ext.toLowerCase()] ?? "application/octet-stream";

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^[a-zA-Z0-9/_-]*$/;
// Ids/keys reach the DELETE/GET path straight from a Server Action argument,
// so reject anything that isn't a plain S3 key (mirrors fs-media-adapter's SAFE_NAME).
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function assertSafe(id: string): string {
  if (!SAFE_ID.test(id) || id.includes("..")) throw new Error(`typren: unsafe media id "${id}"`);
  return id;
}

function validateOptions(opts: S3MediaAdapterOptions) {
  let url: URL;
  try {
    url = new URL(opts.endpoint);
  } catch {
    throw new Error("typren: adapter-media-s3 endpoint must be an absolute URL");
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    throw new Error("typren: adapter-media-s3 endpoint must be https:// (http:// only for localhost MinIO)");
  }
  if (!BUCKET_RE.test(opts.bucket)) throw new Error("typren: adapter-media-s3 bucket name is invalid");
  if (opts.prefix !== undefined && (!PREFIX_RE.test(opts.prefix) || opts.prefix.includes(".."))) {
    throw new Error("typren: adapter-media-s3 prefix is invalid");
  }
}

/** Splits "photo.webp" into ["photo", ".webp"]; a name with no extension
 *  (e.g. "photo") splits to ["photo", ""]. No node:path: this adapter must
 *  also run on Cloudflare Workers, which don't ship it. */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? [name, ""] : [name.slice(0, dot), name.slice(dot)];
}

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Error from a non-2xx S3 response. Never includes request headers or the
 *  signed Authorization, only method/path/status, so credentials can't leak
 *  into logs or a surfaced error message. */
async function s3Error(op: string, res: Response, path: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`typren: S3 ${op} ${path} failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
}

/**
 * S3 API-compatible media adapter: one implementation covers Cloudflare R2,
 * Supabase Storage (S3 endpoint), AWS S3 and MinIO, since they all speak the
 * same signed REST API. Signing is aws4fetch (see package.json for why: SigV4
 * with zero dependencies and fetch-only, unlike @aws-sdk's Node-oriented
 * clients). Edge-compatible: fetch + WebCrypto only, no node:fs or sharp, so
 * it runs on Cloudflare Workers as well as Node.
 */
export function createS3MediaAdapter(opts: S3MediaAdapterOptions): MediaAdapter {
  validateOptions(opts);
  const { endpoint, bucket, region = "auto", accessKeyId, secretAccessKey, publicBaseUrl, prefix = "" } = opts;
  // ponytail: aws4fetch retries non-2xx responses up to 10x by default, which turns one
  // thrown error into an 11-request stall. Disabled here; add it back (aws4fetch's own
  // `retries`/`initRetryMs` options) if transient 5xx from a specific provider need it.
  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3", retries: 0 });
  // ponytail: path-style only (`${endpoint}/${bucket}/${key}`). Covers R2, Supabase,
  // MinIO and AWS, but not a virtual-hosted-only bucket (buckets with dots under AWS's
  // newer regions, or a provider that dropped path-style entirely). Add a
  // `virtualHostedStyle` option building `${bucket}.${host}/${key}` if that's ever needed.
  const base = `${endpoint.replace(/\/$/, "")}/${bucket}`;

  return {
    async list(): Promise<MediaAsset[]> {
      const assets: MediaAsset[] = [];
      let continuationToken: string | undefined;
      do {
        const qs = new URLSearchParams({ "list-type": "2", prefix });
        if (continuationToken) qs.set("continuation-token", continuationToken);
        const res = await aws.fetch(`${base}?${qs.toString()}`);
        if (!res.ok) throw await s3Error("ListObjectsV2", res, "/");
        const { entries, nextContinuationToken } = parseListObjectsV2(await res.text());
        // ponytail: width/height omitted. ListObjectsV2 carries no per-object metadata;
        // getting dimensions here needs a HEAD per object (one request each, slow for a
        // large bucket) or a side manifest written at upload time. Add whichever the
        // media library actually needs them for.
        for (const e of entries) {
          assets.push({
            id: e.key,
            url: `${publicBaseUrl.replace(/\/$/, "")}/${e.key}`,
            name: e.key.split("/").pop() ?? e.key,
            size: e.size,
            mime: mimeFromExt(splitExt(e.key)[1]),
            createdAt: e.lastModified,
          });
        }
        continuationToken = nextContinuationToken;
      } while (continuationToken);

      return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    },

    async upload(file: PreparedFile): Promise<MediaAsset> {
      // Unconditional random suffix, same reasoning as fs-media-adapter: no
      // existence-check-then-write race, collisions are structurally impossible instead.
      const [root, ext] = splitExt(file.name);
      const key = assertSafe(`${prefix}${root}-${randomSuffix()}${ext}`);
      const headers: Record<string, string> = { "content-type": file.mime };
      if (file.width !== undefined) headers["x-amz-meta-width"] = String(file.width);
      if (file.height !== undefined) headers["x-amz-meta-height"] = String(file.height);

      // `Buffer<ArrayBufferLike>` isn't assignable to DOM's `BodyInit` (ArrayBufferView
      // pins the buffer to `ArrayBuffer`); a plain Uint8Array view satisfies it.
      const res = await aws.fetch(`${base}/${key}`, { method: "PUT", headers, body: new Uint8Array(file.buffer) });
      if (!res.ok) throw await s3Error("PutObject", res, key);

      return {
        id: key,
        url: `${publicBaseUrl.replace(/\/$/, "")}/${key}`,
        name: file.name,
        size: file.buffer.byteLength,
        width: file.width,
        height: file.height,
        mime: file.mime,
        createdAt: new Date().toISOString(),
      };
    },

    async delete(id: string): Promise<void> {
      const key = assertSafe(id);
      // A bucket can be shared (one prefix per site); an id outside this
      // adapter's prefix belongs to someone else and must never be deleted here.
      if (!key.startsWith(prefix)) throw new Error(`typren: media id "${id}" is outside this adapter's prefix`);
      const res = await aws.fetch(`${base}/${key}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw await s3Error("DeleteObject", res, key); // idempotent: 404 is a no-op
    },
  };
}
