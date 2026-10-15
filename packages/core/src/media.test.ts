import { describe, it, expect, vi } from "vitest";
import sharp, { type Sharp } from "sharp";
import { handleMediaUpload, processUpload, MAX_UPLOAD_BYTES } from "./media";
import type { CmsConfig, PreparedFile } from "./types";

const SVG_ON = { allowSvg: true };

const png = (width = 4, height = 4) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 10 } } })
    .png()
    .toBuffer();

const SVG_CLEAN = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5"/></svg>';
const SVG_SCRIPT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
const SVG_ONLOAD =
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" width="10" height="10"><circle r="5"/></svg>';
const SVG_JS_HREF =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><a href="javascript:alert(1)"><circle r="5"/></a></svg>';

describe("processUpload", () => {
  it("converts a raster upload (PNG) to web-optimized WebP", async () => {
    const result = await processUpload({ name: "My Photo!!.PNG", buffer: await png() });
    expect(result.mime).toBe("image/webp");
    expect(result.name).toBe("my-photo.webp");
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    // Re-decode to confirm the bytes really are WebP, not just relabeled.
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
  });

  it("caps oversized raster output to MAX_DIMENSION on the long edge", async () => {
    const result = await processUpload({ name: "big.png", buffer: await png(3000, 1000) });
    expect(result.width).toBe(2000);
    expect(result.height).toBe(667); // fit:"inside" preserves aspect ratio
  });

  it("passes a clean SVG through sanitization intact, sniffing the real mime", async () => {
    const result = await processUpload({ name: "icon.svg", buffer: Buffer.from(SVG_CLEAN) }, SVG_ON);
    expect(result.mime).toBe("image/svg+xml");
    // DOMPurify re-serializes (self-closing tags become open/close pairs), so
    // this is a structural check, not a byte-identical one.
    expect(result.buffer.toString("utf8")).toContain('<circle r="5">');
    expect(result.buffer.toString("utf8")).toContain('width="10"');
  });

  it("strips a <script> tag from an SVG upload (stored-XSS vector) but keeps the rest", async () => {
    const result = await processUpload({ name: "evil.svg", buffer: Buffer.from(SVG_SCRIPT) }, SVG_ON);
    const out = result.buffer.toString("utf8");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("<svg");
  });

  it("strips an onload/onclick-style event handler attribute from an SVG upload", async () => {
    const result = await processUpload({ name: "evil-onload.svg", buffer: Buffer.from(SVG_ONLOAD) }, SVG_ON);
    const out = result.buffer.toString("utf8");
    expect(out).not.toMatch(/onload/i);
    expect(out).toContain('<circle r="5">');
  });

  it("strips a javascript: URI from an SVG upload's href", async () => {
    const result = await processUpload({ name: "evil-href.svg", buffer: Buffer.from(SVG_JS_HREF) }, SVG_ON);
    const out = result.buffer.toString("utf8");
    expect(out).not.toMatch(/javascript:/i);
  });

  it("rejects a buffer over MAX_UPLOAD_BYTES before even sniffing it", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    await expect(processUpload({ name: "huge.png", buffer: oversized })).rejects.toThrow(/limit/i);
  });

  it("rejects bytes sharp can't identify as any supported image format", async () => {
    await expect(processUpload({ name: "not-an-image.bin", buffer: Buffer.from("definitely not an image") })).rejects.toThrow();
  });

  it("never trusts the client-supplied name's extension over the sniffed bytes", async () => {
    // A PNG's real bytes, mislabeled with a .txt name, still converts to WebP.
    const result = await processUpload({ name: "totally-not-an-image.txt", buffer: await png() });
    expect(result.mime).toBe("image/webp");
    expect(result.name).toBe("totally-not-an-image.webp");
  });

  it("refuses an SVG upload unless allowSvg is set, pointing at the docs", async () => {
    await expect(processUpload({ name: "icon.svg", buffer: Buffer.from(SVG_CLEAN) })).rejects.toThrow(
      /SVG uploads are disabled.*allowSvg.*docs\/site\/media-storage\.md/
    );
  });

  it("strips <style>, <image> and every non-fragment href from an allowed SVG", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      "<style>@import url(https://evil.test/x.css)</style>" +
      '<image href="https://evil.test/track.png"/>' +
      '<a href="https://evil.test/"><circle r="1"/></a>' +
      '<use xlink:href="https://evil.test/sprite.svg#x"/>' +
      '<a href="#top"><circle id="top" r="2"/></a></svg>';
    const out = (await processUpload({ name: "s.svg", buffer: Buffer.from(svg) }, SVG_ON)).buffer.toString("utf8");
    expect(out).not.toMatch(/<style|<image|evil\.test/i);
    expect(out).toContain('href="#top"');
  });

  it("strips a style attribute and any presentation attribute with an external url() from an allowed SVG", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<rect style="fill: url(https://evil.test/x.svg#y)" width="1" height="1"/>' +
      '<circle fill="url(https://evil.test/track.png)" r="1"/>' +
      '<circle id="safe" fill="url(#gradient)" r="1"/>' +
      '<circle fill="\\75 rl(https://evil.test/esc.png)" r="1"/>' +
      "</svg>";
    const out = (await processUpload({ name: "s2.svg", buffer: Buffer.from(svg) }, SVG_ON)).buffer.toString("utf8");
    expect(out).not.toMatch(/style=|evil\.test/i);
    expect(out).toContain('fill="url(#gradient)"');
  });

  // Re-encoded, not passed through: the old passthrough kept EXIF/GPS and skipped the dimension cap.
  const withGps = (img: Sharp) => img.withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } });

  it("re-encodes an already-WebP upload, stripping EXIF and capping its dimensions", async () => {
    const webp = await withGps(
      sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp()
    ).toBuffer();
    expect((await sharp(webp).metadata()).exif).toBeDefined();
    const result = await processUpload({ name: "already.webp", buffer: webp });
    expect(result.mime).toBe("image/webp");
    expect(result.width).toBe(2000);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("re-encodes an already-AVIF upload as AVIF, stripping EXIF", async () => {
    // sharp 0.35 reports AVIF as format "heif" with compression "av1", not a
    // dedicated "avif" format. Locks in that this branch still recognizes it.
    const avif = await withGps(
      sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).avif()
    ).toBuffer();
    expect((await sharp(avif).metadata()).exif).toBeDefined();
    const result = await processUpload({ name: "already.avif", buffer: avif });
    expect(result.mime).toBe("image/avif");
    expect(result.name).toBe("already.avif");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.compression).toBe("av1");
    expect(meta.exif).toBeUndefined();
  });
});

