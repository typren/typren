import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createFsMediaAdapter } from "./fs-media-adapter";
import type { PreparedFile } from "./types";

let dir: string;
let mediaDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-media-"));
  mediaDir = path.join(dir, "img");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const preparedPng = async (name = "photo.webp"): Promise<PreparedFile> => {
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ff0000" } })
    .webp()
    .toBuffer();
  return { name, mime: "image/webp", buffer, width: 2, height: 2 };
};

describe("createFsMediaAdapter", () => {
  it("list() returns [] when the directory doesn't exist yet", async () => {
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    expect(await adapter.list()).toEqual([]);
  });

  it("upload() writes the file under a random suffix and list() finds it", async () => {
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    const asset = await adapter.upload(await preparedPng());

    expect(asset.id).toMatch(/^photo-[0-9a-f]{8}\.webp$/);
    expect(asset.url).toBe(`/img/${asset.id}`);
    expect(asset.name).toBe("photo.webp"); // display name keeps the pre-suffix name
    expect(fs.existsSync(path.join(mediaDir, asset.id))).toBe(true);

    const listed = await adapter.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(asset.id);
    expect(listed[0].width).toBe(2);
  });

  it("upload() never collides: two uploads of the same name get distinct keys", async () => {
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    const a = await adapter.upload(await preparedPng());
    const b = await adapter.upload(await preparedPng());
    expect(a.id).not.toBe(b.id);
    expect(await adapter.list()).toHaveLength(2);
  });

  it("list() skips dotfiles and _manifest-*.json", async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, ".DS_Store"), "");
    fs.writeFileSync(path.join(mediaDir, "_manifest-home.json"), "{}");
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    expect(await adapter.list()).toEqual([]);
  });

  it("delete() removes an existing asset and is idempotent for a missing one", async () => {
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    const asset = await adapter.upload(await preparedPng());
    await adapter.delete(asset.id);
    expect(fs.existsSync(path.join(mediaDir, asset.id))).toBe(false);
    await expect(adapter.delete(asset.id)).resolves.toBeUndefined(); // no-op, doesn't throw
  });

  it("delete() rejects a path-traversal id instead of touching the filesystem", async () => {
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
    await expect(adapter.delete("../../etc/passwd")).rejects.toThrow(/unsafe media id/);
  });
});
