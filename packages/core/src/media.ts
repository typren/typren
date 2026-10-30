import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { JSDOM } from "jsdom";
import DOMPurify, { type WindowLike } from "dompurify";
import { resolveAuth } from "./auth-adapter";
import { makeActions } from "./actions";
import { GitError } from "./git";
import type { CmsConfig, PreparedFile } from "./types";

/** Pre-conversion upload cap. Sharp's own `limitInputPixels` default
 *  (~268 megapixels) is relied on as-is for decompression-bomb protection. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
// Room for multipart boundaries and part headers around the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_DIMENSION = 2000; // longest edge, px
const WEBP_QUALITY = 82; // house rule: web-optimized images only, q~82

const EXT_FOR_MIME: Record<string, string> = {
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

// Real (allowlist) SVG sanitization: DOMPurify's "svg"/"svgFilters"
// profiles strip <script>, event-handler attributes (onload, onclick, ...),
// and javascript:/data:text-html URIs while keeping the rest of the markup
// (shape/paint/structure elements and attributes) intact. This replaced a
// <script>|on\w+=|javascript: blocklist regex, which upload access
// extending beyond authorize()-gated authors (hosted multi-tenant) made
// inadequate: a blocklist only ever covers the bypasses someone thought of.
//
// DOMPurify needs a DOM to run against; jsdom is the pairing its own docs
// use for Node. Built lazily (constructing a JSDOM has real, if small,
// startup cost) and reused, since most CmsConfig setups never touch SVG.
let svgPurifier: ReturnType<typeof DOMPurify> | null = null;
function getSvgPurifier(): ReturnType<typeof DOMPurify> {
  if (!svgPurifier) {
    svgPurifier = DOMPurify(new JSDOM("").window as unknown as WindowLike);
    // An SVG served from the site's own origin may only point inside itself (`<use href="#id">`).
    // Any other href is an external fetch or navigation the uploader chose, so it is dropped.
    svgPurifier.addHook("uponSanitizeAttribute", (_node, data) => {
      if ((data.attrName === "href" || data.attrName === "xlink:href") && !data.attrValue.startsWith("#")) {
        data.keepAttr = false;
        return;
      }
      // A presentation attribute (fill, stroke, filter, clip-path, mask, marker-*, ...) can carry a
      // CSS url() the same way href does. A fragment reference (url(#id)) stays inside the document;
      // anything else is an external fetch, so the whole attribute is dropped rather than rewritten.
      if (hasExternalUrlFunc(data.attrValue)) {
        data.keepAttr = false;
      }
    });
  }
  return svgPurifier;
}

// Every `url(` must open a same-document fragment reference (`url(#id)`, optionally quoted): those
// are the only `url()` references staying off the network entirely. Matching the opener rather than
// a closed `url(...)` call fails closed on an unterminated one, which CSS ends at end of input.
// Presentation attributes parse as CSS, so an escape (`\75 rl(...)`) can spell `url(` past the
// match below; any backslash counts as external.
function hasExternalUrlFunc(value: string): boolean {
  if (value.includes("\\")) return true;
  const openers = value.match(/url\(/gi)?.length ?? 0;
  const fragments = value.match(/url\(\s*['"]?#/gi)?.length ?? 0;
  return openers !== fragments;
}

/** Strips dangerous elements/attributes from an SVG's source, keeping the rest. `<style>` elements
 *  and `style` attributes (CSS can fetch and exfiltrate) and `<image>` (loads arbitrary URLs) go
 *  too, on top of the svg profiles. */
function sanitizeSvg(raw: string): string {
  return getSvgPurifier().sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["style", "image"],
    FORBID_ATTR: ["style"],
  });
}

// sharp 0.35 folded AVIF detection into the "heif" decoder: an AVIF file
// reports format "heif" with compression "av1", while classic HEIC reports
// "hevc". Checking compression keeps plain HEIC uploads refused.
const isAvif = (meta: Metadata) => meta.format === "heif" && meta.compression === "av1";
const RASTER_FORMATS = new Set(["png", "jpeg", "gif", "tiff", "webp"]);

/** basename minus extension, lowercased, non-alnum runs collapsed to "-",
 *  cut to 55 characters: the editor's 64-character name limit less the
 *  9-character "-xxxxxxxx" suffix the fs adapter adds for uniqueness. */
function slugifyBase(filename: string): string {
  const base = path
    .parse(filename)
    .name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55)
    .replace(/-$/, "");
  return base || "image";
}

/** Validates + web-optimizes a raw upload. Never trusts the client-supplied
 *  mime/extension: sniffs actual bytes via sharp.metadata(). Throws with a
 *  user-facing message on any rejection. SVG is refused unless `allowSvg`
 *  (see `CmsConfig.allowSvg`). */
