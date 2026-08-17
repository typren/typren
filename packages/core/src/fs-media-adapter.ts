import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import type { MediaAdapter, MediaAsset, PreparedFile } from "./types";

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
 * Filesystem media adapter over a flat directory (mirrors `markdown-adapter.ts`'s
 * conventions: a `create*Adapter(opts)` factory, a `SAFE_*` traversal guard,
 * idempotent delete). Async throughout (unlike `ContentAdapter`) because
 * `list()` probes image dimensions via sharp — see `types.ts`'s `MediaAdapter`.
 */
export function createFsMediaAdapter({ dir, publicPath }: FsMediaAdapterOptions): MediaAdapter {
  // Ids/filenames reach fs calls straight from a Server Action argument — reject
  // anything that isn't a plain filename so "../" can't escape the media dir.
  const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
  const safe = (id: string) => {
    if (!SAFE_NAME.test(id) || id.includes("..")) throw new Error(`typren: unsafe media id "${id}"`);
    return id;
  };

  return {
    async list(): Promise<MediaAsset[]> {
      if (!fs.existsSync(dir)) return [];
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith(".") && !e.name.startsWith("_manifest-"));

      const assets = await Promise.all(
        entries.map(async (e): Promise<MediaAsset> => {
          const full = path.join(dir, e.name);
          const stat = fs.statSync(full);
          let width: number | undefined;
          let height: number | undefined;
          try {
            const meta = await sharp(full).metadata();
            width = meta.width;
            height = meta.height;
          } catch {
            // Corrupt or dimensionless file (e.g. a malformed SVG) — leave
            // width/height undefined rather than fail the whole listing.
          }
          return {
            id: e.name,
            url: `${publicPath}/${e.name}`,
            name: e.name,
            size: stat.size,
            width,
            height,
            mime: mimeFromExt(path.extname(e.name)),
            createdAt: stat.birthtime.toISOString(),
          };
        })
      );

      return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    },

    async upload(file: PreparedFile): Promise<MediaAsset> {
      fs.mkdirSync(dir, { recursive: true });
      // Unconditional random suffix — no existence-check-then-write race.
      // `file.name` is already slugified by processUpload; split its extension
      // back off so it isn't re-slugified (which would mangle the leading dot).
      const { name: root, ext } = path.parse(file.name);
      const key = `${root}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      const full = path.join(dir, key);
      fs.writeFileSync(full, file.buffer);
      const stat = fs.statSync(full);
      return {
        id: key,
        url: `${publicPath}/${key}`,
        name: file.name,
        size: stat.size,
        width: file.width,
        height: file.height,
        mime: file.mime,
        createdAt: stat.birthtime.toISOString(),
      };
    },

    async delete(id: string): Promise<void> {
      const full = path.join(dir, safe(id));
      if (fs.existsSync(full)) fs.rmSync(full);
    },
  };
}
