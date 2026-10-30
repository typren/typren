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

  describe("folders", () => {
    it("lists nested assets with their folder and every folder", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      await adapter.createFolder!("events/2025");
      const asset = await adapter.upload(await preparedPng(), "events/2025");
      expect(asset.id).toMatch(/^events\/2025\/photo-[0-9a-f]{8}\.webp$/);
      expect(asset.url).toBe(`/img/${asset.id}`);
      expect(asset.folder).toBe("events/2025");
      expect(await adapter.listFolders!()).toEqual(["events", "events/2025"]);
      expect((await adapter.list())[0]).toMatchObject({ id: asset.id, folder: "events/2025", width: 2 });
    });

    it("moves an asset between folders and reports its old URL", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      const asset = await adapter.upload(await preparedPng());
      const { from, to } = await adapter.move!(asset.id, "authors");
      expect(from).toBe(`/img/${asset.id}`);
      expect(to).toMatchObject({ id: `authors/${asset.id}`, url: `/img/authors/${asset.id}`, folder: "authors" });
      expect(fs.existsSync(path.join(mediaDir, "authors", asset.id))).toBe(true);
      const back = await adapter.move!(to.id, "");
      expect(back.to.id).toBe(asset.id);
      expect((await adapter.move!(asset.id, "")).from).toBe(`/img/${asset.id}`); // no-op move
    });

    it("refuses to move onto an existing file", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      const asset = await adapter.upload(await preparedPng());
      fs.mkdirSync(path.join(mediaDir, "a"));
      fs.copyFileSync(path.join(mediaDir, asset.id), path.join(mediaDir, "a", asset.id));
      await expect(adapter.move!(asset.id, "a")).rejects.toThrow(/already exists/);
    });

    it("deletes only empty folders, and never the root", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      await adapter.upload(await preparedPng(), "full");
      await adapter.createFolder!("empty/nested");
      await expect(adapter.deleteFolder!("full")).rejects.toThrow(/isn't empty/);
      await adapter.deleteFolder!("empty");
      expect(await adapter.listFolders!()).toEqual(["full"]);
      await expect(adapter.deleteFolder!("")).rejects.toThrow(/root/);
      await expect(adapter.deleteFolder!("gone")).resolves.toBeUndefined();
      await expect(adapter.createFolder!("")).rejects.toThrow(/required/);
    });

    it("renames a folder with its assets, reporting every URL move", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      const asset = await adapter.upload(await preparedPng(), "old/deep");
      const moves = await adapter.renameFolder!("old", "new/place");
      expect(moves).toEqual([{ from: `/img/${asset.id}`, to: `/img/new/place/deep/${asset.id.split("/").pop()}` }]);
      expect(fs.existsSync(path.join(mediaDir, "new/place/deep"))).toBe(true);
    });

    it("refuses to rename the root, into itself, or onto an existing folder", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      await adapter.createFolder!("a");
      await adapter.createFolder!("b");
      await expect(adapter.renameFolder!("", "x")).rejects.toThrow(/root/);
      await expect(adapter.renameFolder!("a", "")).rejects.toThrow(/root/);
      await expect(adapter.renameFolder!("a", "a/inner")).rejects.toThrow(/into itself/);
      await expect(adapter.renameFolder!("a", "b")).rejects.toThrow(/already exists/);
      await expect(adapter.renameFolder!("a", "../x")).rejects.toThrow(/unsafe/);
    });

    it("keeps the extension when a move renames, and does not double it", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      const asset = await adapter.upload(await preparedPng());
      const one = await adapter.move!(asset.id, "f", "fresh");
      expect(one.to.id).toBe("f/fresh.webp");
      const two = await adapter.move!(one.to.id, "f", "other.webp");
      expect(two.to.id).toBe("f/other.webp");
    });

    it("rejects traversal in folder names", async () => {
      const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });
      await expect(adapter.createFolder!("../x")).rejects.toThrow(/unsafe media folder/);
      await expect(adapter.upload(await preparedPng(), "a/../../x")).rejects.toThrow(/unsafe/);
      await expect(adapter.move!("x.webp", "..")).rejects.toThrow(/unsafe/);
    });
  });

  it("refuses to upload, move or delete through a symlink in the media tree", async () => {
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.webp"), "keep");
    fs.mkdirSync(mediaDir);
    fs.symlinkSync(outside, path.join(mediaDir, "linked"));
    fs.symlinkSync(path.join(outside, "secret.webp"), path.join(mediaDir, "file.webp"));
    const adapter = createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" });

    await expect(adapter.upload(await preparedPng(), "linked")).rejects.toThrow(/symlinked/);
    await expect(adapter.upload(await preparedPng(), "linked/sub")).rejects.toThrow(/symlinked/);
    await expect(adapter.delete("linked/secret.webp")).rejects.toThrow(/symlinked/);
    await expect(adapter.delete("file.webp")).rejects.toThrow(/symlinked/);
    await expect(adapter.move!("file.webp", "", "moved")).rejects.toThrow(/symlinked/);
    await expect(adapter.renameFolder!("linked", "other")).rejects.toThrow(/symlinked/);
    expect(fs.readdirSync(outside)).toEqual(["secret.webp"]);
    expect(fs.readFileSync(path.join(outside, "secret.webp"), "utf8")).toBe("keep");
  });
});