describe("handleMediaUpload", () => {
  const upload = vi.fn(async (f: PreparedFile) => ({ id: f.name, url: `/media/${f.name}` }));
  const config = (extra: Partial<CmsConfig> = {}) =>
    ({ authorize: () => true, mediaAdapter: { upload }, ...extra }) as unknown as CmsConfig;
  const request = (headers: Record<string, string>, file?: File) => {
    const formData = vi.fn(async () => ({ get: () => file ?? null }));
    return { req: { headers: new Headers(headers), formData } as unknown as Request, formData };
  };

  it("refuses a cross-site upload with 403 before reading the body", async () => {
    const cross = (headers: Record<string, string>) => {
      const r = request(headers);
      return { req: Object.assign(r.req, { url: "http://127.0.0.1:3000/api/typren/media" }), formData: r.formData };
    };
    const refused: Record<string, string>[] = [
      { origin: "https://evil.test" },
      { "sec-fetch-site": "cross-site" },
      { origin: "null" },
    ];
    for (const headers of refused) {
      const { req, formData } = cross(headers);
      expect((await handleMediaUpload(config(), req)).status).toBe(403);
      expect(formData).not.toHaveBeenCalled();
    }
    // Same host, or an explicitly allowed origin, still reaches the upload.
    expect((await handleMediaUpload(config(), cross({ origin: "http://127.0.0.1:3000" }).req)).status).toBe(400);
    const allowed = cross({ origin: "https://editor.test", "sec-fetch-site": "cross-site" }).req;
    expect((await handleMediaUpload(config(), allowed, ["https://editor.test"])).status).toBe(400);
  });

  it("refuses a declared oversize body with 413 before buffering it", async () => {
    const { req, formData } = request({ "content-length": String(MAX_UPLOAD_BYTES + 1024 * 1024) });
    const res = await handleMediaUpload(config(), req);
    expect(res.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("threads CmsConfig.allowSvg into processUpload", async () => {
    const svg = () => new File([SVG_CLEAN], "icon.svg", { type: "image/svg+xml" });
    const refused = await handleMediaUpload(config(), request({ "content-length": "500" }, svg()).req);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/SVG uploads are disabled/);

    const allowed = await handleMediaUpload(config({ allowSvg: true }), request({}, svg()).req);
    expect(allowed.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ mime: "image/svg+xml" }));
  });
});
