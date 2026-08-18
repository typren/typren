import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processUpload, MAX_UPLOAD_BYTES } from "./media";

const png = (width = 4, height = 4) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 10 } } })
    .png()
    .toBuffer();

const SVG_CLEAN = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5"/></svg>';
const SVG_SCRIPT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';

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

  it("passes through a clean SVG unchanged, sniffing the real mime", async () => {
    const result = await processUpload({ name: "icon.svg", buffer: Buffer.from(SVG_CLEAN) });
    expect(result.mime).toBe("image/svg+xml");
    expect(result.buffer.toString("utf8")).toBe(SVG_CLEAN);
  });

  it("rejects an SVG containing a <script> tag (stored-XSS vector)", async () => {
    await expect(processUpload({ name: "evil.svg", buffer: Buffer.from(SVG_SCRIPT) })).rejects.toThrow(/script/i);
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

  it("passes an already-WebP upload through unconverted", async () => {
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .webp()
      .toBuffer();
    const result = await processUpload({ name: "already.webp", buffer: webp });
    expect(result.mime).toBe("image/webp");
    expect(result.buffer).toBe(webp); // ponytail branch: passthrough, not re-encoded
  });

  it("passes an already-AVIF upload through unconverted", async () => {
    // sharp 0.35 reports AVIF as format "heif" with compression "av1", not a
    // dedicated "avif" format. Locks in that this branch still recognizes it.
    const avif = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .avif()
      .toBuffer();
    const result = await processUpload({ name: "already.avif", buffer: avif });
    expect(result.mime).toBe("image/avif");
    expect(result.buffer).toBe(avif);
  });
});
