import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import type { MediaAdapter, MediaAsset, MediaMove, PreparedFile } from "./types";

export type FsMediaAdapterOptions = {
  /** Absolute path to the directory assets are read from/written to. */
  dir: string;
  /** Public URL prefix the dir is served under, e.g. "/img". */
  publicPath: string;
};

// mime lookup for *pre-existing* files that never went through processUpload
// (which stamps its own authoritative `mime` on the PreparedFile it returns).
// Only used by list().
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

/**
 * Filesystem media adapter over a directory tree: subfolders are media
 * folders, and an asset's id is its "/"-joined path under `dir` (mirrors
 * `markdown-adapter.ts`'s conventions: a `create*Adapter(opts)` factory, a
 * `SAFE_*` traversal guard, idempotent delete). Async throughout, same as
 * `ContentAdapter` (issue #29): `list()` probes image dimensions via sharp.
 * See `types.ts`'s `MediaAdapter`.
 */
export function createFsMediaAdapter({ dir, publicPath }: FsMediaAdapterOptions): MediaAdapter {
  // Ids and folders reach fs calls straight from a request, so every path
  // segment must be a plain name: "../" can't escape the media dir.
  const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
  // A symlink planted in the media tree (a merged PR can add one) would turn
  // an upload, move or delete into a write anywhere the server can reach, so
  // every existing component below `dir` is lstat'ed, as the markdown
  // adapter does; only `dir` itself may be reached via a link.
  const safe = (rel: string, kind = "media id") => {
    if (!rel.split("/").every((seg) => SAFE_NAME.test(seg) && !seg.includes("..")))
      throw new Error(`typren: unsafe ${kind} "${rel}"`);
    let p = dir;
    for (const seg of rel.split("/")) {
      p = path.join(p, seg);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        break; // absent: nothing below it can be a link
      }
      if (st.isSymbolicLink()) throw new Error(`typren: refusing symlinked ${kind} "${rel}"`);
    }
    return rel;
  };
  const safeFolder = (folder: string) => (folder === "" ? "" : safe(folder, "media folder"));
  const visible = (name: string) => !name.startsWith(".") && !name.startsWith("_manifest-");

  /** Every visible entry under `dir`, as "/"-joined relative paths. */
  const walk = (rel = ""): { files: string[]; folders: string[] } => {
    const files: string[] = [];
    const folders: string[] = [];
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return { files, folders };
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!visible(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isFile()) files.push(child);
      else if (e.isDirectory()) {
        folders.push(child);
        const sub = walk(child);
        files.push(...sub.files);
        folders.push(...sub.folders);
      }
    }
    return { files, folders };
  };

  const describe = async (id: string, name = path.posix.basename(id)): Promise<MediaAsset> => {
    const full = path.join(dir, id);
    const stat = fs.statSync(full);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(full).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // Corrupt or dimensionless file (e.g. a malformed SVG): leave
      // width/height undefined rather than fail the whole listing.
    }
    const folder = path.posix.dirname(id);
    return {
      id,
      url: `${publicPath}/${id}`,
      name,
      size: stat.size,
      width,
      height,
      mime: mimeFromExt(path.extname(id)),
      createdAt: stat.birthtime.toISOString(),
      folder: folder === "." ? "" : folder,
    };
  };

  return {
    async list(): Promise<MediaAsset[]> {
      const assets = await Promise.all(walk().files.map((id) => describe(id)));
      return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    },

    async upload(file: PreparedFile, folder = ""): Promise<MediaAsset> {
      const target = path.join(dir, safeFolder(folder));
      fs.mkdirSync(target, { recursive: true });
      // Unconditional random suffix: no existence-check-then-write race.
      // `file.name` is already slugified by processUpload; split its extension
      // back off so it isn't re-slugified (which would mangle the leading dot).
      const { name: root, ext } = path.parse(file.name);
      const key = `${root}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const id = folder ? `${folder}/${key}` : key;
      fs.writeFileSync(path.join(target, key), file.buffer);
      return { ...(await describe(id, file.name)), mime: file.mime, width: file.width, height: file.height };
    },

    async delete(id: string): Promise<void> {
      const full = path.join(dir, safe(id));
      if (fs.existsSync(full)) fs.rmSync(full);
    },

    async listFolders(): Promise<string[]> {
      return walk().folders.sort();
    },

    async createFolder(folder: string): Promise<void> {
      if (!folder) throw new Error("typren: media folder name is required");
      fs.mkdirSync(path.join(dir, safe(folder, "media folder")), { recursive: true });
    },

    async deleteFolder(folder: string): Promise<void> {
      if (!folder) throw new Error("typren: the media root can't be deleted");
      const full = path.join(dir, safe(folder, "media folder"));
      if (!fs.existsSync(full)) return;
      if (walk(folder).files.length) throw new Error(`typren: media folder "${folder}" isn't empty`);
      fs.rmSync(full, { recursive: true });
    },

    async move(id: string, folder: string, name?: string): Promise<{ from: string; to: MediaAsset }> {
      const base = path.posix.basename(safe(id));
      const ext = path.posix.extname(base);
      const renamed = name ? (name.endsWith(ext) ? name : `${name}${ext}`) : base;
      const nextId = [safeFolder(folder), safe(renamed)].filter(Boolean).join("/");
      if (nextId === id) return { from: `${publicPath}/${id}`, to: await describe(id) };
      const target = path.join(dir, nextId);
      if (fs.existsSync(target)) throw new Error(`typren: "${nextId}" already exists`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(dir, id), target);
      return { from: `${publicPath}/${id}`, to: await describe(nextId) };
    },

    async renameFolder(folder: string, to: string): Promise<MediaMove[]> {
      if (!folder || !to) throw new Error("typren: the media root can't be renamed");
      const from = path.join(dir, safe(folder, "media folder"));
      const target = path.join(dir, safe(to, "media folder"));
      if (`${to}/`.startsWith(`${folder}/`)) throw new Error(`typren: can't move "${folder}" into itself`);
      if (fs.existsSync(target)) throw new Error(`typren: "${to}" already exists`);
      const moves = walk(folder).files.map((id) => ({
        from: `${publicPath}/${id}`,
        to: `${publicPath}/${to}${id.slice(folder.length)}`,
      }));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(from, target);
      return moves;
    },
  };
}