export async function processUpload(
  input: { name: string; buffer: Buffer },
  opts: { allowSvg?: boolean } = {}
): Promise<PreparedFile> {
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
    // Even sanitized, an SVG is a document: opened directly from the site's origin it runs with
    // that origin's privileges, so accepting it is a deliberate choice with serving precautions.
    if (!opts.allowSvg) {
      throw new Error(
        "SVG uploads are disabled. Set allowSvg: true in the CMS config to enable them; see docs/site/media-storage.md."
      );
    }
    mime = "image/svg+xml";
    buffer = Buffer.from(sanitizeSvg(input.buffer.toString("utf8")), "utf8");
  } else if (RASTER_FORMATS.has(meta.format ?? "") || isAvif(meta)) {
    // Every raster upload is re-encoded, already-WebP/AVIF ones included:
    // passing those through kept their EXIF/GPS metadata and skipped the
    // dimension cap. .rotate() auto-orients from EXIF before sharp's default
    // metadata-stripping on output; otherwise phone photos come out sideways.
    const avif = isAvif(meta);
    const pipeline = sharp(input.buffer)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });
    const { data, info } = await (avif ? pipeline.avif() : pipeline.webp({ quality: WEBP_QUALITY })).toBuffer({
      resolveWithObject: true,
    });
    mime = avif ? "image/avif" : "image/webp";
    buffer = data;
    width = info.width;
    height = info.height;
  } else {
    throw new Error(`Unsupported image format: ${meta.format}. Upload PNG, JPEG, GIF, WebP, AVIF, or SVG.`);
  }

  return { name: `${slugifyBase(input.name)}${EXT_FOR_MIME[mime]}`, mime, buffer, width, height };
}

/** CSRF check for an unsafe request: true when it comes from the request's
 *  own host or an `allowed` origin. A request with no `Origin` header and no
 *  cross-site `Sec-Fetch-Site` is a non-browser caller, with no ambient
 *  credentials to abuse. "Own host" is the `Host` header the browser sent:
 *  a dev server bound to 127.0.0.1 can rebuild `request.url` as localhost,
 *  which refused every write from its own page. */
export function sameOrigin(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin && allowed.includes(origin)) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

/** Route Handler body. The host's route.ts is a thin wrapper, the same
 *  "host owns the boundary, package supplies the logic" split actions.ts
 *  already uses for Server Actions.
 *
 *  Route Handlers never run through a parent layout's auth gate (a
 *  `route.ts` renders no layout tree at all). The upload itself is
 *  `makeActions().uploadMedia`, whose guard is the gate; this checks the
 *  same action first anyway, so a caller who would be refused never gets a
 *  body buffered, and refuses a
 *  cross-origin request itself: a multipart POST needs no CORS preflight, so
 *  any page could otherwise drive a loopback dev server's upload. A host
 *  serving the editor from another origin passes it in `allowedOrigins`. */
export async function handleMediaUpload(
  config: CmsConfig,
  request: Request,
  allowedOrigins: string[] = []
): Promise<Response> {
  if (!sameOrigin(request, allowedOrigins)) return new Response("Cross-origin request refused", { status: 403 });
  if (
    !(await resolveAuth(config).authorize({
      action: "uploadMedia",
      siteId: config.siteId,
      accountId: config.accountId,
    }))
  ) {
    // 403 like every other refusal in the API router: there is no login to retry.
    return new Response("Unauthorized", { status: 403 });
  }
  if (!config.mediaAdapter) return new Response("Media not configured", { status: 404 });

  // request.formData() buffers the whole body before processUpload's size
  // check can run, so a declared oversize body is refused before reading it.
  // ponytail: a chunked body with no content-length is still buffered in
  // full; a streamed byte cap like the webhook handler's closes that if needed.
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return Response.json({ error: "Upload too large" }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  const folder = form.get("folder");

  try {
    const result = await makeActions(config).uploadMedia(
      { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      typeof folder === "string" ? folder : undefined
    );
    return result.ok ? Response.json(result.asset) : Response.json({ error: result.error }, { status: 400 });
  } catch (e) {
    // Written for the person uploading (see explainGitError), so it is shown.
    if (e instanceof GitError) return Response.json({ error: e.message }, { status: 422 });
    // Unlike processUpload's, an adapter failure's message is not written for a client to read (it
    // can carry storage paths, bucket names, or other backend detail); log it, echo nothing back.
    console.error("typren: media upload failed", e);
    return Response.json({ error: "Upload failed" }, { status: 400 });
  }
}
