import path from "node:path";
import sharp from "sharp";
import { resolveAuth } from "./auth-adapter";
import type { CmsConfig, PreparedFile } from "./types";

/** Pre-conversion upload cap. Sharp's own `limitInputPixels` default
 *  (~268 megapixels) is relied on as-is for decompression-bomb protection. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_DIMENSION = 2000; // longest edge, px
const WEBP_QUALITY = 82; // house rule: web-optimized images only, q~82

const EXT_FOR_MIME: Record<string, string> = {
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

// ponytail: blocklist heuristic, not real SVG sanitization. Swap in
// dompurify+jsdom or svg-sanitizer if upload access ever extends beyond
// authorize()-gated authors.
const SVG_SCRIPT_RE = /<script|on\w+\s*=|javascript:/i;

/** basename minus extension, lowercased, non-alnum runs collapsed to "-". */
function slugifyBase(filename: string): string {
  const base = path.parse(filename).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "image";
}

/** Validates + web-optimizes a raw upload. Never trusts the client-supplied
 *  mime/extension: sniffs actual bytes via sharp.metadata(). Throws with a
 *  user-facing message on any rejection. */
export async function processUpload(input: { name: string; buffer: Buffer }): Promise<PreparedFile> {
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`typren: upload exceeds ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit`);
  }

  // Trust boundary: sharp's own sniff of the actual bytes decides what
  // happens next, never the Content-Type header or filename extension
  // (both are attacker-controlled).
  const meta = await sharp(input.buffer).metadata();

  let mime: string;
  let buffer: Buffer;
  let width = meta.width;
  let height = meta.height;

  if (meta.format === "svg") {
    if (SVG_SCRIPT_RE.test(input.buffer.toString("utf8"))) {
      throw new Error("typren: SVG upload rejected: it contains script-like content");
    }
    mime = "image/svg+xml";
    buffer = input.buffer;
  } else if (
    meta.format === "png" ||
    meta.format === "jpeg" ||
    meta.format === "gif" ||
    meta.format === "tiff"
  ) {
    // .rotate() auto-orients from EXIF before sharp's default metadata-stripping
    // on output; otherwise phone photos come out sideways.
    const { data, info } = await sharp(input.buffer)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    mime = "image/webp";
    buffer = data;
    width = info.width;
    height = info.height;
  } else if (meta.format === "webp" || (meta.format === "heif" && meta.compression === "av1")) {
    // sharp 0.35 folded AVIF detection into the "heif" decoder: an AVIF file
    // now reports format "heif" with compression "av1", while classic HEIC
    // reports "hevc". Checking compression here is what keeps this branch
    // from silently starting to accept plain HEIC uploads too.
    //
    // ponytail: doesn't enforce MAX_DIMENSION on already-webp/avif uploads;
    // acceptable for a v1 authorize()-gated admin tool, revisit if this ever
    // becomes open upload.
    mime = meta.format === "webp" ? "image/webp" : "image/avif";
    buffer = input.buffer;
  } else {
    throw new Error(`Unsupported image format: ${meta.format}. Upload PNG, JPEG, GIF, WebP, AVIF, or SVG.`);
  }

  return { name: `${slugifyBase(input.name)}${EXT_FOR_MIME[mime]}`, mime, buffer, width, height };
}

/** Route Handler body. The host's route.ts is a thin wrapper, the same
 *  "host owns the boundary, package supplies the logic" split actions.ts
 *  already uses for Server Actions.
 *
 *  Route Handlers never run through a parent layout's auth gate (a
 *  `route.ts` renders no layout tree at all), so this re-checks auth itself
 *  via the same `resolveAuth` the action guard uses. */
export async function handleMediaUpload(config: CmsConfig, request: Request): Promise<Response> {
  if (
    !(await resolveAuth(config).authorize({
      action: "uploadMedia",
      siteId: config.siteId,
      accountId: config.accountId,
    }))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!config.mediaAdapter) return new Response("Media not configured", { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });

  try {
    const prepared = await processUpload({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    const asset = await config.mediaAdapter.upload(prepared);
    return Response.json(asset);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
